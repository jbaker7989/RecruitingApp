import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
import { resolve } from 'path';
import dashboardRouter from './routes/dashboard.js';
import { initializeStore, readStore, addObservabilityEntry, generateId, now } from './models/store.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler } from './middleware/auth.js';
import jobRoutes from './routes/jobs.js';
import applicationRoutes from './routes/applications.js';
import companyRoutes from './routes/companies.js';
import applicantRoutes from './routes/applicants.js';
import authRoutes from './routes/auth.js';
import mcpRoutes from './routes/mcp.js';
import agentRoutes from './routes/agents/index.js';
import { handleFileUpload } from './middleware/fileUpload.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Resolve project root (works from both src/ and dist/)
const projectRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

// Static assets from public/ (images, css)
app.use(express.static(resolve(projectRoot, 'public')));

// EJS view engine — templates in project views/
app.set('view engine', 'ejs');
app.set('views', resolve(projectRoot, 'views'));

app.use('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'New Fronteir Recruiting API', timestamp: new Date().toISOString() });
});

// Dashboard UI — cookie-based auth, mounts before global JWT middleware
app.use('/dashboard', dashboardRouter);

// Mount public routes before the global authenticate middleware so their
// static paths (register, login) don't require auth.
// Protected paths within those routers use their own route-level middleware.
app.use('/api/applicants', applicantRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/', authenticate);
app.use('/api/jobs', jobRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/agents', handleFileUpload, agentRoutes);

app.get('/', (_req, res) => {
  res.json({ message: 'New Fronteir Recruiting API', version: '1.0.0' });
});

app.use(errorHandler);

async function start() {
  await initializeStore();
  await addObservabilityEntry({
    id: generateId(),
    timestamp: now(),
    action: 'startup',
    entityType: 'System',
    entityId: 'server',
    userId: 'system',
    details: { message: 'Server started', version: '1.0.0' },
    outcome: 'success',
  });
  app.listen(PORT, () => {
    console.log(`🚀 New Fronteir Recruiting server running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   MCP: http://localhost:${PORT}/api/mcp/health`);
  });
}

export { app, start };
export default app;

// Entrypoint guard (NFR-002): invoke start() only when this module is executed
// directly (`tsx src/index.ts` / `node dist/index.js`), not when it is imported
// as a library (tests, tooling). realpath on both sides neutralizes symlink
// differences (e.g. npx shims, /var vs /private/var).
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  start().catch((err) => {
    console.error('Failed to start server', err);
    process.exit(1);
  });
}
