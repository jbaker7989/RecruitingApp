import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';

// Process-local keys; tests exercise real verification without provider credentials.
const keyPair = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(keyPair.publicKey), kid: 'oauth-test-key', alg: 'RS256', use: 'sig' };

export function oauthJwksResponse(url: unknown): Response | undefined {
  if (['https://www.googleapis.com/oauth2/v3/certs', 'https://www.linkedin.com/oauth/openid/jwks'].includes(String(url))) {
    return Response.json({ keys: [jwk] });
  }
}

export async function signOAuthToken(payload: JWTPayload, options: { wrongKey?: boolean; kid?: string; alg?: string } = {}) {
  const key = options.wrongKey ? (await generateKeyPair('RS256')).privateKey : keyPair.privateKey;
  return new SignJWT(payload).setProtectedHeader({ alg: options.alg ?? 'RS256', kid: options.kid ?? jwk.kid }).sign(key);
}
