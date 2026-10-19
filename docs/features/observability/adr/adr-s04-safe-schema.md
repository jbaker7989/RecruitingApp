# ADR OBS-P1-S04: Safe attributes and propagation boundaries

**Status:** Implemented against the *proposed* allow-list in [S02](adr-s02-data-governance.md); it is not an approved policy, so AC1 "approved allow-list" stays pending approval.

## Mechanism

Every exporter (OTLP or injected test exporter) is wrapped by `SanitizingSpanExporter` / `SanitizingMetricExporter` (`src/telemetry/privacy.ts`) — the last step before data leaves. It rebuilds each span/metric from allow-listed parts:

- attributes: per-signal key allow-list + per-key validators; identifiers span-only; unknown keys dropped;
- span/event/scope/metric **names** exact-match; events dropped unless registered; exception events stripped; status message removed; `tracestate` removed from span, parent and link contexts; exemplars dropped; metric descriptions blanked;
- resource: only identity keys;
- exporter results reduced to a code (errors may embed URLs/bodies); the SDK diag logger is replaced by a logger that prints a fixed category and counts the fixed SDK message *“Dropped N spans because maxQueueSize reached”* (integer parsed by exact full-match regex; arguments never read).

Errors: `classifyError` maps to `timeout|network|validation|auth|not_found|rate_limit|upstream|parse|aborted|internal` by `name`/`code`/status only (**message never read**), so `src/chains/resumeParsing.ts` errors (message embeds model output) export no content. `recordSafeError` sets status ERROR without message. Provider-specific taxonomies (agent B's `oauth.outcome`) are separate, bounded value enums.

Propagation: inbound `traceparent` ignored by default; when trusted it is regex-validated, ≤55 chars, and `ParentBasedSampler` re-applies the local ratio to remote-sampled parents (a client cannot force unlimited sampling). Outbound `traceparent` only for allow-listed destinations (decision recorded synchronously by the undici `requestHook`); no baggage propagator exists.

## Pending / limits

- Approved allow-list and prohibited-content list (S02).
- Adding a new attribute key, span/metric name or event requires editing `privacy.ts` (or `registerSafeNames` with static literals) — an intentional review gate.
- Logs: agent B's logger has its own redaction; log shipping through the collector is not covered by the span/metric sanitizer.
