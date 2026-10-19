# Local observability stack (synthetic data only)

Collector (OTLP/HTTP :4318) → Jaeger (:16686 traces) · Prometheus (:9090 metrics) · Loki (:3100 logs) · Grafana (:3001, datasources provisioned). All ports bind to 127.0.0.1. No cloud account or cost.

```bash
npm run telemetry:stack:up
npm run telemetry:verify      # runs the app with telemetry on, sends synthetic traffic, queries all 3 backends
npm run telemetry:stack:down
```
Manual run: `TELEMETRY_ENABLED=true OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 npm run dev 2>&1 | tee observability/local/logs/app.log` (the collector tails `logs/*.log`; the directory is git-ignored). Never put real applicant data through this stack. `demo-credentials.json` is not read or mounted.
