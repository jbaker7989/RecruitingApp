# NFR-SLOP-S06: Dependency, Image and Repository Hygiene

**Status:** Proposed — **owner decisions required before implementation** (several items may be intentional)
**Priority:** Medium (P2) for dependencies/image; Low (P3) for repository clutter
**Size:** M (3–6h) — small edits, but each removal needs a keep/delete decision and a CI/Docker proof
**Tracks:** NFR-027 (`fileUpload.ts`/`express-fileupload`), NFR-035 (delivery)
**Parent:** [Code hygiene remediation](README.md)

## Problem

Dev tooling, an unused framework, demo scripts and local-agent artifacts are mixed into the production dependency tree, the Docker image and the repository root.

## A. Dependencies

| Package | Finding | Proposed action |
|---|---|---|
| `@langchain/langgraph` (`dependencies`) | No import anywhere in `src/`, `tests/`, `scripts/`. The README already states "LangGraph is a dependency, not a claim that the current scheduling flow executes through it." `src/agents/README.md` still describes "LangChain/LangGraph-based agentic workflows". | Remove the dependency and correct both documents, **or** record the decision to adopt it and link the story. A multi-hundred-package transitive tree for an unused import is attack surface and install time. |
| `@earendil-works/pi-coding-agent` (`dependencies`, ~153 MB installed) | Used only by the `"pi": "pi"` developer script. It is a coding-agent CLI, not application code. | Move to `devDependencies` (or remove the script). Confirm `agent-home/` workflow still works. |
| `@types/bcryptjs` (`dependencies`) | `bcryptjs` 3.0.3 ships its own `types.d.ts`; the `@types` package is redundant and, as a *runtime* dependency, mis-classified. | Remove after `npm run typecheck`. |
| `express-fileupload` + `@types/express-fileupload` | Now wired at `src/index.ts:75` for `/api/agents`; the NFR-027 text calling it unwired is stale. `fileUpload.ts` writes `useTempFiles` to a hard-coded `/tmp/`. | Keep; update NFR-027 text; make `tempFileDir` configurable and confirm temp files are removed (resume PII on disk). |

## B. Docker image

The production stage copies the builder's whole `/app/node_modules` (`Dockerfile`: `COPY --from=builder … /app/node_modules`). That includes **all devDependencies** (`eslint`, `tsx`, Babel, type packages, and today the 153 MB coding-agent CLI), because the builder ran plain `npm ci`. The runtime image is therefore larger than needed and carries tooling that has no business running next to applicant data.

Related observations that are **out of scope for this story but must be triaged**: the image bakes placeholder `JWT_SECRET`/`APPLICANT_JWT_SECRET` into a `.env` file and sets `ALLOW_JSON_STORE=true`. The comments explain the intent (dev only; production skips dotenv), but a JSON-store opt-in baked into the production stage conflicts with the durable-PostgreSQL direction (NFR-DATA-001/002). Raise as its own bug if not already tracked.

## C. Repository root and tracked artifacts

| Item | Evidence | Question for owner |
|---|---|---|
| File named `create documents detailing the 2 UX prototype looks. be detailed and create gif or video's where necessary…` (10 KB, repo root) | A *prompt used as a filename*, committed in a072085. Not referenced anywhere. | Move its content under `docs/` with a proper name (e.g. UX prototype brief) or delete. |
| `proposal-comparison.html` (22 KB) | Referenced only by three dashboard stories as design evidence. | Move to `docs/design/` and fix the three links, or delete. |
| `demo.sh`, `demo-auth.cjs`, `rbac-demo.cjs`, `seed-dashboard.cjs` | No references; they are `.cjs` at root, outside the lint script's scope (so they show 30+ `no-undef` errors if linted). `seed-dashboard.cjs` and `demo-auth.cjs` write demo accounts. | Move to `scripts/dev/` with a README line, lint them (S07), or delete. Verify none embeds a credential. |
| `data/store.json`, `data/observability.json` (tracked) | `.gitignore` lists both, but they are force-tracked (`!data/store.json` exceptions) and hold demo users/companies/jobs plus ~37 KB of audit entries. `data/SKILL.md` documents JSON persistence that PostgreSQL has replaced. | Replace with a minimal seed fixture under `tests/fixtures/` or `scripts/`, or keep with a header comment stating it is synthetic. Confirm no real data and no password hashes (the demo users currently carry none). |
| Skill stubs: `applicant-management/`, `applications-management/`, `dev-testing-management/`, `job-management/`, `data/SKILL.md` | Single-file directories at the root, referenced from `brain/brain.md`/`BUGS.md`; text still says "Fronteir" and "JSON file-based persistence". | Consolidate under `.agents/skills/` or `docs/domain/`, update stale content, or delete. |
| `agent-home/` (12 tracked files incl. `bin/fd`, `bin/rg` binaries, a Python `candidate_screening` service, `auth.json`) | Excluded from Vercel via `.vercelignore`; `SCREENING_SERVICE_BASE` in `src/types/screening.ts` points at the Python service but is unreferenced (S02). `auth.json` is empty (`{}`), but a file with that name invites a real credential commit. | Keep as local-agent scaffolding but add `agent-home/auth.json` to `.gitignore`, untrack vendored binaries, and state in README whether the screening service is supported. |
| Word lock files `~$*.docx` in `resolutions/` and `docs/review-artifacts/` | Untracked Office lock files appear in `git status`. | Add `~$*` to `.gitignore`. |

## Acceptance criteria

- [ ] **S06-AC1:** Each item in tables A and C has a recorded decision (keep / move / delete / defer) with owner and date in the PR description.
- [ ] **S06-AC2:** `npm ls @langchain/langgraph @earendil-works/pi-coding-agent @types/bcryptjs --omit=dev` shows none of them in the production tree (unless explicitly kept); `package-lock.json` regenerated with `npm ci` clean.
- [ ] **S06-AC3:** The production Docker stage installs `--omit=dev` (or prunes) and the built image still passes the repository's container smoke check. Before/after `docker image ls` size recorded.
- [ ] **S06-AC4:** `.gitignore` covers `~$*`, `agent-home/auth.json` and any other secret-shaped local file; `git ls-files | grep -E 'auth\.json|\.env$'` is clean.
- [ ] **S06-AC5:** No stray prompt-as-filename or unreferenced demo scripts remain at the repository root; moved files retain history (`git mv`) and all inbound doc links resolve (link-check script output attached).
- [ ] **S06-AC6:** `npm run build`, `npm test`, `npm run test:db` and the Docker smoke pass. No application behavior change.

## Implementation tasks

1. Run the dependency checks above and record the owner's keep/delete decisions.
2. Apply dependency and Dockerfile changes; rebuild the image locally and run the smoke.
3. Move/delete root artifacts with `git mv`; fix links.
4. Tighten `.gitignore`.

## Boundaries

No dependency upgrades. No changes to runtime configuration semantics. Do not delete anything referenced by `.vercelignore` or CI without updating both.
