import { Router } from 'express';
import { readStore, writeStore, generateId, now, addObservabilityEntry } from '../models/store.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/register - Register new user
router.post('/register', async (req: any, res) => {
  try {
    const store = await readStore();
    const { username, password, email, role } = req.body;

    if (!username || !password || !email || !role) {
      return res.status(400).json({ error: 'All fields required' });
    }

    if (store.users.find(u => u.username === username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const user = {
      id: generateId(),
      username,
      passwordHash: `encrypted_${password}`, // Simple encryption stub
      role,
      email,
      createdAt: now(),
      oauthProvider: null,
    };

    store.users.push(user);
    await writeStore(store);

    res.status(201).json({ id: user.id, username: user.username, role: user.role });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Registration failed' });
  }
});

// POST /api/auth/login - Login user
router.post('/login', async (req: any, res) => {
  try {
    const store = await readStore();
    const { username, password } = req.body;

    const user = store.users.find(u => u.username === username);
    if (!user || user.passwordHash !== `encrypted_${password}`) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = user.id;
    await addObservabilityEntry({
      id: generateId(),
      timestamp: now(),
      action: 'login',
      entityType: 'User',
      entityId: user.id,
      userId: user.id,
      details: { username: user.username },
      outcome: 'success',
    });

    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Login failed' });
  }
});

// POST /api/auth/oauth-stub - OAuth stub endpoint
router.post('/oauth-stub', requireRole(['member-services', 'hiring-manager']), async (req: any, res) => {
  try {
    const store = await readStore();
    const { userId, provider } = req.body;

    const user = store.users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.oauthProvider = provider;
    await writeStore(store);

    res.json({ message: 'OAuth provider configured', provider });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'OAuth setup failed' });
  }
});

export default router;
