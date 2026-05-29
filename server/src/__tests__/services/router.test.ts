import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { routeRequest } from '../../services/router.js';

describe('Router', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();
    // Reset fallback order to intelligence ranking
    const models = db.prepare('SELECT id, intelligence_rank FROM models ORDER BY intelligence_rank ASC').all() as any[];
    const update = db.prepare('UPDATE fallback_config SET priority = ? WHERE model_db_id = ?');
    for (let i = 0; i < models.length; i++) {
      update.run(i + 1, models[i].id);
    }
  });

  it('should throw when no keys are configured', () => {
    expect(() => routeRequest()).toThrow(/exhausted/i);
  });

  it('should route to highest priority model with available key', () => {
    const db = getDb();
    const { encrypted, iv, authTag } = encrypt('test-groq-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('groq', 'test', encrypted, iv, authTag, 'healthy', 1);

    const result = routeRequest();
    expect(result.platform).toBe('groq');
    expect(result.apiKey).toBe('test-groq-key');
  });

  it('should prefer higher-priority model when keys exist for multiple platforms', () => {
    const db = getDb();

    const googleKey = encrypt('test-google-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('google', 'test', googleKey.encrypted, googleKey.iv, googleKey.authTag, 'healthy', 1);

    const groqKey = encrypt('test-groq-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('groq', 'test', groqKey.encrypted, groqKey.iv, groqKey.authTag, 'healthy', 1);

    // Post-V6: Google's gemini-3.1-pro-preview (rank 1, free-tier-eligible per
    // probe on 2026-04-25) outranks Groq's best free-tier model openai/gpt-oss-120b
    // (rank 6). With keys for both platforms, Google wins.
    const result = routeRequest();
    expect(result.platform).toBe('google');
  });

  it('should skip disabled keys', () => {
    const db = getDb();

    const googleKey = encrypt('test-google-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('google', 'disabled', googleKey.encrypted, googleKey.iv, googleKey.authTag, 'healthy', 0);

    const groqKey = encrypt('test-groq-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('groq', 'test', groqKey.encrypted, groqKey.iv, groqKey.authTag, 'healthy', 1);

    const result = routeRequest();
    expect(result.platform).toBe('groq');
  });

  it('should skip invalid keys', () => {
    const db = getDb();

    const invalidKey = encrypt('invalid-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('google', 'invalid', invalidKey.encrypted, invalidKey.iv, invalidKey.authTag, 'invalid', 1);

    const groqKey = encrypt('test-groq-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('groq', 'test', groqKey.encrypted, groqKey.iv, groqKey.authTag, 'healthy', 1);

    const result = routeRequest();
    expect(result.platform).toBe('groq');
  });

  it('should skip groq and github models when estimatedTokens > 8000', () => {
    const db = getDb();

    // Insert keys for google, groq, and github
    const googleKey = encrypt('test-google-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('google', 'test', googleKey.encrypted, googleKey.iv, googleKey.authTag, 'healthy', 1);

    const groqKey = encrypt('test-groq-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('groq', 'test', groqKey.encrypted, groqKey.iv, groqKey.authTag, 'healthy', 1);

    const githubKey = encrypt('test-github-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('github', 'test', githubKey.encrypted, githubKey.iv, githubKey.authTag, 'healthy', 1);

    // Call routeRequest with estimatedTokens > 8000
    const result = routeRequest(9000);
    expect(result.platform).toBe('google');
    expect(result.apiKey).toBe('test-google-key');
  });

  it('should prioritize google models when estimatedTokens > 8000 even if fallback priority says otherwise', () => {
    const db = getDb();

    const googleKey = encrypt('test-google-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('google', 'test', googleKey.encrypted, googleKey.iv, googleKey.authTag, 'healthy', 1);

    const cohereKey = encrypt('test-cohere-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('cohere', 'test', cohereKey.encrypted, cohereKey.iv, cohereKey.authTag, 'healthy', 1);

    const googleModel = db.prepare("SELECT id FROM models WHERE platform = 'google' AND enabled = 1").get() as any;
    const cohereModel = db.prepare("SELECT id FROM models WHERE platform = 'cohere' AND enabled = 1").get() as any;

    if (googleModel && cohereModel) {
      db.prepare('UPDATE fallback_config SET priority = 1 WHERE model_db_id = ?').run(cohereModel.id);
      db.prepare('UPDATE fallback_config SET priority = 2 WHERE model_db_id = ?').run(googleModel.id);

      // Normal request should route to Cohere because priority is 1
      const resultNormal = routeRequest(100);
      expect(resultNormal.platform).toBe('cohere');

      // > 8000 request should prioritize Google (Gemini) even though priority is 2
      const resultLarge = routeRequest(9000);
      expect(resultLarge.platform).toBe('google');
    }
  });

  it('should skip other keys of the same model once a key fails', () => {
    const db = getDb();
    try {
      // Find the first enabled model
      const firstModel = db.prepare(`
        SELECT m.* FROM fallback_config fc
        JOIN models m ON fc.model_db_id = m.id
        WHERE fc.enabled = 1 AND m.enabled = 1
        ORDER BY fc.priority ASC LIMIT 1
      `).get() as any;

      // Find a second enabled model on a different platform (to avoid key sharing)
      const secondModel = db.prepare(`
        SELECT m.* FROM fallback_config fc
        JOIN models m ON fc.model_db_id = m.id
        WHERE fc.enabled = 1 AND m.enabled = 1 AND m.id != ? AND m.platform != ?
        ORDER BY fc.priority ASC LIMIT 1
      `).get(firstModel.id, firstModel.platform) as any;

      // Disable all other models so only these two can be considered
      db.prepare('UPDATE models SET enabled = 0').run();
      db.prepare('UPDATE models SET enabled = 1 WHERE id IN (?, ?)').run(firstModel.id, secondModel.id);

      // Clear all keys and insert two keys for firstModel, and one for secondModel
      db.prepare('DELETE FROM api_keys').run();
      
      const key1 = encrypt('key-1');
      const key2 = encrypt('key-2');
      const key3 = encrypt('key-3');
      
      db.prepare(`
        INSERT INTO api_keys (id, platform, label, encrypted_key, iv, auth_tag, status, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(101, firstModel.platform, 'key1', key1.encrypted, key1.iv, key1.authTag, 'healthy', 1);

      db.prepare(`
        INSERT INTO api_keys (id, platform, label, encrypted_key, iv, auth_tag, status, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(102, firstModel.platform, 'key2', key2.encrypted, key2.iv, key2.authTag, 'healthy', 1);

      db.prepare(`
        INSERT INTO api_keys (id, platform, label, encrypted_key, iv, auth_tag, status, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(103, secondModel.platform, 'key3', key3.encrypted, key3.iv, key3.authTag, 'healthy', 1);

      // Call routeRequest - should return firstModel with one of the keys
      const result1 = routeRequest(100);
      expect(result1.modelDbId).toBe(firstModel.id);
      const usedKeyId = result1.keyId;

      // Simulate key failure on usedKeyId by adding to skipKeys.
      // The router should skip firstModel entirely and route to secondModel (key 103),
      // instead of trying the remaining healthy key of firstModel.
      const skipId = `${firstModel.platform}:${firstModel.model_id}:${usedKeyId}`;
      const skipKeys = new Set<string>([skipId]);
      const result2 = routeRequest(100, skipKeys);
      expect(result2.modelDbId).toBe(secondModel.id);
      expect(result2.keyId).toBe(103);
    } finally {
      // Restore pristine database state
      initDb(':memory:');
    }
  });

  it('should prioritize models of same category and closest rank on failure', () => {
    const db = getDb();
    try {
      // Clear fallback configs and insert custom models to avoid dependency on seeded models
      db.prepare('DELETE FROM fallback_config').run();
      db.prepare('DELETE FROM models').run();
      db.prepare('DELETE FROM api_keys').run();

      const insertModel = db.prepare(`
        INSERT OR IGNORE INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, enabled)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `);

      // Model A (The one that fails)
      const resA = insertModel.run('google', 'model-a', 'Model A', 5, 1, 'Frontier');
      const idA = resA.lastInsertRowid;

      // Model B (Same category, rank 10 - diff 5)
      const resB = insertModel.run('groq', 'model-b', 'Model B', 10, 1, 'Frontier');
      const idB = resB.lastInsertRowid;

      // Model C (Different category, rank 6 - diff 1)
      const resC = insertModel.run('cerebras', 'model-c', 'Model C', 6, 1, 'Large');
      const idC = resC.lastInsertRowid;

      // Model D (Same category, rank 7 - diff 2)
      const resD = insertModel.run('sambanova', 'model-d', 'Model D', 7, 1, 'Frontier');
      const idD = resD.lastInsertRowid;

      // Fallback Priorities: C (1), B (2), D (3), A (4)
      const insertFallback = db.prepare(`
        INSERT INTO fallback_config (model_db_id, priority, enabled)
        VALUES (?, ?, 1)
      `);
      insertFallback.run(idC, 1);
      insertFallback.run(idB, 2);
      insertFallback.run(idD, 3);
      insertFallback.run(idA, 4);

      // Insert api keys
      const keyA = encrypt('key-a');
      const keyB = encrypt('key-b');
      const keyC = encrypt('key-c');
      const keyD = encrypt('key-d');

      db.prepare(`INSERT INTO api_keys (id, platform, label, encrypted_key, iv, auth_tag) VALUES (?, ?, ?, ?, ?, ?)`).run(201, 'google', 'key-a', keyA.encrypted, keyA.iv, keyA.authTag);
      db.prepare(`INSERT INTO api_keys (id, platform, label, encrypted_key, iv, auth_tag) VALUES (?, ?, ?, ?, ?, ?)`).run(202, 'groq', 'key-b', keyB.encrypted, keyB.iv, keyB.authTag);
      db.prepare(`INSERT INTO api_keys (id, platform, label, encrypted_key, iv, auth_tag) VALUES (?, ?, ?, ?, ?, ?)`).run(203, 'cerebras', 'key-c', keyC.encrypted, keyC.iv, keyC.authTag);
      db.prepare(`INSERT INTO api_keys (id, platform, label, encrypted_key, iv, auth_tag) VALUES (?, ?, ?, ?, ?, ?)`).run(204, 'sambanova', 'key-d', keyD.encrypted, keyD.iv, keyD.authTag);

      // Verify normal routing chooses priority 1 (Model C)
      const resultNormal = routeRequest(100);
      expect(resultNormal.modelId).toBe('model-c');

      // Now route with Model A failed.
      // Expected sorted order of remaining:
      // 1. Model D (Same category 'Frontier', rank 7 is closer to 5 than rank 10)
      // 2. Model B (Same category 'Frontier', rank 10)
      // 3. Model C (Different category 'Large', even though priority is 1)
      const skipKeys = new Set<string>(['google:model-a:201']);
      const resultFallback = routeRequest(100, skipKeys);
      expect(resultFallback.modelId).toBe('model-d');
    } finally {
      // Restore pristine database state
      initDb(':memory:');
    }
  });
});
