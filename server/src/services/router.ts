import { getDb } from '../db/index.js';
import { getProvider } from '../providers/index.js';
import { decrypt } from '../lib/crypto.js';
import { canMakeRequest, canUseTokens, isOnCooldown } from './ratelimit.js';
import type { BaseProvider } from '../providers/base.js';

interface ModelRow {
  id: number;
  platform: string;
  model_id: string;
  display_name: string;
  rpm_limit: number | null;
  rpd_limit: number | null;
  tpm_limit: number | null;
  tpd_limit: number | null;
}

interface KeyRow {
  id: number;
  platform: string;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  status: string;
  enabled: number;
}

interface FallbackRow {
  model_db_id: number;
  priority: number;
  enabled: number;
}

export interface RouteResult {
  provider: BaseProvider;
  modelId: string;
  modelDbId: number;
  apiKey: string;
  keyId: number;
  platform: string;
  displayName: string;
}

// Round-robin index per platform
const roundRobinIndex = new Map<string, number>();

// ── Dynamic priority: track 429s per model and demote accordingly ──
// Key: model_db_id → { count, lastHit, penalty }
const rateLimitPenalties = new Map<number, { count: number; lastHit: number; penalty: number }>();

// Penalty decays over time so models recover
const PENALTY_PER_429 = 3;        // each 429 adds this many priority positions
const MAX_PENALTY = 10;            // cap so a model doesn't sink forever
const DECAY_INTERVAL_MS = 2 * 60 * 1000; // penalty decays every 2 minutes
const DECAY_AMOUNT = 1;            // remove this much penalty per decay interval

/**
 * Record a 429 for a model — increases its penalty so it sinks in priority.
 */
export function recordRateLimitHit(modelDbId: number) {
  const existing = rateLimitPenalties.get(modelDbId);
  const now = Date.now();
  if (existing) {
    existing.count++;
    existing.lastHit = now;
    existing.penalty = Math.min(existing.penalty + PENALTY_PER_429, MAX_PENALTY);
  } else {
    rateLimitPenalties.set(modelDbId, { count: 1, lastHit: now, penalty: PENALTY_PER_429 });
  }
}

/**
 * Record a success for a model — reduces its penalty so it rises back up.
 */
export function recordSuccess(modelDbId: number) {
  const existing = rateLimitPenalties.get(modelDbId);
  if (existing) {
    existing.penalty = Math.max(0, existing.penalty - 1);
    if (existing.penalty === 0) {
      rateLimitPenalties.delete(modelDbId);
    }
  }
}

/**
 * Get the current penalty for a model (with time-based decay).
 */
function getPenalty(modelDbId: number): number {
  const entry = rateLimitPenalties.get(modelDbId);
  if (!entry) return 0;

  // Apply time-based decay
  const now = Date.now();
  const elapsed = now - entry.lastHit;
  const decaySteps = Math.floor(elapsed / DECAY_INTERVAL_MS);
  if (decaySteps > 0) {
    entry.penalty = Math.max(0, entry.penalty - (decaySteps * DECAY_AMOUNT));
    entry.lastHit = now; // reset so we don't double-decay
    if (entry.penalty === 0) {
      rateLimitPenalties.delete(modelDbId);
      return 0;
    }
  }

  return entry.penalty;
}

/**
 * Get current penalties for all models (for the API/dashboard).
 */
export function getAllPenalties(): Array<{ modelDbId: number; count: number; penalty: number }> {
  const result: Array<{ modelDbId: number; count: number; penalty: number }> = [];
  for (const [modelDbId, entry] of rateLimitPenalties) {
    const penalty = getPenalty(modelDbId);
    if (penalty > 0) {
      result.push({ modelDbId, count: entry.count, penalty });
    }
  }
  return result.sort((a, b) => b.penalty - a.penalty);
}

/**
 * Route a request to the best available model.
 * Models are sorted by (base_priority + rate_limit_penalty) so frequently
 * rate-limited models automatically sink below working ones.
 *
 * If preferredModelDbId is set, that model gets tried FIRST (sticky sessions).
 * This prevents hallucination from model switching mid-conversation.
 *
 * @param estimatedTokens - estimated total tokens for rate limit check
 * @param skipKeys - set of "platform:modelId:keyId" to skip (failed on this request)
 * @param preferredModelDbId - try this model first (sticky session)
 */
function isCodingModel(platform: string, modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes('coder') || id.includes('codestral') || id.includes('code');
}

/**
 * Route a request to the best available model.
 * Models are sorted by (base_priority + rate_limit_penalty) so frequently
 * rate-limited models automatically sink below working ones.
 *
 * If preferredModelDbId is set, that model gets tried FIRST (sticky sessions).
 * This prevents hallucination from model switching mid-conversation.
 *
 * @param estimatedTokens - estimated total tokens for rate limit check
 * @param skipKeys - set of "platform:modelId:keyId" to skip (failed on this request)
 * @param preferredModelDbId - try this model first (sticky session)
 * @param isCoding - set to true if the query is a coding task
 */
export function routeRequest(
  estimatedTokens = 1000, 
  skipKeys?: Set<string>, 
  preferredModelDbId?: number,
  isCoding = false
): RouteResult {
  const db = getDb();

  // Get fallback chain ordered by priority
  const fallbackChain = db.prepare(`
    SELECT fc.model_db_id, fc.priority, fc.enabled, m.platform, m.model_id, m.size_label, m.intelligence_rank
    FROM fallback_config fc
    LEFT JOIN models m ON fc.model_db_id = m.id
    ORDER BY fc.priority ASC
  `).all() as (FallbackRow & { platform: string; model_id: string; size_label: string; intelligence_rank: number })[];

  // Apply dynamic penalties: sort by (base priority + penalty)
  let sortedChain = fallbackChain.map(entry => ({
    ...entry,
    effectivePriority: entry.priority + getPenalty(entry.model_db_id),
  })).sort((a, b) => a.effectivePriority - b.effectivePriority);

  // Extract most recently failed model category and rank
  let failedModelDetails: { size_label: string; intelligence_rank: number } | undefined;

  // Filter out models that have already failed during this request
  if (skipKeys && skipKeys.size > 0) {
    sortedChain = sortedChain.filter(entry => {
      for (const skipId of skipKeys) {
        const parts = skipId.split(':');
        if (parts.length >= 3) {
          const skipPlatform = parts[0];
          const skipModelId = parts.slice(1, -1).join(':');
          if (skipPlatform === entry.platform && skipModelId === entry.model_id) {
            return false;
          }
        }
      }
      return true;
    });

    const lastSkipId = Array.from(skipKeys).pop()!;
    const parts = lastSkipId.split(':');
    if (parts.length >= 3) {
      const failedPlatform = parts[0];
      const failedModelId = parts.slice(1, -1).join(':');
      const failedModel = db.prepare('SELECT size_label, intelligence_rank FROM models WHERE platform = ? AND model_id = ?').get(failedPlatform, failedModelId) as { size_label: string; intelligence_rank: number } | undefined;
      if (failedModel) {
        failedModelDetails = failedModel;
      }
    }
  }

  // Smart Routing: if estimatedTokens > 8000, skip 'small' models (like GitHub Models or Groq)
  // and prioritize large-context models like Gemini.
  if (estimatedTokens > 8000) {
    sortedChain = sortedChain.filter(entry => entry.platform !== 'github' && entry.platform !== 'groq');
  }

  // Apply custom sorting rules depending on the task type
  if (isCoding) {
    sortedChain.sort((a, b) => {
      const aIsCoder = isCodingModel(a.platform, a.model_id);
      const bIsCoder = isCodingModel(b.platform, b.model_id);

      // 1. Prioritize coding-specific models
      if (aIsCoder && !bIsCoder) return -1;
      if (!aIsCoder && bIsCoder) return 1;

      // 2. Prioritize high intelligence general models as fallbacks
      if (!aIsCoder && !bIsCoder) {
        const aIsFrontier = a.intelligence_rank <= 4;
        const bIsFrontier = b.intelligence_rank <= 4;
        if (aIsFrontier && !bIsFrontier) return -1;
        if (!aIsFrontier && bIsFrontier) return 1;
      }

      // 3. Fall back to effectivePriority
      return a.effectivePriority - b.effectivePriority;
    });
  } else {
    sortedChain.sort((a, b) => {
      // 1. Google (Gemini) prioritization if estimatedTokens > 8000
      if (estimatedTokens > 8000) {
        const aIsGoogle = a.platform === 'google';
        const bIsGoogle = b.platform === 'google';
        if (aIsGoogle && !bIsGoogle) return -1;
        if (!aIsGoogle && bIsGoogle) return 1;
      }

      // 2. Similarity sorting if we have a failed model
      if (failedModelDetails) {
        const aMatchesCategory = a.size_label === failedModelDetails.size_label;
        const bMatchesCategory = b.size_label === failedModelDetails.size_label;
        if (aMatchesCategory && !bMatchesCategory) return -1;
        if (!aMatchesCategory && bMatchesCategory) return 1;

        const aDiff = Math.abs(a.intelligence_rank - failedModelDetails.intelligence_rank);
        const bDiff = Math.abs(b.intelligence_rank - failedModelDetails.intelligence_rank);
        if (aDiff !== bDiff) return aDiff - bDiff;
      }

      // 3. Fall back to effectivePriority
      return a.effectivePriority - b.effectivePriority;
    });
  }

  // Sticky session: move preferred model to front of chain
  if (preferredModelDbId) {
    const idx = sortedChain.findIndex(e => e.model_db_id === preferredModelDbId);
    if (idx > 0) {
      const [preferred] = sortedChain.splice(idx, 1);
      sortedChain.unshift(preferred);
    }
  }

  for (const entry of sortedChain) {
    if (!entry.enabled) continue;

    // Get model details
    const model = db.prepare('SELECT * FROM models WHERE id = ? AND enabled = 1').get(entry.model_db_id) as ModelRow | undefined;
    if (!model) continue;

    // Check if we have a provider for this platform
    const provider = getProvider(model.platform as any);
    if (!provider) continue;

    // Get all healthy, enabled keys for this platform
    const keys = db.prepare(
      'SELECT * FROM api_keys WHERE platform = ? AND enabled = 1 AND status != ?'
    ).all(model.platform, 'invalid') as KeyRow[];

    if (keys.length === 0) continue;

    // Get limits once for this model
    const limits = {
      rpm: model.rpm_limit,
      rpd: model.rpd_limit,
      tpm: model.tpm_limit,
      tpd: model.tpd_limit,
    };

    // Try all keys for this model before giving up on it
    const rrKey = `${model.platform}:${model.model_id}`;
    let idx = roundRobinIndex.get(rrKey) ?? 0;

    for (let attempt = 0; attempt < keys.length; attempt++) {
      const key = keys[idx % keys.length];
      idx++;

      const skipId = `${model.platform}:${model.model_id}:${key.id}`;
      if (skipKeys?.has(skipId)) continue;

      // Check cooldown (from previous 429s)
      if (isOnCooldown(model.platform, model.model_id, key.id)) continue;

      if (!canMakeRequest(model.platform, model.model_id, key.id, limits)) continue;
      if (!canUseTokens(model.platform, model.model_id, key.id, estimatedTokens, limits)) continue;

      // We found a working key for this model!
      roundRobinIndex.set(rrKey, idx);
      const decryptedKey = decrypt(key.encrypted_key, key.iv, key.auth_tag);

      return {
        provider,
        modelId: model.model_id,
        modelDbId: model.id,
        apiKey: decryptedKey,
        keyId: key.id,
        platform: model.platform,
        displayName: model.display_name,
      };
    }

    // If we reach here, this specific model has NO available keys.
    // Update round-robin index even if we failed so we don't get stuck.
    roundRobinIndex.set(rrKey, idx);
    
    // We don't explicitly penalize the model here because the fact that we 
    // couldn't find a key means we will naturally move to the next model 
    // in the `sortedChain` for THIS specific request.
  }

  const err = new Error('All models exhausted. Add more API keys or wait for rate limits to reset.') as any;
  err.status = 429;
  throw err;
}
