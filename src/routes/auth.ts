import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { readStore, writeStore, generateId, now, addObservabilityEntry } from '../models/store.js';
import { requireRole, AuthRequest } from '../middleware/auth.js';
import { signUserToken, verifyUserToken } from '../services/tokenService.js';
import { revokeToken, revokeAllForUser } from '../services/revocationService.js';

const BCRYPT_ROUNDS = 10; // ~100ms hash on modern hardware — adequate for production
const userPasswordHash = (password: string): Promise<string> => bcrypt.hash(password, BCRYPT_ROUNDS);
const userPasswordVerify = (password: string, hash: string): Promise<boolean> => bcrypt.compare(password, hash);

const router = Router();

// POST /api/auth/register - Register new user
router.post('/register', async (req: any, res) => {
  try {
    const store = await readStore();
    const { username, password, email, role } = req.body;

    if (!username || !password || !email || !role) {
      return res.status(400).json({ error: 'All fields required' });
    }

    if (store.users.find((u: { username: string }) => u.username === username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const user = {
      id: generateId(),
      username,
      passwordHash: await userPasswordHash(password), // bcrypt hash
      role,
      email,
      companyId: req.body.companyId,
      createdAt: now(),
      oauthProvider: null,
    };

    store.users.push(user);
    await writeStore(store);

    const token = await signUserToken(user.id, user.role, user.companyId);
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'token_issued',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      details: { username: user.username, tokenType: 'jwt' },
      outcome: 'success',
    });
    res.status(201).json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Registration failed' });
  }
});

// POST /api/auth/login - Login user
router.post('/login', async (req: any, res) => {
  try {
    const store = await readStore();
    const { username, password } = req.body;

    const user = store.users.find((u: { username: string }) => u.username === username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // Migrate legacy encrypted_<password> stub on first successful login
    if (user.passwordHash.startsWith('encrypted_')) {
      const legacy = user.passwordHash.slice('encrypted_'.length);
      if (legacy !== password) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      user.passwordHash = await userPasswordHash(password);
      await writeStore(store);
    } else if (!(await userPasswordVerify(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = await signUserToken(user.id, user.role, user.companyId);
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'token_issued',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      details: { username: user.username, tokenType: 'jwt' },
      outcome: 'success',
    });

    res.json({ token, expiresIn: 28800, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Login failed' });
  }
});

// POST /api/auth/oauth-stub - OAuth stub endpoint
router.post('/oauth-stub', requireRole(['member-services', 'hiring-manager']), async (req: any, res) => {
  try {
    const store = await readStore();
    const { userId, provider } = req.body;

    const user = store.users.find((u: { id: string }) => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.oauthProvider = provider;
    await writeStore(store);

    res.json({ message: 'OAuth provider configured', provider });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'OAuth setup failed' });
  }
});

// GET /api/auth/me — returns current user info; requires auth
router.get('/me', async (req: any, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No authentication token provided' });
  try {
    const { verifyUserToken } = await import('../services/tokenService.js');
    const result = await verifyUserToken(token);
    const store = await readStore();
    const user = store.users.find((u: { id: string }) => u.id === result.sub);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ id: user.id, username: user.username, role: user.role, email: user.email });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// PATCH /api/auth/me — update current user (password change triggers token revocation)
router.patch('/me', async (req: any, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No authentication token provided' });
  try {
    const payload = await verifyUserToken(token);
    const store = await readStore();
    const index = store.users.findIndex((u: { id: string }) => u.id === payload.sub);
    if (index === -1) return res.status(404).json({ error: 'User not found' });

    const { password, ...rest } = req.body;
    if (password) {
      // Password change — revoke all tokens for this user
      await revokeAllForUser(payload.sub, 'User', payload.jti, 28800);
      store.users[index] = {
        ...store.users[index],
        passwordHash: await userPasswordHash(password),
        ...rest,
      };
    } else {
      store.users[index] = { ...store.users[index], ...rest };
    }

    await writeStore(store);

    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'profile_updated',
      entityType: 'User',
      entityId: payload.sub,
      userId: payload.sub,
      details: { fields: Object.keys(req.body) },
      outcome: 'success',
    });

    res.json({ id: store.users[index].id, username: store.users[index].username, role: store.users[index].role, email: store.users[index].email });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('revoked')) return res.status(401).json({ error: 'Token has been revoked' });
    res.status(401).json({ error: 'Invalid token' });
  }
});

// POST /api/auth/logout — revoke current token
router.post('/logout', async (req: any, res) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No authentication token provided' });
  try {
    const payload = await verifyUserToken(token);
    await revokeToken(payload.jti, 28800, payload.sub, 'User');
    res.json({ message: 'Logged out successfully' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('revoked')) return res.status(401).json({ error: 'Token has been revoked' });
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
