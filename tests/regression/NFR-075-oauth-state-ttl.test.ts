import { after, before, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Redis from 'ioredis';
import { oauthJwksResponse, signOAuthToken } from '../helpers/oauthTokens.js';

type OAuthService = typeof import('../../src/services/oauthService.js');
const providers = ['google', 'linkedin', 'facebook'] as const;
type Provider = typeof providers[number];
const savedEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const epoch = Date.now();
let clock = epoch;
let dataDir: string;
let providerCalls = 0;
const tokens = new Map<Provider, string>();
const csrfError = /^Invalid or expired OAuth state \(CSRF check failed\)$/;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'nfr075-'));
  writeFileSync(join(dataDir, 'store.json'), JSON.stringify({ companies: [], jobs: [], applications: [], users: [], applicants: [], drafts: [], passwordResetTokens: [] }));
  writeFileSync(join(dataDir, 'observability.json'), JSON.stringify({ logs: [] }));
  Object.assign(process.env, { DATA_DIR: dataDir, NODE_ENV: 'test',
    GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret',
    LINKEDIN_CLIENT_ID: 'linkedin-client', LINKEDIN_CLIENT_SECRET: 'linkedin-secret',
    FACEBOOK_CLIENT_ID: 'facebook-client', FACEBOOK_CLIENT_SECRET: 'facebook-secret' });
  mock.method(Date, 'now', () => clock);
  for (const provider of ['google', 'linkedin'] as const) {
    tokens.set(provider, await signOAuthToken({
      iss: provider === 'google' ? 'https://accounts.google.com' : 'https://www.linkedin.com/oauth',
      aud: `${provider}-client`, sub: `${provider}-user`, iat: Math.floor(epoch / 1000), exp: Math.floor(epoch / 1000) + 3600,
      email: `${provider}@example.test`,
    }));
  }
  globalThis.fetch = async input => {
    const url = String(input);
    providerCalls++;
    const jwks = oauthJwksResponse(url);
    if (jwks) return jwks;
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ id_token: tokens.get('google') });
    if (url === 'https://www.linkedin.com/oauth/v2/accessToken') return Response.json({ id_token: tokens.get('linkedin') });
    if (url === 'https://graph.facebook.com/v18.0/oauth/access_token') return Response.json({ access_token: 'offline-access-token' });
    if (url.startsWith('https://graph.facebook.com/v18.0/me?')) return Response.json({ id: 'facebook-user', email: 'facebook@example.test' });
    throw new Error(`Unexpected outbound request: ${url}`);
  };
});

after(() => {
  mock.restoreAll();
  globalThis.fetch = originalFetch;
  rmSync(dataDir, { recursive: true, force: true });
  for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name];
  Object.assign(process.env, savedEnv);
});

for (const backend of ['memory', 'redis-contract'] as const) {
  describe(`NFR-075: ${backend} state semantics`, { concurrency: false }, () => {
    let oauth: OAuthService;
    let redisWrites = 0;
    let cleanup: () => void;
    const records = new Map<string, { value: string; expiresAt: number }>();

    before(async () => {
      if (backend === 'memory') {
        delete process.env.REDIS_URL;
      } else {
        // Contract fake only: no socket or external Redis. Model SETEX expiry and
        // atomic GETDEL consumption, including expired and mismatched records.
        process.env.REDIS_URL = 'redis://unused.invalid:6379';
        mock.method(Redis.prototype, 'connect', async () => undefined);
        mock.method(Redis.prototype, 'setex', async (key: string, seconds: number, value: string) => {
          assert.match(key, /^oauth:state:[a-f0-9]{64}$/);
          assert.equal(seconds, 600);
          records.set(key, { value, expiresAt: clock + seconds * 1000 });
          redisWrites++;
          return 'OK';
        });
        mock.method(Redis.prototype, 'getdel', async (key: string) => {
          const record = records.get(key);
          records.delete(key);
          return record && clock < record.expiresAt ? record.value : null;
        });
      }
      // Capture scheduling without running cleanup: time jumps below never tick
      // timers. Each backend gets its own module-local state map and Redis flag.
      const timer = mock.method(globalThis, 'setInterval', (callback: () => void, milliseconds: number) => {
        assert.equal(milliseconds, 60_000);
        cleanup = callback;
        return { unref() {} };
      });
      try {
        oauth = await import(`../../src/services/oauthService.js?state-ttl=${backend}`);
      } finally {
        timer.mock.restore();
      }
    });

    async function initiate(provider: Provider, next = `/dashboard/jobs?provider=${provider}`) {
      const initiate = { google: oauth.initiateGoogle, linkedin: oauth.initiateLinkedIn, facebook: oauth.initiateFacebook }[provider];
      const beforeWrites = redisWrites;
      const result = await initiate('http://localhost', next);
      assert.equal(redisWrites - beforeWrites, backend === 'redis-contract' ? 1 : 0);
      return new URL(result.redirectTo).searchParams.get('state')!;
    }

    function callback(provider: Provider, state: string) {
      const handle = { google: oauth.handleGoogleCallback, linkedin: oauth.handleLinkedInCallback, facebook: oauth.handleFacebookCallback }[provider];
      return handle('offline-code', state, 'http://localhost');
    }

    async function rejectWithoutEffects(provider: Provider, state: string) {
      const beforeCalls = providerCalls;
      const beforeStore = readFileSync(join(dataDir, 'store.json'), 'utf8');
      const beforeLogs = readFileSync(join(dataDir, 'observability.json'), 'utf8');
      await assert.rejects(callback(provider, state), { message: csrfError });
      assert.equal(providerCalls, beforeCalls, 'invalid state must stop before any provider request');
      assert.equal(readFileSync(join(dataDir, 'store.json'), 'utf8'), beforeStore);
      assert.equal(readFileSync(join(dataDir, 'observability.json'), 'utf8'), beforeLogs);
    }

    for (const provider of providers) {
      for (const age of [599_999, 600_000, 600_001]) {
        test(`${provider}: age ${age}ms ${age < 600_000 ? 'succeeds once' : 'expires and is consumed'} without cleanup`, async () => {
          clock = epoch;
          const state = await initiate(provider);
          clock = epoch + age;
          if (age < 600_000) {
            const result = await callback(provider, state);
            assert.equal(result.next, `/dashboard/jobs?provider=${provider}`);
            assert.equal(typeof result.token, 'string');
          } else {
            await rejectWithoutEffects(provider, state);
          }
          // Rewind to prove deletion, rather than rejection by timestamp alone.
          clock = epoch;
          await rejectWithoutEffects(provider, state);
        });
      }

      test(`${provider}: provider mismatch consumes state and preserves another provider's state`, async () => {
        clock = epoch;
        const other = providers[(providers.indexOf(provider) + 1) % providers.length];
        const state = await initiate(provider);
        const otherState = await initiate(other);
        await rejectWithoutEffects(other, state);
        await rejectWithoutEffects(provider, state);
        const result = await callback(other, otherState);
        assert.equal(result.next, `/dashboard/jobs?provider=${other}`);
        await rejectWithoutEffects(other, otherState);
      });

      test(`${provider}: expiring one state preserves a younger state`, async () => {
        clock = epoch;
        const oldState = await initiate(provider);
        clock = epoch + 1;
        const youngState = await initiate(provider, '/dashboard/applications');
        clock = epoch + 600_000;
        await rejectWithoutEffects(provider, oldState);
        assert.equal((await callback(provider, youngState)).next, '/dashboard/applications');
      });
    }

    if (backend === 'memory') {
      test('periodic cleanup also deletes at exactly 600 seconds', async () => {
        clock = epoch;
        const state = await initiate('google');
        clock = epoch + 600_000;
        cleanup();
        clock = epoch;
        await rejectWithoutEffects('google', state);
      });
    }
  });
}
