/**
 * Readiness and diagnostics (OBS-P1-S09). `/health` stays the cheap liveness probe;
 * readiness separates required from optional dependencies, caches bounded probes,
 * and exposes no sensitive detail publicly.
 */
import { access, constants } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { getExportHealth, isTelemetryDisabled } from './lifecycle.js';
import { getRuntimeSnapshot } from './runtime.js';
import { getStateStoreMode } from './providerOps.js';
import { logger } from './logger.js';

export type DependencyStatus = 'up' | 'degraded' | 'down';
export type ReadinessStatus = 'ready' | 'degraded' | 'not_ready';

export interface DependencySpec {
  name: string;
  required: boolean;
  check: () => Promise<DependencyStatus> | DependencyStatus;
  timeoutMs?: number;
  ttlMs?: number;
}

export interface ReadinessReport {
  status: ReadinessStatus;
  checked_at: string;
  dependencies: Array<{ name: string; required: boolean; status: DependencyStatus }>;
}

interface Registered extends Required<Omit<DependencySpec, 'check'>> {
  check: DependencySpec['check'];
  cached?: { status: DependencyStatus; at: number };
  inflight?: Promise<DependencyStatus>;
}

const NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_DEPENDENCIES = 16;
const registry = new Map<string, Registered>();

export function registerDependency(spec: DependencySpec): void {
  if (!NAME_RE.test(spec.name)) throw new Error('invalid dependency name');
  if (!registry.has(spec.name) && registry.size >= MAX_DEPENDENCIES) throw new Error('too many dependencies');
  registry.set(spec.name, { timeoutMs: 1000, ttlMs: 5000, ...spec });
}

async function probe(dep: Registered): Promise<DependencyStatus> {
  const t = Date.now();
  if (dep.cached && t - dep.cached.at < dep.ttlMs) return dep.cached.status;
  if (dep.inflight) return dep.inflight;
  dep.inflight = (async () => {
    let status: DependencyStatus;
    let timer: NodeJS.Timeout | undefined;
    try {
      status = await Promise.race([
        Promise.resolve().then(dep.check),
        new Promise<DependencyStatus>((r) => { timer = setTimeout(() => r('down'), dep.timeoutMs); timer.unref?.(); }),
      ]);
    } catch {
      status = 'down';
    } finally {
      if (timer) clearTimeout(timer);
    }
    dep.cached = { status, at: Date.now() };
    dep.inflight = undefined;
    if (status !== 'up') logger.warn('readiness.dependency.not_up', { outcome: status, attrs: { dependency: dep.name, required: dep.required } });
    return status;
  })();
  return dep.inflight;
}

export async function getReadiness(): Promise<ReadinessReport> {
  const deps = [...registry.values()];
  const results = await Promise.all(deps.map(async (d) => ({ name: d.name, required: d.required, status: await probe(d) })));
  let status: ReadinessStatus = 'ready';
  if (results.some((r) => r.required && r.status === 'down')) status = 'not_ready';
  else if (results.some((r) => r.status !== 'up')) status = 'degraded';
  return { status, checked_at: new Date().toISOString(), dependencies: results };
}

/**
 * Defaults. The JSON store check proves the data directory is readable ONLY;
 * it makes no claim that the audit store is durable (NFR-034 remains open).
 */
export function registerDefaultDependencies(): void {
  registerDependency({
    name: 'store',
    required: true,
    check: async () => {
      const dir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(process.cwd(), 'data');
      try {
        await access(dir, constants.R_OK);
        return 'up';
      } catch {
        return 'down';
      }
    },
  });
  registerDependency({
    name: 'oauth_state_store',
    required: false,
    check: () => {
      const mode = getStateStoreMode();
      return mode === 'redis' || mode === 'unconfigured' ? 'up' : 'degraded';
    },
  });
  registerDependency({
    name: 'telemetry_export',
    required: false,
    check: () => {
      if (isTelemetryDisabled()) return 'up'; // explicitly disabled is an operator choice, reported in diagnostics
      const h = Object.values(getExportHealth());
      return h.every((s) => s.state === 'fresh' || s.state === 'never') && h.every((s) => !s.breaker_open) ? 'up' : 'degraded';
    },
  });
}

export async function readinessHandler(_req: Request, res: Response): Promise<void> {
  const report = await getReadiness();
  // Public summary only: names, required flag and status. No messages, hosts, or error text.
  res.status(report.status === 'not_ready' ? 503 : 200).json(report);
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  const m = header?.match(/^Bearer (.+)$/);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Internal diagnostics. Hidden (404) unless TELEMETRY_DIAGNOSTICS_TOKEN is configured and presented. */
export async function diagnosticsHandler(req: Request, res: Response): Promise<void> {
  const expected = process.env.TELEMETRY_DIAGNOSTICS_TOKEN;
  if (!expected || !tokenMatches(req.headers.authorization, expected)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const readiness = await getReadiness();
  res.json({
    readiness,
    runtime: getRuntimeSnapshot(),
    telemetry_export: getExportHealth(),
    telemetry_disabled: isTelemetryDisabled(),
    oauth_state_store: getStateStoreMode(),
    durability_note: 'Readiness reports data-directory access only; it does not assert audit-store durability (NFR-034).',
  });
}

export function resetDependenciesForTests(): void {
  registry.clear();
}
