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
