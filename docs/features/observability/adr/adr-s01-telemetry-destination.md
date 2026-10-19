# ADR OBS-P1-S01: Telemetry destination — PROPOSED OPTIONS, NOT APPROVED

**Status:** Proposed. **No destination, plan, budget, owner or approver has been selected.** Story S01 stays *Blocked* for shared/production export (AC1 approver, AC3 cap, AC4 approval).
**Prepared:** 2026-10-19 from public product knowledge; **all prices/limits below must be re-verified by the budget owner before use** — none were fetched or quoted here.
**Accountable roles (assignee pending):** platform lead + budget owner.

## Requirements the destination must meet

OTLP/HTTP ingest for traces and metrics (the app emits OTLP/HTTP JSON; see S03 ADR); a log path (the app emits JSON lines; collector/agent or OTLP logs); percentile queries over histograms; role-based read/admin; retention/region controls matching S02 (undecided); alert integration (P3); export/fallback strategy; a spend cap or hard ingestion limit.

## Options

| # | Option | Signals / query path | OTLP path | Fit | Gaps / open questions |
|---|---|---|---|---|---|
| A | **Local OSS stack** (OTel Collector + Jaeger + Prometheus + Loki + Grafana) — *implemented, local only* | traces: Jaeger UI/API; metrics: PromQL; logs: LogQL | collector `:4318` | Zero cost; proves instrumentation end-to-end; deterministic for CI/dev | Not a hosted destination: no RBAC/retention/alerting/availability; cannot satisfy preview or production gates |
| B | **Self-hosted OSS on a VM/container platform** (same stack, hosted) | same | OTLP via collector | Full control, predictable infra cost | Operations burden (upgrades, storage, auth, backups); someone must be on-call for the monitoring stack itself; needs S02 residency answers |
| C | **Managed OTLP backend, vendor TBD** (e.g. Grafana Cloud, Honeycomb, Datadog, New Relic, Dash0, Axiom) | traces/metrics/logs in one product; vendor query UI + alerts | vendor OTLP endpoint + API-key header (`OTEL_EXPORTER_OTLP_HEADERS`, already supported, never logged) | Fastest path to dashboards/alerts/SLOs (P3) | Pricing model and quotas differ (per GB / per host / per span); need plan, region, retention, RBAC, egress; D01/D02 unresolved |
| D | **Vercel-native observability + a Vercel Marketplace integration** | Vercel logs/metrics for the deployment; Marketplace products for deeper traces | depends on integration | Lowest provisioning friction on the current Vercel deployment | Capability gaps for custom histograms/trace search unverified; vendor lock-in; must check what plan the team has |

**Engineering recommendation (not a decision):** keep A for development/CI (done); evaluate **one** managed OTLP vendor (option C, or D if it covers histogram queries and log search) with the synthetic proof script `npm run telemetry:verify` pointed at a *trial* tenant — only after the budget owner approves a trial. The application needs no code change to switch: set `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` and `TELEMETRY_ALLOW_REMOTE_EXPORT=true` in deployment secret storage.

## Evidence recorded (local, synthetic, option A)

Environment: Docker Compose, images pinned in `observability/local/docker-compose.yml`; app run with `TELEMETRY_ENVIRONMENT=local`. `npm run telemetry:verify` sends 3×200, 2×401, 1×404 and then queries:

| AC2 query | Result (observed 2026-10-19) |
|---|---|
| one trace — Jaeger `/api/traces?service=rec-app` | 6 traces, server spans with `http.route`, `app.outcome`, no URLs/headers |
| one histogram — Prometheus `sum(http_server_request_duration_seconds_count)` and `histogram_quantile(0.95,…)` | count = 6 (matches fixture); p95 query succeeds |
| one structured log lookup — Loki `{service_name="rec-app"}` | JSON log lines present (via collector `filelog`) |

Metrics and logs use **separate pipelines** (OTLP metrics export from the SDK; logs via stdout JSON tailed by the collector). A hosted vendor may accept OTLP logs directly; that is unverified and out of scope until B/C is approved.

## Cost worksheet (AC3) — inputs only, no numbers invented

Local stack cost: $0. For a hosted option the budget owner must supply: expected requests/day, spans per request (≈1 server + outbound/Redis), sampling ratio, metric series count (bounded: ≤ `TELEMETRY_MAX_ROUTES`(200) × methods × status classes × features), log lines/day and bytes/line, retention days, users with seats, synthetic-check count, status-page tier. Formula to apply at expected and 10× traffic: `ingest_GB = (spans/day×~1 KB + log_lines/day×bytes + series×samples/day×~50 B)/1e9`; multiply by the vendor's per-GB/host rate and add seats and egress. The numeric monthly cap and warning thresholds are **an open approval item**.

## Approval record (to complete — do not fill in without the approver)

| Field | Value |
|---|---|
| Selected destination(s) | _pending_ |
| Plan / region | _pending_ |
| Funding & monthly cap, warning thresholds | _pending_ |
| Service owner / approver / provisioning owner | _pending_ |
| Fallback / export strategy | _pending_ (OTLP is vendor-neutral; Option A is the local fallback) |
| Review date | _pending_ |

Until approved: hosted export is disabled by default (`TELEMETRY_ENABLED=false`) and refused for non-loopback endpoints unless `TELEMETRY_ALLOW_REMOTE_EXPORT=true`.
