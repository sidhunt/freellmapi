import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb, getUnifiedApiKey } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

let dashToken = '';

async function request(app: Express, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  const res = await fetch(url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(isGatedApiPath(path) && !('Authorization' in headers) ? { Authorization: `Bearer ${dashToken}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.text();
  server.close();

  let json: any = null;
  try { json = JSON.parse(data); } catch {}

  return { status: res.status, body: json };
}

function authHeaders() {
  return { Authorization: `Bearer ${getUnifiedApiKey()}` };
}

describe('OpenRouter-shaped GET /v1/models/:model/endpoints', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  beforeEach(async () => {
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();
    // One enabled key makes at least one catalog model routable, so the
    // virtual auto/fusion ids have a non-null context-window ceiling.
    const addKey = await request(app, 'POST', '/api/keys', {
      platform: 'groq',
      key: 'gsk_openrouter_endpoints_test',
      label: 'endpoints-test',
    });
    expect(addKey.status).toBe(201);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the OpenRouter endpoints shape for the virtual "fusion" model', async () => {
    const { status, body } = await request(app, 'GET', '/v1/models/fusion/endpoints', undefined, authHeaders());
    expect(status).toBe(200);
    expect(body.data.id).toBe('fusion');
    expect(Array.isArray(body.data.endpoints)).toBe(true);
    expect(body.data.endpoints.length).toBeGreaterThan(0);
    const ep = body.data.endpoints[0];
    expect(typeof ep.context_length).toBe('number');
    expect(ep.context_length).toBeGreaterThan(0);
    expect(typeof ep.max_completion_tokens).toBe('number');
    expect(typeof ep.tag).toBe('string');
  });

  it('also serves the virtual "auto" model', async () => {
    const { status, body } = await request(app, 'GET', '/v1/models/auto/endpoints', undefined, authHeaders());
    expect(status).toBe(200);
    expect(body.data.endpoints[0].context_length).toBeGreaterThan(0);
  });

  it('requires the unified API key', async () => {
    const { status } = await request(app, 'GET', '/v1/models/fusion/endpoints');
    expect(status).toBe(401);
  });

  it('returns 404 for an unknown model id', async () => {
    const { status, body } = await request(app, 'GET', '/v1/models/not-a-real-model-xyz/endpoints', undefined, authHeaders());
    expect(status).toBe(404);
    expect(body.error.code).toBe(404);
  });
});
