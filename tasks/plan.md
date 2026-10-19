# Implementation plan: OBS-001 observability

**Status:** P1 local synthetic implementation authorized and completed for review; production policy/performance/preview acceptance remains open. P2/P3 remain proposed.
**Scope confirmed:** critical journeys and all three external-visibility categories. Vendor, budgets, policy, SLO targets and owners await gated decisions.
**Canonical specification:** [Observability backlog](../docs/features/observability/README.md).

## Architecture and scope

Preserve the three phases of OBS-001. Add safe privacy controls before first export, an explicit metrics/log pipeline in P1, actual custom-operation/AI accounting in P2, and accountable operational/external readiness in P3. OpenTelemetry supplements the audit trail. Runtime compatibility and backend signal capabilities require proof. NFR-034 remains a separate production mutation blocker.

## Ordered delivery

Follow the [story checklist](todo.md), the per-story dependency graph and each feature's delivery order. Resolve P0 decision stories early. Implementation slices must preserve their parent AC IDs; split large stories after the compatibility/coverage spikes rather than treating a phase as one task. No schedule commitment is made before sizing and provisioning decisions.

## Risks and checkpoints

See the [detailed review](../docs/features/observability/review-opentelemetry-proposal.md) for risks and corrections, and the [shared acceptance contract](../docs/features/observability/README.md#shared-acceptance-contract) for release checkpoints. Major risks are unsafe payload export, missing serverless telemetry, inaccurate sampled metrics, unknown costs, unstaffed alerts and confusing telemetry with durable persistence.

## Outstanding questions

[D01–D15](../docs/features/observability/README.md#decision-register-and-release-gates) are tracked by explicit prioritized stories. An unresolved decision blocks only its named gate. Future capabilities receive a disposition and adoption trigger before dependent implementation begins.
