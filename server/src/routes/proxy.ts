import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ChatMessage } from '@llm_council/shared/types.js';
import { routeRequest, recordRateLimitHit, recordSuccess, type RouteResult } from '../services/router.js';
import { recordRequest, recordTokens, setCooldown } from '../services/ratelimit.js';
import { getDb, getUnifiedApiKey } from '../db/index.js';

export const proxyRouter = Router();

// Constant-time string comparison for the unified API key. Plain `===` leaks
// length and per-character timing, which a network attacker could in principle
// use to recover the key one byte at a time.
function timingSafeStringEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Compare against a same-length buffer regardless of input length so the
  // comparison itself runs in constant time; the explicit length check at the
  // end is what actually decides equality when lengths differ.
  const compareA = a.length === b.length ? a : Buffer.alloc(b.length);
  return crypto.timingSafeEqual(compareA, b) && a.length === b.length;
}

function isCodingTask(messages: ChatMessage[]): boolean {
  if (!messages || messages.length === 0) return false;

  const codingKeywords = /\b(code|coding|program|programming|script|scripting|develop|developer|development|software|engineer|engineering|function|class|method|interface|type|struct|compile|compiler|debugging|debugger|debug|test|testing|unittest|mock|refactor|refactoring|algorithm|regex|sql|database|query|queries|repository|git|github|gitlab|commit|pr|branch|merge|conflict|markdown|yaml|json|xml|html|css|scss|sass|less|svg|javascript|typescript|js|ts|jsx|tsx|python|py|java|c\+\+|cpp|csharp|cs|golang|go-lang|rust|rs|php|ruby|rb|bash|sh|powershell|ps1|docker|dockerfile|kubernetes|k8s|jenkins|ci\/cd|pipeline|webpack|vite|rollup|npm|yarn|pnpm|bun)\b/i;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user' || msg.role === 'system') {
      const content = msg.content;
      if (typeof content === 'string') {
        if (content.includes('```') || codingKeywords.test(content)) {
          return true;
        }
      }
    }
    if (messages.length - i >= 3) break;
  }
  return false;
}

// Sticky sessions: track which model served each "session"
// Key: hash of first user message → model_db_id
// This prevents model switching mid-conversation which causes hallucination
const stickySessionMap = new Map<string, { modelDbId: number; lastUsed: number }>();
const STICKY_TTL_MS = 30 * 60 * 1000; // 30 min session TTL

function getSessionKey(messages: ChatMessage[]): string {
  // Use the first user message as session identifier — clients like Hermes
  // re-send the full conversation each turn, so the first user message is
  // stable across turns. Hash the FULL message (not a 100-char slice) so
  // distinct conversations with identical openings don't collide.
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser || typeof firstUser.content !== 'string') return '';
  const hash = crypto.createHash('sha1').update(firstUser.content).digest('hex');
  return `${hash}:${messages.length > 2 ? 'multi' : 'single'}`;
}

function getStickyModel(messages: ChatMessage[]): number | undefined {
  // Only apply sticky for multi-turn (has assistant messages = continuation)
  const hasAssistant = messages.some(m => m.role === 'assistant');
  if (!hasAssistant) return undefined;

  const key = getSessionKey(messages);
  if (!key) return undefined;

  const entry = stickySessionMap.get(key);
  if (!entry) return undefined;

  if (Date.now() - entry.lastUsed > STICKY_TTL_MS) {
    stickySessionMap.delete(key);
    return undefined;
  }
  return entry.modelDbId;
}

function setStickyModel(messages: ChatMessage[], modelDbId: number) {
  const key = getSessionKey(messages);
  if (!key) return;
  stickySessionMap.set(key, { modelDbId, lastUsed: Date.now() });

  // Cleanup old entries
  if (stickySessionMap.size > 500) {
    const now = Date.now();
    for (const [k, v] of stickySessionMap) {
      if (now - v.lastUsed > STICKY_TTL_MS) stickySessionMap.delete(k);
    }
  }
}

// OpenAI-compatible /models endpoint (used by Hermes for metadata)
proxyRouter.get('/models', (_req: Request, res: Response) => {
  const db = getDb();
  const models = db.prepare('SELECT platform, model_id, display_name, context_window FROM models WHERE enabled = 1 ORDER BY intelligence_rank').all() as any[];
  res.json({
    object: 'list',
    data: models.map(m => ({
      id: m.model_id,
      object: 'model',
      created: 0,
      owned_by: m.platform,
      name: m.display_name,
      context_window: m.context_window,
    })),
  });
});

const MAX_RETRIES = 20;

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
  thought_signature: z.string().optional(),
});

const systemMessageSchema = z.object({
  role: z.literal('system'),
  content: z.string(),
  name: z.string().optional(),
});

const userMessageSchema = z.object({
  role: z.literal('user'),
  content: z.string(),
  name: z.string().optional(),
});

const assistantMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable().optional(),
  name: z.string().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
}).refine((msg) => {
  const hasContent = typeof msg.content === 'string' && msg.content.length > 0;
  const hasToolCalls = (msg.tool_calls?.length ?? 0) > 0;
  return hasContent || hasToolCalls;
}, {
  message: 'assistant messages must include non-empty content or tool_calls',
});

const toolMessageSchema = z.object({
  role: z.literal('tool'),
  content: z.string(),
  tool_call_id: z.string().min(1),
  name: z.string().optional(),
});

const toolDefinitionSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().optional(),
  }),
});

const toolChoiceSchema = z.union([
  z.enum(['none', 'auto', 'required']),
  z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string().min(1),
    }),
  }),
]);

const chatCompletionSchema = z.object({
  messages: z.array(z.union([
    systemMessageSchema,
    userMessageSchema,
    assistantMessageSchema,
    toolMessageSchema,
  ])).min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
  tools: z.array(toolDefinitionSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
});

function isRetryableError(err: any): boolean {
  const msg = (err.message ?? '').toLowerCase();
  const status = err.status ?? err.statusCode;

  // 413 Payload Too Large — model can't handle the input size
  if (status === 413 || msg.includes('413') || msg.includes('payload too large')) return true;

  // 400 Bad Request — only retry if it's a known transient issue:
  //   - 'thought_signature': Gemini 2.0+ rejects stale/missing signatures
  //   - 'context window': input exceeded model's context limit
  if ((status === 400 || msg.includes('400')) && (msg.includes('thought_signature') || msg.includes('context window'))) return true;

  // Standard rate limit / availability errors
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')
    || msg.includes('quota') || msg.includes('resource_exhausted')
    || msg.includes('aborted') || msg.includes('timeout') || msg.includes('etimedout')
    || msg.includes('econnrefused') || msg.includes('econnreset')
    || msg.includes('503') || msg.includes('unavailable')
    || msg.includes('500') || msg.includes('internal server error');
}

proxyRouter.post('/chat/completions', async (req: Request, res: Response) => {
  const start = Date.now();

  // Authenticate with unified API key. Local requests (127.0.0.1) skip the check
  // since they came from the same machine running the server. Non-local requests
  // MUST present a valid Bearer token — missing or wrong → 401.
  //
  // Note: req.ip is the actual TCP socket peer because we never set
  // `trust proxy`, so X-Forwarded-For cannot spoof a localhost identity.
  // If a future change enables `trust proxy`, this localhost bypass MUST be
  // re-evaluated.
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  if (!isLocal) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const unifiedKey = getUnifiedApiKey();
    if (!token || !timingSafeStringEqual(token, unifiedKey)) {
      res.status(401).json({
        error: { message: 'Invalid API key', type: 'authentication_error' },
      });
      return;
    }
  }

  // Validate request
  const parsed = chatCompletionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
        type: 'invalid_request_error',
      },
    });
    return;
  }

  const { model: requestedModel, temperature, max_tokens, top_p, stream, tools, tool_choice, parallel_tool_calls } = parsed.data;
  const messages: ChatMessage[] = parsed.data.messages.map((m): ChatMessage => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content ?? null,
        ...(m.name ? { name: m.name } : {}),
        ...(m.tool_calls ? { tool_calls: m.tool_calls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
          thought_signature: tc.thought_signature,
        })) } : {}),
      };
    }

    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.tool_call_id,
        ...(m.name ? { name: m.name } : {}),
      };
    }

    return {
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    };
  });

  // 1. Detect if it is a coding task
  const isCoding = isCodingTask(messages);

  // 2. Adjust temperature (cap at 0.2 for coding to prevent hallucinations, default to 0.1 for coding, 0.5 for general)
  const finalTemperature = isCoding
    ? (temperature !== undefined ? Math.min(temperature, 0.2) : 0.1)
    : (temperature !== undefined ? temperature : 0.5);

  // 3. Prepend/append task structure guidelines to prevent hallucinations
  const structuredMessages = [...messages];
  const systemMsgIdx = structuredMessages.findIndex(m => m.role === 'system');

  const codingInstruction = "\n\n[Task Structure: Coding. Focus on clean, fully-implemented, compile-safe code. Avoid ellipsis (...) or placeholder comments. Ensure all code blocks specify their language. Do not hallucinate API properties or library functions. Keep explanations minimal and code-centric.]";
  const generalInstruction = "\n\n[Task Structure: General. Provide factually grounded, logical explanations. If you are uncertain or lack data, explicitly state so instead of guessing or fabricating facts to prevent hallucination. Keep responses concise and structured.]";

  const instructionToAdd = isCoding ? codingInstruction : generalInstruction;

  if (systemMsgIdx !== -1) {
    const originalContent = structuredMessages[systemMsgIdx].content ?? '';
    if (typeof originalContent === 'string') {
      structuredMessages[systemMsgIdx] = {
        ...structuredMessages[systemMsgIdx],
        content: originalContent + instructionToAdd,
      };
    }
  } else {
    const firstUserMsgIdx = structuredMessages.findIndex(m => m.role === 'user');
    if (firstUserMsgIdx !== -1) {
      const originalContent = structuredMessages[firstUserMsgIdx].content ?? '';
      if (typeof originalContent === 'string') {
        structuredMessages[firstUserMsgIdx] = {
          ...structuredMessages[firstUserMsgIdx],
          content: originalContent + instructionToAdd,
        };
      }
    }
  }

  // Token estimation is intentionally a heuristic (~4 chars per token). Used
  // for routing decisions (skip a model whose budget is too small) and for
  // streaming bookkeeping where the provider doesn't echo a final usage count.
  // Non-streaming requests reconcile against the provider's real `usage` block
  // (see line ~340). Streaming will drift from real consumption — accepted
  // tradeoff because per-request usage isn't always returned mid-stream.
  const estimatedInputTokens = structuredMessages.reduce((sum, m) => {
    if (typeof m.content !== 'string') return sum;
    return sum + Math.ceil(m.content.length / 4);
  }, 0);
  const estimatedTotal = estimatedInputTokens + (max_tokens ?? 1000);

  // Explicit `model` field pins routing. If the catalog has no enabled row
  // matching the requested id, return 400 — silently auto-routing to a
  // different model would be surprising to OpenAI-compatible clients.
  // Sticky-session is the fallback when no `model` field was sent at all.
  let preferredModel: number | undefined;
  if (requestedModel && requestedModel !== 'auto') {
    const db = getDb();
    const enabled = db.prepare('SELECT id FROM models WHERE model_id = ? AND enabled = 1').get(requestedModel) as { id: number } | undefined;
    if (enabled) {
      preferredModel = enabled.id;
    } else {
      const disabled = db.prepare('SELECT id FROM models WHERE model_id = ?').get(requestedModel) as { id: number } | undefined;
      const reason = disabled ? 'is disabled' : 'is not in the catalog';
      res.status(400).json({
        error: {
          message: `Model '${requestedModel}' ${reason}. Omit the 'model' field to auto-route, or call /v1/models for the available list.`,
          type: 'invalid_request_error',
          code: 'model_not_found',
        },
      });
      return;
    }
  } else {
    preferredModel = getStickyModel(messages);
  }

  // Retry loop with Staggered Parallel Competitive Routing (Hedged Requests)
  const skipKeys = new Set<string>();
  let lastError: any = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Get up to 3 available, healthy routed options using temp skips
    const routes: RouteResult[] = [];
    const tempSkips = new Set(skipKeys);
    for (let i = 0; i < 3; i++) {
      try {
        const route = routeRequest(estimatedTotal, tempSkips.size > 0 ? tempSkips : undefined, preferredModel, isCoding);
        routes.push(route);
        tempSkips.add(`${route.platform}:${route.modelId}:${route.keyId}`);
      } catch {
        break; // No more keys/models available
      }
    }

    if (routes.length === 0) {
      if (lastError) {
        res.status(429).json({
          error: {
            message: `All models rate-limited. Last error: ${lastError.message}`,
            type: 'rate_limit_error',
          },
        });
      } else {
        res.status(503).json({
          error: { message: 'All models exhausted. Add more API keys or wait for rate limits to reset.', type: 'routing_error' },
        });
      }
      return;
    }

    if (stream) {
      const executeFn = async (r: RouteResult, signal: AbortSignal) => {
        const gen = r.provider.streamChatCompletion(
          r.apiKey, structuredMessages, r.modelId,
          { temperature: finalTemperature, max_tokens, top_p, tools, tool_choice, parallel_tool_calls, signal }
        );

        const iterator = gen[Symbol.asyncIterator]();
        const firstResult = await iterator.next();

        if (firstResult.done) {
          throw new Error('Empty stream response');
        }

        return { iterator, firstChunk: firstResult.value };
      };

      let winner: HedgedRouteResult<{ iterator: any; firstChunk: any }>;
      try {
        winner = await executeHedgedRequests(
          routes,
          executeFn,
          isRetryableError,
          estimatedInputTokens,
          skipKeys,
          recordRequest,
          setCooldown,
          recordRateLimitHit,
          logRequest,
        );
      } catch (err: any) {
        lastError = err;
        console.log(`[Proxy] Staggered stream attempts failed. Retrying...`);
        continue;
      }

      // Stream the winning response chunks to the client
      let totalOutputTokens = 0;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Routed-Via', `${winner.route.platform}/${winner.route.modelId}`);
      if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));

      // Emit first chunk
      const firstText = winner.result.firstChunk.choices?.[0]?.delta?.content ?? '';
      totalOutputTokens += Math.ceil(firstText.length / 4);
      res.write(`data: ${JSON.stringify(winner.result.firstChunk)}\n\n`);

      try {
        while (true) {
          const chunkResult = await winner.result.iterator.next();
          if (chunkResult.done) break;
          const chunk = chunkResult.value;
          const text = chunk.choices?.[0]?.delta?.content ?? '';
          totalOutputTokens += Math.ceil(text.length / 4);
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();

        recordTokens(winner.route.platform, winner.route.modelId, winner.route.keyId, estimatedInputTokens + totalOutputTokens);
        recordSuccess(winner.route.modelDbId);
        setStickyModel(messages, winner.route.modelDbId);
        logRequest(winner.route.platform, winner.route.modelId, 'success', estimatedInputTokens, totalOutputTokens, Date.now() - winner.start, null);
        return;
      } catch (streamErr: any) {
        console.error(`[Proxy] Mid-stream error from ${winner.route.displayName}:`, streamErr.message);
        const payload = { error: { message: `Provider error (${winner.route.displayName}): stream interrupted`, type: 'stream_error' } };
        try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* socket gone */ }
        try { res.write('data: [DONE]\n\n'); res.end(); } catch { /* socket gone */ }
        logRequest(winner.route.platform, winner.route.modelId, 'error', estimatedInputTokens, totalOutputTokens, Date.now() - winner.start, streamErr.message);
        return;
      }
    } else {
      const executeFn = async (r: RouteResult, signal: AbortSignal) => {
        return await r.provider.chatCompletion(
          r.apiKey, structuredMessages, r.modelId,
          { temperature: finalTemperature, max_tokens, top_p, tools, tool_choice, parallel_tool_calls, signal }
        );
      };

      let winner: HedgedRouteResult<any>;
      try {
        winner = await executeHedgedRequests(
          routes,
          executeFn,
          isRetryableError,
          estimatedInputTokens,
          skipKeys,
          recordRequest,
          setCooldown,
          recordRateLimitHit,
          logRequest,
        );
      } catch (err: any) {
        lastError = err;
        console.log(`[Proxy] Staggered non-stream attempts failed. Retrying...`);
        continue;
      }

      const totalTokens = winner.result.usage?.total_tokens ?? 0;
      recordTokens(winner.route.platform, winner.route.modelId, winner.route.keyId, totalTokens);
      recordSuccess(winner.route.modelDbId);
      setStickyModel(messages, winner.route.modelDbId);

      res.setHeader('X-Routed-Via', `${winner.route.platform}/${winner.route.modelId}`);
      if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));
      res.json(winner.result);

      logRequest(
        winner.route.platform, winner.route.modelId, 'success',
        winner.result.usage?.prompt_tokens ?? 0,
        winner.result.usage?.completion_tokens ?? 0,
        Date.now() - winner.start, null,
      );
      return;
    }
  }

  // Exhausted all retries
  res.status(429).json({
    error: {
      message: `All models rate-limited after ${MAX_RETRIES} attempts. Last: ${lastError?.message}`,
      type: 'rate_limit_error',
    },
  });
});

interface HedgedRouteResult<T> {
  result: T;
  route: RouteResult;
  start: number;
}

async function executeHedgedRequests<T>(
  routes: RouteResult[],
  executeFn: (route: RouteResult, signal: AbortSignal) => Promise<T>,
  isRetryable: (err: any) => boolean,
  estimatedInputTokens: number,
  skipKeys: Set<string>,
  recordRequest: (platform: string, modelId: string, keyId: number) => void,
  setCooldown: (platform: string, modelId: string, keyId: number, cooldownMs: number) => void,
  recordRateLimitHit: (modelDbId: number) => void,
  logRequest: (
    platform: string,
    modelId: string,
    status: string,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
    error: string | null,
  ) => void,
): Promise<HedgedRouteResult<T>> {
  return new Promise((resolve, reject) => {
    const controllers = routes.map(() => new AbortController());
    const errors: any[] = [];
    let completedCount = 0;
    let resolved = false;

    const abortAllExcept = (winnerIndex: number) => {
      controllers.forEach((ctrl, i) => {
        if (i !== winnerIndex) ctrl.abort();
      });
    };

    const startRoute = (i: number) => {
      if (resolved || i >= routes.length) return;

      const start = Date.now();
      let nextTimer: NodeJS.Timeout | null = null;
      let nextStarted = false;

      const triggerNext = () => {
        if (nextStarted) return;
        nextStarted = true;
        if (nextTimer) clearTimeout(nextTimer);
        startRoute(i + 1);
      };

      // Set a timer to start the next request in 1.8s (staggered start)
      nextTimer = setTimeout(triggerNext, 1800);

      recordRequest(routes[i].platform, routes[i].modelId, routes[i].keyId);

      executeFn(routes[i], controllers[i].signal)
        .then((result) => {
          if (resolved) return;
          resolved = true;
          if (nextTimer) clearTimeout(nextTimer);
          abortAllExcept(i);
          resolve({ result, route: routes[i], start });
        })
        .catch((err) => {
          if (resolved) return;
          if (nextTimer) clearTimeout(nextTimer);

          const isAborted = controllers[i].signal.aborted;
          if (isAborted) {
            return; // Ignore aborted requests
          }

          // Mark this specific model/key as failed and trigger cooldown
          const skipId = `${routes[i].platform}:${routes[i].modelId}:${routes[i].keyId}`;
          skipKeys.add(skipId);

          const is413 = (err.status ?? err.statusCode) === 413 || 
                        (err.message ?? '').toLowerCase().includes('413') || 
                        (err.message ?? '').toLowerCase().includes('payload too large');
          const cooldownMs = is413 ? 300_000 : 120_000;
          setCooldown(routes[i].platform, routes[i].modelId, routes[i].keyId, cooldownMs);
          recordRateLimitHit(routes[i].modelDbId);
          logRequest(routes[i].platform, routes[i].modelId, 'error', estimatedInputTokens, 0, Date.now() - start, err.message);

          // If it's not retryable, fail immediately!
          if (!isRetryable(err)) {
            resolved = true;
            abortAllExcept(i);
            reject(err);
            return;
          }

          // Trigger next route immediately
          triggerNext();

          errors.push(err);
          completedCount++;

          if (completedCount === routes.length) {
            resolved = true;
            reject(errors[0] ?? new Error('All attempts failed'));
          }
        });
    };

    startRoute(0);
  });
}

function logRequest(
  platform: string,
  modelId: string,
  status: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  error: string | null,
) {
  try {
    const db = getDb();
    // Fix Token Inflation: only record tokens if status is 'success'
    const dbInputTokens = status === 'success' ? inputTokens : 0;
    const dbOutputTokens = status === 'success' ? outputTokens : 0;
    db.prepare(`
      INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(platform, modelId, status, dbInputTokens, dbOutputTokens, latencyMs, error);
  } catch (e) {
    console.error('Failed to log request:', e);
  }
}
