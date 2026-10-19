# ADR OBS-P1-S05: HTTP request rate, errors, duration

**Status:** Implemented and locally verified; dashboard AC5 and hosted-query evidence pending S01.

- **Instrument:** histogram `http.server.request.duration`, unit seconds, monotonic `process.hrtime.bigint()`, explicit buckets `[0.005 … 60]` (13 boundaries). Count = request count; p50/p95/p99 via `histogram_quantile` over the bucket series; resolution is bucket-limited (interpolated within a bucket).
- **Exactly once:** `finish`/`close` guarded by a flag; client disconnect before the response completes is `app.outcome=aborted`, `app.status_class=aborted`.
- **Dimensions (bounded):** `http.request.method` (enum), `http.route` (template, `unmatched`, `other`; ≤ `TELEMETRY_MAX_ROUTES` distinct), `app.status_class`, `app.outcome`, `app.feature`, `app.environment`, `app.traffic`. Request ids and raw paths are never labels.
- **Full population:** metrics do not depend on the trace sampler (test: ratio 0 gives identical histograms).
- **Rules:** `/health` (configurable) and static assets are excluded from RED and counted in `app.http.server.excluded_requests{app.reason}`. Expected 4xx (auth/validation) are included as `client_error` and are **not** in the error-rate numerator; error rate = `server_error / total`. `x-telemetry-synthetic: 1` relabels `app.traffic=synthetic` only (forgeable, so never excludes).
- **Known limitation:** requests rejected by a router-less middleware (e.g. global `authenticate` 401) have no `req.route`, so they are labelled route `unmatched`.
- **Dashboard labelling (AC5):** panels must be titled "Server processing duration (excludes network/browser/queue time, excludes /health and static)" and must distinguish "no samples" (Prometheus empty result) from "telemetry stale" (B's export-health `stale|never` state). No dashboard has been built; **AC5 stays pending**.

Example queries: `sum(rate(http_server_request_duration_seconds_count[5m]))`; `sum(rate(...{app_outcome="server_error"}[5m]))/sum(rate(...[5m]))`; `histogram_quantile(0.95, sum by (le,http_route)(rate(http_server_request_duration_seconds_bucket[5m])))`.
