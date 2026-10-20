# P1 verification backlog

Local synthetic verification is authorized. Production export, paid services and policy approvals are not. These test stories verify the implementation stories without changing their release gates.

| Order | Test story | Priority |
|---|---|---|
| 1 | [T01 privacy boundaries](story-obs-p1-t01-privacy-boundaries.md) | P0 |
| 2 | [T02 request metrics and context](story-obs-p1-t02-request-metrics-context.md) | P0 |
| 3 | [T03 export reliability](story-obs-p1-t03-export-reliability.md) | P0 |
| 4 | [T04 dependencies, runtime and logs](story-obs-p1-t04-dependencies-runtime-logs.md) | P1 |
| Parallel decision work / final gate | [T05 hosted decisions and acceptance](story-obs-p1-t05-hosted-decisions-acceptance.md) | P0 |

See the [44-AC coverage ledger](../../../features/observability/p1-test-coverage.md) for evidence and unresolved gates. Code checks and hosted/decision checks are separate: successful local tests cannot close a hosted acceptance criterion or approve a proposed policy.

## P2 independent verification

| Test story | Coverage |
|---|---|
| [T01 AI, usage and privacy](story-obs-p2-t01-ai-usage-privacy.md) | Actual model/embedding attempts, usage under sampling, sanitizer |
| [T02 dependencies and workflow](story-obs-p2-t02-dependencies-workflow.md) | Pinecone, JSON/audit store, scheduling and degraded outcomes |
| [T03 cost and diagnosis](story-obs-p2-t03-cost-investigation.md) | Effective-date fixture reports and independent latency investigation |
| [T04 decisions](story-obs-p2-t04-decisions-gates.md) | D07 journey and D08 cost approvals |

The [47-AC P2 ledger](../../../features/observability/p2-test-coverage.md) records every story and feature criterion separately. Local synthetic tests cannot approve journey ownership, finance policy, or production durability.

Independent Codex test run on 2026-10-20: 43/43 focused tests and 338/338 full tests pass. The local Docker backend verifier passes 27/27; invalid scheduling replay exports an OTel ERROR transition span. See the ledger for measured durations, exact token counts, privacy result, and remaining decisions.
