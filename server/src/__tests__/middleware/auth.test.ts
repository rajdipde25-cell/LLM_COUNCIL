import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Express } from 'express';
import express from 'express';
import { authMiddleware } from '../../middleware/auth.js';

async function request(app: Express, method: string, path: string, headers?: Record<string, string>) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body: data };
}

describe('Auth Middleware', () => {
  let app: Express;
  const originalEnv = { ...process.env };

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api', authMiddleware);
    app.get('/api/settings/api-key', (req, res) => res.json({ apiKey: 'unlocked-key' }));
    app.get('/api/settings/auth-status', (req, res) => res.json({ passwordRequired: true }));
    app.get('/api/keys', (req, res) => res.json([{ id: 1 }]));
    app.post('/api/keys', (req, res) => res.json({ success: true }));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows all requests when ADMIN_PASSWORD is not configured', async () => {
    delete process.env.ADMIN_PASSWORD;

    const keyRes = await request(app, 'GET', '/api/settings/api-key');
    expect(keyRes.status).toBe(200);
    expect(keyRes.body.apiKey).toBe('unlocked-key');

    const writeRes = await request(app, 'POST', '/api/keys');
    expect(writeRes.status).toBe(200);
  });

  it('allows GET /api/settings/api-key even when ADMIN_PASSWORD is set (no-op)', async () => {
    process.env.ADMIN_PASSWORD = 'super-secret-password';

    // Missing header
    const missingRes = await request(app, 'GET', '/api/settings/api-key');
    expect(missingRes.status).toBe(200);

    // Wrong password
    const wrongRes = await request(app, 'GET', '/api/settings/api-key', { 'X-Admin-Password': 'wrong' });
    expect(wrongRes.status).toBe(200);

    // Correct password
    const correctRes = await request(app, 'GET', '/api/settings/api-key', { 'X-Admin-Password': 'super-secret-password' });
    expect(correctRes.status).toBe(200);
    expect(correctRes.body.apiKey).toBe('unlocked-key');
  });

  it('allows POST /api/keys even when ADMIN_PASSWORD is set (no-op)', async () => {
    process.env.ADMIN_PASSWORD = 'super-secret-password';

    // Missing header
    const missingRes = await request(app, 'POST', '/api/keys');
    expect(missingRes.status).toBe(200);

    // Wrong password
    const wrongRes = await request(app, 'POST', '/api/keys', { 'X-Admin-Password': 'wrong' });
    expect(wrongRes.status).toBe(200);

    // Correct password
    const correctRes = await request(app, 'POST', '/api/keys', { 'X-Admin-Password': 'super-secret-password' });
    expect(correctRes.status).toBe(200);
  });

  it('allows read-only endpoints GET /api/keys and GET /api/settings/auth-status even when ADMIN_PASSWORD is set', async () => {
    process.env.ADMIN_PASSWORD = 'super-secret-password';

    const keysRes = await request(app, 'GET', '/api/keys');
    expect(keysRes.status).toBe(200);
    expect(keysRes.body).toHaveLength(1);

    const statusRes = await request(app, 'GET', '/api/settings/auth-status');
    expect(statusRes.status).toBe(200);
  });
});
