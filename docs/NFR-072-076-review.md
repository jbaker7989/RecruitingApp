# NFR-072–076 — TDD fixes and pre-merge review

Date: 2026-10-05. Status: locally verified fixes, **not merged or deployed**. No production data or credentials were changed. Main and the existing NFR-071 PR were left unchanged.

## Branch stack and lifecycle boundary

The working tree began clean on `fix/NFR-071-vercel-runtime-outage` (`ffb28a3`), with PR #11 still open and `origin/main` at `f4a7164`. These fixes require that unmerged tracing/deployment work, so branches are stacked on it rather than starting with main's broken runtime. Each item has a test-first commit and a separate implementation commit; resolution documents are finalized together on the top branch after combined review.

| ID | Branch (in stack order) | Red commit | Fix commit | Required Red → Green | Fix attempts |
|---|---|---|---|---|---|
| NFR-076 | `fix/NFR-076-production-smoke` | `c1d8078` | `0dc8adf` | 0/2 → 2/2 | 1/3 |
| NFR-074 | `fix/NFR-074-deploy-gate` | `40ecc68` | `abbc15a` | 0/3 → 3/3; 5/5 with supplemental cases | 1/3 |
| NFR-072 | `fix/NFR-072-pdf-v2` | `301bb3b` | `1c81a6f` | 0/2 → 2/2 | 2/3 |
| NFR-073 | `fix/NFR-073-pdf-worker-bundle` | `b03ccbb` | `e8171e9` | 0/2 → 2/2 | 1/3 |
| NFR-075 | `fix/NFR-075-openai-trace-contract` | `d86c6e1` | `21f3b05` | required 0/2 → 2/2; 3/3 with compiler control | 1/3 |

All five remain OPEN in `BUGS.md`: the project's Definition of Done requires reviewed merge and hosted runtime checks, not just green local tests. No merge commit exists. No gate was overridden, test skipped, production validation relaxed, or new test framework added.

## Regression evidence

- **NFR-076:** `.env.example` omitted `JWT_SECRET`; smoke printed only `smoke-health=ok`, with no production run. Both required signing variables are now documented, and smoke boots development and production children with separate temp data directories and independently generated production-only test secrets. Existing missing/default-secret rejection tests still pass.
- **NFR-074:** real local HTTP servers returning 302/401 caused `deploy-health=skipped` and exit 0; the workflow opted into that path. Both now exit 1, and the workflow cannot opt out. Supplemental 307 rejection and a protected endpoint requiring the bypass header pass; the secret does not appear in output. Redirects are not followed and requests are time-bounded.
- **NFR-072:** valid and corrupt PDF buffers both failed `TypeError: pdfParse is not a function`. The real 607-byte PDF fixture contains text, objects, a correct xref and trailer. The parser now uses v2, copies bytes and destroys resources in `finally`; corrupt bytes produce `InvalidPDFException`. The first Green run exposed pre-existing NFR-078 after successful extraction. Tests were explicitly isolated at the downstream prompt/LLM boundary, rerun against the original implementation (still 0/2), then passed 2/2. The PDF library is never mocked; the input buffer is asserted unchanged.
- **NFR-073:** pinned nft omitted `pdf.worker.mjs`; an isolated copy of only traced files also failed earlier with missing canvas / `DOMMatrix is not defined`. The public `pdf-parse/worker` entry statically references both worker and canvas/polyfills. The isolated production artifact now imports the app, parses a real PDF, rejects corrupt bytes and serves `/health` 200. Downstream prompt/LLM work is stubbed for NFR-078; this is not evidence that real resume upload or LLM workflows are fixed.
- **NFR-075:** the direct dependency was absent and the audit resolved subpaths from repository root. `openai@7.15.0` is now explicitly pinned; lockfile review shows only the root declaration changed, no dependency versions. Each actual LangChain ESM importer is retained and resolved using Node's parent-URL resolution flag and import conditions. A supplemental compiler control already passed pre-fix: installed TypeScript 7 rejects missing side-effect paths by default, correcting the original report's older assumption. Retain the internal-path workaround until Vercel's actual builder ships nft >=1.11.0 and trace/artifact tests pass without it.

## Verification

| Gate | Result |
|---|---|
| Clean deterministic install (`npm ci`) | PASS |
| Typecheck (`npm run typecheck`) | PASS |
| Lint (`npm run lint`) | PASS: 0 errors, 119 existing warnings; no suppression added |
| Build (`npm run build`) | PASS |
| Full suite (`npm test`) | PASS: 163/163, no skips |
| Smoke (`npm run smoke`) | PASS: development and production |
| Pinned nft isolated artifact | PASS: health 200, real PDF text, corrupt PDF rejected |
| Actual local Vercel build / artifact | PASS: Vercel CLI 59.16.0 build; isolated emitted `src/` artifact under production: `pdf-bundle=ok health=200 real-pdf=ok corrupt-pdf=rejected` |
| Hosted CI / preview / production for these fixes | NOT VERIFIED: local branches are not published/merged; owner setup remains absent |

Existing install output reports three dependency audit findings (one moderate, two high). This change did not alter dependency versions or waive a security gate; those findings require separate dependency triage. The JSON-store production data-integrity blocker (NFR-034) is also unchanged.

The first actual-artifact invocation assumed `dist/`; Vercel compiles into `src/`. That was a test-helper path error, not an application defect. The helper accepts the explicit emitted directory for the two real artifact layouts. Actual Vercel output was copied OUTSIDE the repository before execution, with `NODE_PATH` empty, so missing packages could not fall back to repository `node_modules`. The copied `.vercel/output/functions/index.func` booted under `NODE_ENV=production` with two independently generated secrets and isolated data; the real PDF returned the fixture's text, corrupt bytes were rejected and `/health` returned 200. No extra dependency files were added to that copied bundle.

To repeat: run `vercel build --yes`, copy the entire `index.func` outside the repository, then invoke `node --experimental-import-meta-resolve tests/helpers/pdf-bundle-check.mjs <copied-bundle-root> <absolute-path-to-tests/fixtures/resume.pdf> src` with `NODE_ENV=production`, empty `NODE_PATH`, isolated `DATA_DIR`, and independent generated signing secrets. For the nft artifact, the regression test invokes the same helper with the default `dist` directory. This local native-artifact check is not hosted Linux validation.

## Required before deploy / merge

1. Owner: set independent `JWT_SECRET` and `APPLICANT_JWT_SECRET` (each >=32 characters; not defaults) in **Vercel Preview and Production**, then redeploy. `vercel env ls` currently lists only the Blob token; its value was neither used nor recorded here. NFR-056 remains open.
2. Owner: configure GitHub repository secret `VERCEL_AUTOMATION_BYPASS_SECRET` using the Vercel project's Protection Bypass for Automation setting. GitHub secret listing was empty during this review.
3. Publish/review the stack, pass hosted CI and preview runtime verification, then merge in dependency order. Do not treat a protected/unreachable preview as healthy.
4. After merge: verify deployed `/health` with `npm run verify:deploy`, inspect the new deployment's runtime logs for load failures, and repeat affected-feature checks on the hosted Linux artifact. Generated local smoke secrets prove code behavior, not deployment secret parity.
5. NFR-074 is detection-only. Automatic rollback was deliberately not added: prior deployments are known unhealthy and no owner-approved known-good target/policy exists. It does not block promotion or automatically recover an outage.

## New bugs found — pre-existing, not introduced by these fixes

| ID | Severity | Evidence | Follow-up |
|---|---|---|---|
| NFR-077 | High / P1 | Real multipart upload through `handleFileUpload`: `uploadedBytes:607`, `bufferBytes:0`; route's parser call raises `The PDF file is empty, i.e. its size is zero bytes.` `useTempFiles:true` means `file.data` is empty. The route also leaves its temp file behind. | Use the validated temp-file bytes with guaranteed cleanup, or bounded in-memory mode; test PDF/DOCX multipart routes and error cleanup. |
| NFR-078 | High / P1 | Real prompt formatting fails `Missing value for input state, zip` before any model invocation, for both extracted PDF text and `parseResume(text)`. Literal `{...}` schema examples are interpreted as variables. | Escape schema braces or use safe prompt composition; test text and file paths with the real formatter. |

No newly introduced application bug was found in the branch review. Audit covered modified modules, direct resume route callers, upload middleware, token-service startup guards, PDF/worker/native dependencies, trace resolution, workflow/CLI behavior, library documentation and the full suite. This is pre-merge review; it does not substitute for post-merge hosted verification.

## Resolution artifacts

`resolutions/RESOLUTON-OF-ISSUE-NFR-072.docx` through `resolutions/RESOLUTON-OF-ISSUE-NFR-076.docx` contain issue, symptoms, root cause, branch/status, fix files, per-test Red/Green evidence and attempt counts, gates, pre-merge findings and related work. `BUGS.md` preserves original evidence and records the branch fixes and new prioritized issues.
