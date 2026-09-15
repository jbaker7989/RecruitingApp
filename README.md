# New Frontier Recruiting

[![CI](https://github.com/jbaker7989/RecruitingApp/actions/workflows/ci.yml/badge.svg)](https://github.com/jbaker7989/RecruitingApp/actions/workflows/ci.yml)
[![Node.js 24](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> A Principal Product Manager portfolio case study in translating an ambiguous recruiting concept into an API-first product, explicit policy decisions, testable acceptance criteria, governed agentic delivery, and a risk-based release plan.

**Live health endpoint:** [https://rec-app-build.vercel.app/health](https://rec-app-build.vercel.app/health)
**Linear workspace:** [recruiting-app](https://linear.app/recruiting-app)
**Source-of-truth risk register:** [`BUGS.md`](BUGS.md)
**Agentic workflows epic:** [REC-5](https://linear.app/recruiting-app/issue/REC-5)
**Bug fix initiative:** [REC-55](https://linear.app/recruiting-app/issue/REC-55)
**Applicant-profile feature branch:** [`feat/NFR-FEAT-001-applicant-profile`](https://github.com/jbaker7989/RecruitingApp/tree/feat/NFR-FEAT-001-applicant-profile)

---

## Executive case study

I built New Frontier Recruiting to demonstrate how I lead product definition and delivery when the starting point is a broad request—“create a recruiting application”—rather than a validated specification.

I converted that request into a governed product system with:

- defined actors, permissions, data models, workflows, and API contracts;
- an applicant-owned profile strategy with privacy and bias controls;
- a deterministic, explainable job-match calculation rather than an opaque AI hiring decision;
- a prioritized defect register with release blockers separated from lower-severity debt;
- acceptance criteria tied to branches, tests, commits, pull requests, deployment evidence, and resolution artifacts;
- human approval at identity, infrastructure, merge, and production-release boundaries;
- agentic AI used for analysis, implementation support, test generation, and independent review—not for autonomous candidate selection.

This repository is intentionally transparent about what is implemented, what is being validated, and what I will not release. The production deployment currently proves build and runtime health. It is **not approved for real applicant data entry** because durable persistence and authentication hardening remain open release blockers.

---

## Product problem and product thesis

Recruiting systems frequently fragment applicant information across resumes, forms, recruiter notes, job systems, and point-in-time application records. That fragmentation creates four product problems:

1. Applicants repeatedly enter the same information and lose control of corrections.
2. Recruiters receive inconsistent records and cannot reliably explain matching outcomes.
3. Hiring teams can see bias-producing or sensitive data earlier than necessary.
4. Product teams cannot reconstruct which profile version, score inputs, or permissions were used for a decision.

My product thesis is that a recruiting platform should use an **applicant-owned master profile**, create an **immutable snapshot for each application**, expose data through **stage- and role-specific views**, and preserve an **auditable explanation of system behavior**.

I also made an explicit AI-product decision: the current score is a deterministic weighted heuristic, not a machine-learning or generative-AI recommendation. That makes the score inspectable while the product is still establishing data quality, fairness policy, and human-review controls.

### Validation and outcome plan — planned

No customer-outcome baseline exists yet. Before setting targets or expanding ranking automation, I would run the following validation program:

| Assumption to test | Target participant | Method | Baseline or signal to capture |
|---|---|---|---|
| A reusable profile reduces repeated applicant effort. | US-based applicants who applied to at least two jobs in the previous six months. | Moderated task test: create a profile, submit one application, correct the profile, then submit a second application. | Time per application, repeated fields, completion rate, correction success, abandonment point, and self-reported control. |
| Staged contact visibility supports screening without blocking recruiter work. | Recruiters and hiring managers who perform initial review and schedule interviews. | Workflow prototype test comparing full-contact and staged-contact views. | Initial-review time, attempts to access phone early, scheduling completion, and protected-field exposure events. |
| Match explanations are understandable and actionable. | Applicants and recruiters reviewing the same synthetic profile/job pairs. | Comprehension interview using keyword, education, and experience score breakdowns. | Correct explanation of score inputs, incorrect causal assumptions, disputed source data, and correction requests. |
| Blind-review defaults reduce exposure to bias-producing data. | Recruiting operations, legal/privacy partners, and hiring managers. | Policy walkthrough plus permission audit using role/stage scenarios. | Unauthorized name/photo/contact exposure, override frequency, override rationale, and unresolved policy exceptions. |
| Accommodation handling supports scheduling without collecting medical history. | Accessibility subject-matter experts and interview coordinators; no real medical data in prototype testing. | Consent-language review and task-based access test at interview scheduling. | Consent comprehension, correct assigned-manager access, diagnosis-field absence, audit completeness, and deletion/retention questions. |

Candidate product metrics—defined now but not reported as achieved—are profile completion, profile reuse, median application time, application abandonment, recruiter initial-review time, explanation comprehension, data-correction completion, unauthorized-access denials, protected-field exposure incidents, CCPA request completion, and accommodation-access audit coverage. I would set targets only after collecting a representative baseline and completing legal/privacy review.

---

## My Principal Product Manager contribution

| Product leadership capability | Concrete evidence in this repository |
|---|---|
| Product framing | Defined the recruiting domain, actors, entities, lifecycle states, and service boundaries in [`brain/brain.md`](brain/brain.md). |
| Requirements decomposition | Converted the expanded applicant-profile concept into `NFR-FEAT-001`, owner decisions, acceptance criteria, implementation phases, and testable privacy rules. |
| Decision quality | Made photo optional; selected one universal race-agnostic fallback icon; excluded photo, name, contact details, pronouns, accommodations, and compensation from matching inputs. |
| Platform thinking | Separated companies, jobs, applicants, applications, hires, matching, observability, media, authentication, MCP-shaped integrations, CI, and deployment concerns. |
| Risk management | Maintained `BUGS.md` with unique IDs, severity, evidence, dependencies, required fixes, and an ordered release queue. |
| Delivery governance | Required a work-item branch, **two or more failing tests BEFORE development starts**, lint/typecheck/build/test/smoke CI gates, maximum three-iteration fix loop, external review, documented resolution, and post-merge regression review. See [`dev-testing-management/SKILL.md`](dev-testing-management/SKILL.md). |
| Technical product judgment | Rejected local JSON writes as production persistence on Vercel; selected private Vercel Blob for media bytes; kept media metadata separate from binary content. |
| Responsible AI | Kept the match engine deterministic and explainable; prohibited photo and protected attributes from scoring; retained human decision ownership. |
| Stakeholder control | Required owner approval for profile visibility, phone reveal timing, CCPA workflows, accommodations, infrastructure authentication, and production promotion. |
| Evidence-based execution | Linked work to tests, Git commits, PR checks, Vercel deployment IDs, HTTP health results, and per-issue Word resolution documents. |

---

## Capability and release status

The status column is deliberately specific. “Implemented” does not mean “approved for production applicant data.”

| Capability | Status | Evidence or constraint |
|---|---|---|
| Express API runtime and `/health` | **Deployed on `main`** | [Production deployment `dpl_13qej7gaT51KRqqP4rsaCwcKRm2T`](https://vercel.com/jbaker7989-1641s-projects/rec-app-build/13qej7gaT51KRqqP4rsaCwcKRm2T); public `/health` returned HTTP 200 from [reviewed commit `8ac888a`](https://github.com/jbaker7989/RecruitingApp/commit/8ac888a). |
| Company and job route-handler scaffolding | **Implemented prototype on `main`; workflows blocked** | CRUD/browse/import handlers exist; NFR-005/006 block CSV import correctness, and NFR-014/017/018/022 cover closure, application, duplicate, and deletion integrity. |
| Application and hire route-handler scaffolding | **Implemented prototype on `main`; workflows blocked** | Submission/status/hire handlers exist; NFR-007 blocks hire-list routes and NFR-015/016/019 cover validation and filtering defects. |
| Authentication and onboarding | **Blocked** | Global middleware makes register/login unreachable (`NFR-003`); NFR-008–013 block real applicant traffic on identity, credentials, authorization, repository hygiene, and CORS grounds. |
| MCP-shaped route scaffolding | **Implemented prototype on `main`; workflows blocked** | Jobs/applications/apply/hires/health JSON handlers exist; NFR-023 tracks authorization and duplicated-logic inconsistencies. |
| Deterministic candidate/job matching | **Implemented prototype on `main`** | `calculateMatchScore()` combines keyword 40%, education 30%, and experience 30%, then clamps the result to 1–10; NFR-032 tracks scoring limitations. |
| Automated CI | **Implemented on `main`** | GitHub Actions runs install → typecheck → lint → build → test (48 tests) → built-artifact smoke with SHA-pinned actions and read-only permissions. |
| **Agentic AI Workflows (Phase 1 & 2)** | **Implemented on `main`** | LLM-powered resume parsing, semantic matching with vector embeddings, interview scheduling state machine, job description generation, and candidate communication. See [Linear REC-5](https://linear.app/recruiting-app/issue/REC-5). |
| Expanded applicant-owned profile | **In development — implemented on an unmerged feature branch** | Owner-only profile routes, isolated `personId`/`applicantId`, progressive completeness, detailed employment CRUD, and PII-safe observability. |
| Private applicant photo storage | **In development — private upload implemented; release blocked pending retrieval and media hardening** | Private Blob store `rec-app-build-applicant-media` in `iad1`; adapter and route tests pass on feature commit [`a42b128`](https://github.com/jbaker7989/RecruitingApp/commit/a42b128). |
| Authorized private-photo display | **Blocked** | Private upload works, but protected retrieval/streaming is not implemented ([NFR-038](BUGS.md#38-nfr-038-private-applicant-photos-have-no-authorized-retrievaldisplay-path)). |
| Immutable application snapshots | **Planned in NFR-FEAT-001** | Required so later profile corrections do not rewrite the historical employer submission. |
| CCPA-oriented access, correction, export, deletion, and retention | **Planned in NFR-FEAT-001** | Not represented as complete until route, authorization, retention, and audit tests pass. |
| Accommodation workflow | **Planned in NFR-FEAT-001** | Requested accommodation—not diagnosis—becomes visible at interview scheduling to assigned hiring managers only. |
| Durable production persistence | **Blocked** | JSON-file mutation is not safe on Vercel serverless (`NFR-034`, related concurrency defect `NFR-020`). |
| Production-grade authentication | **Blocked** | Current bearer identity is forgeable and must be replaced before real user or photo traffic (`NFR-008`). |
| Automatic Git-to-Vercel deployment | **Blocked** | GitHub CI works; Vercel Git-provider project connection remains unresolved (`NFR-035`). |
| Brand-copy migration | **In development** | This README uses "New Frontier Recruiting"; deployed API responses and legacy internal documents still contain "New Fronteir Recruiting." |
| Browser frontend | **Not implemented** | This repository currently demonstrates an API-first backend and product-delivery system. |

---

## Product services

### 1. Runtime and health service

- **Technology:** Node.js 24, TypeScript 7, Express 5.
- **Entrypoint:** `src/index.ts`; compiled output is ESM under `dist/`.
- **Health contract:** `GET /health` returns `status`, product message, and timestamp.
- **Deployment:** Vercel Express function in `iad1`.
- **Regression protection:** tests execute `dist/index.js`, import it using Vercel-style ESM semantics, and call `/health`.

### 2. Authentication and role service

Routes under `/api/auth`:

- `POST /register`
- `POST /login`
- `POST /oauth-stub`

Role vocabulary:

- `applicant`
- `recruiter`
- `hiring-manager`
- `member-services`

The intended authorization model is role-based and applicant-owned. The current prototype does **not** meet production security requirements: global middleware placement blocks unauthenticated registration/login (`NFR-003`), and user IDs/usernames currently function as bearer tokens (`NFR-008`). I treat those as release blockers, not documentation footnotes.

### 3. Company service

Routes under `/api/companies` support:

- company creation by `hiring-manager` or `member-services`;
- company listing and detail retrieval;
- company updates;
- deletion by `member-services`;
- active-job retrieval for a company.

Company context includes name, description, location, size, and industry and is joined into job-list/detail responses.

### 4. Job service

Routes under `/api/jobs` support:

- creating, reading, updating, and deleting postings;
- active-job browsing with company context;
- CSV or JSON mass import;
- pay range, responsibilities, qualifications, skills, experience, reporting line, opening count, and active state.

The import route uses Papa Parse for CSV and native JSON parsing. `BUGS.md` records known import and job-closure defects, including CommonJS import handling and dropped requirements, so these functions are not represented as production-ready.

### 5. Applicant service

`main` contains basic applicant create/read/update/apply routes. The `NFR-FEAT-001` branch adds:

- `POST /api/applicants/profile` — create one profile owned by the authenticated applicant account;
- `GET /api/applicants/me` — retrieve only the caller’s owned profile;
- `PATCH /api/applicants/me` — update approved profile fields while protecting ownership fields;
- employment create, update, reorder, and delete routes using server-generated stable IDs;
- required 50–2,000-character plain-text position descriptions;
- a universal `default-person-icon` that stores or infers no race;
- completeness calculated across eight non-sensitive sections; optional photo and pronouns do not reduce completeness;
- observability that records actions and IDs without logging email, phone, or employment-description content.

### 6. Applicant media service

The feature branch uses `@vercel/blob` and the private store `rec-app-build-applicant-media`.

Implemented controls:

- applicant-owned `POST /api/applicants/me/avatar` and `DELETE /api/applicants/me/avatar`;
- private Blob access, no overwrite, collision-resistant applicant pathnames;
- PNG, JPEG, and WebP allow-list;
- 4 MB application limit to remain below Vercel’s server-upload ceiling;
- MIME/signature agreement before Blob upload;
- metadata-only JSON records—binary/base64 photo content is never written into the applicant store;
- replacement cleanup and neutral-icon restoration.

Open media blockers are explicit: [NFR-038 authorized retrieval](BUGS.md#38-nfr-038-private-applicant-photos-have-no-authorized-retrievaldisplay-path), [NFR-039 durable cleanup/retry semantics](BUGS.md#39-nfr-039-blobstore-failure-ordering-can-orphan-or-break-photo-metadata), [NFR-040 complete image decoding/dimension limits](BUGS.md#40-nfr-040-signature-only-image-validation-accepts-corrupt-files), and [NFR-041 parser-level 413 handling](BUGS.md#41-nfr-041-uploads-above-the-raw-parser-limit-return-500-instead-of-413).

### 7. Application and hire service

Routes under `/api/applications` implement:

- application creation;
- role-filtered application listing;
- application detail retrieval;
- status updates across `pending`, `reviewed`, `interview scheduled`, `accepted`, and `rejected`;
- hire-record creation when an application is accepted;
- company-hire and hire-list responses.

The target lifecycle is:

```text
pending → reviewed → interview scheduled → accepted
                    └────────────────────→ rejected
```

Known validation, duplicate-application, route-ordering, auto-close, and notification gaps are tracked in `BUGS.md`.

### 8. Explainable matching service

`src/services/matching.ts` currently calculates:

```text
match score = keyword score × 0.40
            + education score × 0.30
            + experience score × 0.30
```

- Keyword inputs come from job requirements and required skills.
- Candidate text comes from employment position/responsibility text and education field/degree text.
- Education scoring checks education history and degree language in qualifications.
- Experience scoring compares calculated years with required experience.
- The response includes the final score, per-keyword matches, education score, and experience score.

This is a transparent heuristic. It is **not** marketed as predictive AI, and it is not authorized to make hiring decisions. The NFR-FEAT-001 policy excludes name, photo, contact data, pronouns, accommodation requests, and compensation from scoring.

### 9. Observability service

`data/observability.json` uses records with:

- `id`
- timestamp
- action
- entity type and ID
- acting user ID
- details
- success/failure outcome

The expanded applicant feature adds PII-safe action logging for profile and employment changes. Production observability requires migration away from local JSON together with the primary data store.

### 10. MCP-shaped integration service

Routes under `/api/mcp` expose JSON contracts for:

- active jobs;
- applications;
- application submission;
- hires;
- health.

This is an integration-facing HTTP layer shaped for model/agent consumers. It is not yet a standalone MCP stdio, SSE, or Streamable HTTP server, and `NFR-023` tracks authorization and duplicated-logic inconsistencies.

### 11. Agentic AI Workflows

Agentic workflows use LangChain and LangGraph for AI-powered recruiting automation. Full documentation in [`docs/features/agentic-workflows/`](docs/features/agentic-workflows/).

#### 11.1 Intelligent Resume Parsing (`src/chains/resumeParsing.ts`)

LLM-powered resume/CV parsing with structured output validation.

- **Technology:** LangChain with OpenAI/Anthropic, Zod schema validation
- **Input:** PDF or DOCX resume files
- **Output:** Structured candidate profile (name, email, phone, skills, experience, education)
- **Routes:** `POST /api/agents/resume/parse`, `POST /api/agents/resume/parse-text`
- **Status:** Implemented ([REC-6](https://linear.app/recruiting-app/issue/REC-6))

#### 11.2 Semantic Matching (`src/chains/matching.ts`, `src/services/vectorStore/`)

Vector embedding-based matching with keyword fallback.

- **Technology:** OpenAI embeddings, in-memory vector store
- **Scoring:** 30% keyword + 30% semantic + 30% education + 10% experience
- **Routes:** `POST /api/agents/matching/score`, `GET /api/agents/matching/job-suggestions/:applicantId`, `GET /api/agents/matching/similar-candidates/:jobId`
- **Status:** Implemented ([REC-7](https://linear.app/recruiting-app/issue/REC-7))

#### 11.3 Interview Scheduling State Machine (`src/agents/scheduling/`)

9-state workflow for interview scheduling with transitions.

- **States:** `requested → confirmed → rescheduled → cancelled → completed → no_show → offer_extended → offer_accepted → offer_declined`
- **Features:** Time slot management, interviewer assignment, conflict detection
- **Routes:** `POST /api/agents/scheduling/interview`, `POST /api/agents/scheduling/reschedule`, `POST /api/agents/scheduling/cancel`, `POST /api/agents/scheduling/complete`
- **Status:** Implemented ([REC-8](https://linear.app/recruiting-app/issue/REC-8))

#### 11.4 Job Description Generator (`src/chains/jobDescription.ts`)

LLM-powered job description generation with draft workflow and A/B tone variants.

- **Technology:** LangChain with GPT-4o, Zod schema validation
- **Features:** Draft versioning, A/B variants (professional/casual/inclusive/startup), direct publish to jobs
- **Routes:** `POST /api/agents/jd/generate`, `POST /api/agents/jd/generate-variants`, `GET /api/agents/jd/drafts`, `PUT /api/agents/jd/drafts/:id`, `POST /api/agents/jd/drafts/:id/publish`, `DELETE /api/agents/jd/drafts/:id`
- **Status:** Implemented ([REC-11](https://linear.app/recruiting-app/issue/REC-11))

#### 11.5 Candidate Communication Agent (`src/chains/candidateCommunication.ts`)

LLM-powered personalized candidate messaging for recruiting workflows.

- **Technology:** LangChain with GPT-4o, Zod schema validation
- **Message Types:** `application_received`, `interview_invitation`, `reschedule_request`, `rejection`, `offer_extended`, `next_steps`
- **Tones:** professional, warm, concise, inclusive
- **Features:** Structured JSON output, confidence scoring, `requiresHumanReview` flag for sensitive content
- **Routes:** `POST /api/agents/communication/generate`, `POST /api/agents/communication/generate-variants`, `GET /api/agents/communication/templates`
- **Status:** Implemented ([REC-12](https://linear.app/recruiting-app/issue/REC-12))

#### Phase 2 Planned Features

See [Linear REC-5](https://linear.app/recruiting-app/issue/REC-5) for full roadmap:
- Background Verification Agent
- Onboarding Orchestration
- Interview Feedback Synthesis
- Candidate Ranking & Shortlisting
- Skills Taxonomy & Normalization
- Duplicate Candidate Detection

### 12. Delivery and review services

| Service | Exact use |
|---|---|
| GitHub | Source control, work-item branches, pull requests, merge commits, and audit history. |
| GitHub Actions | Deterministic `npm ci`, typecheck, build, recursive tests, and built-server smoke on pushes to `main` and pull requests. |
| Greptile | External AI-assisted review; [PR #1](https://github.com/jbaker7989/RecruitingApp/pull/1) and [PR #2](https://github.com/jbaker7989/RecruitingApp/pull/2) both passed before merge. |
| Vercel | Node/Express preview and production deployments; production `/health` is publicly verified. |
| Vercel Blob | Private applicant-photo object storage on the NFR-FEAT-001 branch. |
| Pi coding agent | Repository inspection, scoped implementation support, test execution, deployment operations, and workflow orchestration under human supervision. |

---

## Agentic AI functions used

I used agentic AI as a controlled product-delivery capability with explicit boundaries.

| Agentic function | How it was used | Control or evidence |
|---|---|---|
| Context specialization | Repository skills define applicant, application, job, data, and development/testing responsibilities. | `applicant-management/SKILL.md`, `applications-management/SKILL.md`, `job-management/SKILL.md`, `data/SKILL.md`, `dev-testing-management/SKILL.md`. |
| Requirements synthesis | The agent translated owner decisions into NFR-FEAT-001 phases, schema changes, acceptance criteria, and a Word implementation plan. | [Implementation plan on the feature branch](https://github.com/jbaker7989/RecruitingApp/blob/feat/NFR-FEAT-001-applicant-profile/feature-plans/IMPLEMENTATION-PLAN-NFR-FEAT-001-APPLICANT-PROFILE.docx) and decision commit [`409f442`](https://github.com/jbaker7989/RecruitingApp/commit/409f442). |
| Repository investigation | The agent traced runtime, route, storage, authorization, and deployment behavior before proposing changes. | Findings became numbered entries in `BUGS.md`, not untracked chat recommendations. |
| Test-first implementation | The agent wrote and executed failing tests before implementation, then used a maximum three-iteration correction loop. | Red and Green commits carry the same NFR/NFR-FEAT ID. |
| Lint gate | Development now includes an ESLint gate for `src/**/*.ts` and `tests/**/*.test.ts`, run after typecheck and before build/test. | `npm run lint`, `eslint.config.js`, `.github/workflows/ci.yml`, INFRA-003/NFR-047. |
| Specialist review | Read-only reviewer agents assessed merge safety, CI semantics, private Blob behavior, and post-merge regressions. | Findings were fixed or assigned traceable IDs in [`BUGS.md`](BUGS.md), including NFR-036–047. |
| External AI review | Greptile reviewed GitHub PRs independently of the implementation agent. | [PR #1](https://github.com/jbaker7989/RecruitingApp/pull/1) and [PR #2](https://github.com/jbaker7989/RecruitingApp/pull/2) checks passed before merge. |
| Long-running task supervision | CI and review checks were watched as background tasks with terminal-state notifications rather than assumed complete. | Merge occurred only after GitHub reported successful checks. |
| MCP-facing product design | The backend exposes model-consumable job, application, hire, and health JSON routes. | `/api/mcp/*`; limitations remain recorded under NFR-023. |
| Documentation generation | Resolution documents were generated programmatically after verified fixes. | `resolutions/RESOLUTON-OF-ISSUE-{ID}.docx`. |
| Human-in-the-loop authorization | The agent stopped when GitHub/Vercel identity permissions required owner approval. | OAuth `workflow` scope was granted by the owner; Vercel Git connection remains open rather than bypassed. |

### AI boundaries

- No LLM selects, rejects, ranks, or hires a candidate.
- The match engine is deterministic and exposes its component scores.
- Photo, name, contact details, pronouns, compensation, and accommodation requests are excluded from matching policy.
- Reviewer-agent output is advisory; tests, hosted CI, human authorization, and merge state are the release evidence.
- Agent-generated claims are not accepted as proof unless tied to code, tests, deployment output, or a tracked artifact.

---

## Product and engineering process

The repository’s delivery policy is defined in [`dev-testing-management/SKILL.md`](dev-testing-management/SKILL.md).

```text
Owner decision or bug evidence
        ↓
NFR-FEAT-### or NFR-### work item
        ↓
Named branch from current main
        ↓
At least two tests fail for the intended reason (Red)
        ↓
Minimum fix; maximum three correction iterations (Green)
        ↓
BUGS.md + commit/PR evidence + DOCX resolution artifact
        ↓
npm ci → typecheck → lint → build → recursive test suite (48 tests) → dist health smoke
        ↓
Independent review + GitHub PR checks
        ↓
Merge commit on main
        ↓
Post-merge regression review
        ↓
New findings receive the next NFR ID and priority
```

### CI implementation

`.github/workflows/ci.yml` uses:

- `ubuntu-latest` and Node.js 24;
- `actions/checkout` and `actions/setup-node` pinned to full commit SHAs;
- read-only repository permissions;
- `persist-credentials: false`;
- concurrency cancellation by workflow/ref;
- a ten-minute job timeout;
- exact gate order: install, typecheck, build, test, smoke.

`scripts/ci-smoke.mjs` starts the compiled `dist/index.js` on an available port, uses an isolated temporary data directory, polls `/health` within a bounded window, requires HTTP 200 with `status: "ok"`, terminates the process, and deletes its test data.

---

## Verified delivery evidence

Evidence below is technical delivery evidence, not fabricated adoption or business-impact data.

| Evidence | Verified result |
|---|---|
| Main regression suite after [PR #2](https://github.com/jbaker7989/RecruitingApp/pull/2) | 18/18 tests passed; [main CI run `34730159346`](https://github.com/jbaker7989/RecruitingApp/actions/runs/34730159346) passed. |
| Synchronized NFR-FEAT-001 branch | 40/40 tests passed with typecheck, build, and smoke at [commit `a42b128`](https://github.com/jbaker7989/RecruitingApp/commit/a42b128). |
| PR #1 final GitHub Actions | [`verify` run `34729698798`](https://github.com/jbaker7989/RecruitingApp/actions/runs/34729698798) passed in 17 seconds; Greptile Review passed in 1 minute 32 seconds. |
| PR #2 final GitHub Actions | [`verify` run `34730039069`](https://github.com/jbaker7989/RecruitingApp/actions/runs/34730039069) passed in 26 seconds; Greptile Review passed in 2 minutes 19 seconds. |
| Main production deployment | [Commit `8ac888a`](https://github.com/jbaker7989/RecruitingApp/commit/8ac888a) deployed as [`dpl_13qej7gaT51KRqqP4rsaCwcKRm2T`](https://vercel.com/jbaker7989-1641s-projects/rec-app-build/13qej7gaT51KRqqP4rsaCwcKRm2T); public `/health` returned HTTP 200. |
| Applicant-profile preview | [Commit `a42b128`](https://github.com/jbaker7989/RecruitingApp/commit/a42b128) deployed as [`dpl_5RGcXaoRMeP9F2G47wDnTSGAsLef`](https://vercel.com/jbaker7989-1641s-projects/rec-app-build/5RGcXaoRMeP9F2G47wDnTSGAsLef); protected `/health` returned `status: "ok"`. |
| Private Blob adapter | Local operator smoke uploaded, inspected, and deleted a private PNG through the production adapter. This is verified operator evidence, not yet a durable CI integration test. |
| Resolved setup defects | NFR-001, NFR-002, NFR-004, NFR-030, NFR-033, NFR-036, and NFR-037 include regression evidence and resolution records. |

No applicant adoption, recruiter conversion, time-to-hire, quality-of-hire, or revenue metrics have been collected. I do not present engineering completion evidence as customer-outcome evidence.

---

## Privacy, fairness, and compliance decisions

The NFR-FEAT-001 product decisions are specific:

- Profile photo is optional.
- No-photo state uses one universal neutral, race-agnostic person icon.
- Name, photo, and email are visible only to authenticated authorized staff.
- Phone remains hidden during initial review and is revealed only after the configured review stage.
- Only the designated applicant-role account owns and edits its profile; other account roles remain isolated.
- Initial release scope is United States only.
- Every employment entry requires a 50–2,000-character position description.
- Photo bytes use private Vercel Blob; JSON stores only metadata.
- Every application will preserve an immutable profile snapshot and matching-algorithm version.
- CCPA-oriented requirements include access, correction, portability/export, deletion, retention, and opt-out controls.
- Accommodation requests record the requested accommodation, not diagnosis or medical history.
- Accommodation data becomes visible at interview scheduling to assigned hiring managers only, under explicit consent and audited access.
- Accommodation data and other protected/sensitive fields are excluded from matching and general profile responses.

These are approved product requirements. Only the Phase 1 profile foundation and initial photo storage slice are implemented on the feature branch; snapshots, CCPA workflows, staged staff views, and accommodations remain planned.

---

## Architecture

```mermaid
flowchart LR
    Client[Applicant / recruiter / hiring manager client]
    Agent[External agent or integration]
    API[Express 5 API on Node.js 24]
    Auth[Authentication and RBAC middleware]
    Routes[Company / job / applicant / application / MCP routes]
    AgentRoutes[Agentic AI routes]
    Match[Deterministic matching service]
    SemanticMatch[Semantic Matching (LLM + Vectors)]
    ResumeParser[Resume Parsing Chain]
    Scheduling[Interview Scheduling State Machine]
    Store[JSON prototype store]
    Audit[Observability JSON]
    Blob["Private Vercel Blob<br/>(feature branch)"]
    CI[GitHub Actions + Greptile]
    Human[Human release approval]
    Vercel[Vercel preview / production]

    Client --> API
    Agent -->|MCP-shaped JSON HTTP| API
    API --> Auth --> Routes
    API --> Auth --> AgentRoutes
    Routes --> Match
    Routes --> Store
    Routes --> Audit
    Routes -->|private media bytes| Blob
    AgentRoutes --> SemanticMatch
    AgentRoutes --> ResumeParser
    AgentRoutes --> Scheduling
    SemanticMatch --> Store
    CI -->|verified reviewed commit| Human
    Human -->|current manual deployment| Vercel
    CI -. planned automatic deployment: NFR-035 .-> Vercel
```

GitHub CI and human release approval are operational. The dotted edge is the blocked target: automatic Vercel Git deployment remains open under NFR-035. Current production was deployed manually from a clean reviewed `main` commit.

---

## Run locally

### Prerequisites

- Node.js 24 (`package.json` and `.nvmrc`)
- npm using the committed `package-lock.json`

### Install and verify

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run smoke
```

### Start development mode

```bash
npm run dev
```

### Start compiled production mode

```bash
npm run build
npm start
```

Then request:

```bash
curl http://localhost:3000/health
```

The core API uses the local `data/` prototype store. Do not use real applicant data. The feature-branch Blob adapter requires a server-side `BLOB_READ_WRITE_TOKEN` supplied through local/Vercel environment configuration; never commit token values or `.env.local`.

---

## Repository map

```text
.github/workflows/ci.yml       Ordered, SHA-pinned CI gates
applicant-management/         Applicant domain skill
applications-management/      Application lifecycle skill
brain/brain.md                 Core domain model and workflows
BUGS.md                        Prioritized evidence-based risk register
data/                         Development-only JSON persistence
dev-testing-management/       Red → Green → review → merge policy
docs/features/agentic-workflows/  Agentic AI workflows documentation
job-management/               Job and company domain skill
resolutions/                  Per-issue Word resolution artifacts
scripts/ci-smoke.mjs          Built-artifact health gate
src/agents/                   Interview scheduling state machine
src/chains/                   LangChain chains (resume parsing, matching, job description, candidate communication)
src/index.ts                  Express application and ESM entrypoint
src/middleware/               Authentication and validation middleware
src/models/store.ts           Typed entities and prototype data access
src/routes/                   Auth, company, job, applicant, application, MCP, agent routes
src/routes/agents/            Agentic AI API endpoints
src/services/llm/             LLM factory (OpenAI/Anthropic)
src/services/vectorStore/    In-memory vector embeddings
tests/regression/             Bug and pipeline regression tests
```

Feature-branch additions include `src/services/applicantProfile.ts`, `src/services/applicantPhoto.ts`, and `tests/features/NFR-FEAT-001-*`.

---

## Current release blockers and next decisions

I prioritize the next work in dependency order:

1. **NFR-035 — Release automation:** repair Vercel Git-provider installation/identity access and prove automatic deployment from a reviewed commit.
2. **NFR-034 + NFR-020 — Data integrity:** replace JSON persistence with a durable transactional store before any real applicant data is accepted.
3. **NFR-008 — Authentication:** replace forgeable bearer identity before enabling applicant-photo read or mutation traffic.
4. **NFR-038, NFR-039, NFR-040, then NFR-041 — Applicant media:** add protected retrieval, durable cleanup retries, complete image decoding/dimension limits, and consistent 413 handling.
5. **NFR-003 — Onboarding:** make registration and login reachable under the corrected authentication boundary.
6. **NFR-007, NFR-005, NFR-006 — Hire listing and job import:** restore route reachability, CSV parsing, and imported requirements.
7. **NFR-009–013 — Remaining security controls:** resolve password handling, role escalation, ownership gaps, credential-file hygiene, and CORS before real applicant traffic.
8. **NFR-014–019 and remaining specification gaps — Application and hiring logic:** correct job closure, submission validation, email confirmation, convenience apply, duplicate prevention, hire filtering, and the remaining specification gaps recorded in `BUGS.md`.
9. Continue NFR-FEAT-001 with immutable snapshots, staged recruiter views, CCPA workflows, and accommodation access.
10. **Agentic Workflows Phase 2:** Background verification, onboarding orchestration, interview feedback synthesis, candidate ranking. See [Linear REC-5](https://linear.app/recruiting-app/issue/REC-5).

The complete active queue, evidence, and resolution history live in [`BUGS.md`](BUGS.md). All open bug issues are tracked in [Linear REC-55](https://linear.app/recruiting-app/issue/REC-55).

---

## What this case study demonstrates

This project demonstrates how I operate as a Principal Product Manager at the intersection of product strategy, platform architecture, responsible AI, privacy, and delivery:

- I convert broad ideas into explicit decisions and testable contracts.
- I distinguish a running demo from a production-approved product.
- I make algorithmic behavior explainable before adding model complexity.
- I use agentic AI to increase delivery throughput while retaining human accountability and evidence-based gates.
- I expose unresolved risk rather than hiding it behind a successful build or deployment badge.
- I connect product decisions to schemas, APIs, tests, infrastructure, release controls, and follow-up priorities.
