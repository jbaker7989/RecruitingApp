import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeStore, readStore, addObservabilityEntry, generateId, now } from './models/store.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler } from './middleware/auth.js';
import jobRoutes from './routes/jobs.js';
import applicationRoutes from './routes/applications.js';
import companyRoutes from './routes/companies.js';
import applicantRoutes from './routes/applicants.js';
import authRoutes from './routes/auth.js';
import mcpRoutes from './routes/mcp.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/health', (_req, res) => {
  res.json({ status: 'ok', message: 'New Fronteir Recruiting API', timestamp: new Date().toISOString() });
});

app.use('/', authenticate);
app.use('/api/jobs', jobRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/applicants', applicantRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/mcp', mcpRoutes);

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
