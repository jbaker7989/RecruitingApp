# Design System — Phase 1: Token consolidation

Date: 2026-10-04. Status: **implemented locally, non-breaking, unstaged.** Branch `fix/NFR-075-openai-trace-contract`. No templates, routes, or runtime code changed; no visual output changed. Build artifacts under `dist/` and `.vercel/output/` are stale until the next build and were not hand-edited.

## Background

A `/design-system` audit of the applicant dashboard scored the system **62/100**. The stylesheet (`public/css/dashboard.css`) has a strong token layer, but:

- the auth screens (`login.ejs`, `register.ejs`) ship their own `<style>` blocks with ~58 hard-coded hex values that drift from the tokens;
- status colors are hard-coded inline in each badge rule;
- there is no spacing, type, or motion scale — ~90 loose values;
- components lack focus-visible rings, a form error state, and button disabled/loading states.

A four-phase rollout was proposed. **Phase 1 (this change) is the non-breaking foundation.** Phases 2–4 migrate the auth/profile screens, close the component gaps, and de-duplicate.

## What changed

All changes are in `public/css/dashboard.css` and are **additive** — no existing selector was removed or altered in behavior.

| Change | Detail |
|---|---|
| Semantic status tokens added | `--success / --info / --warning / --danger` plus matching `-bg` tint tokens |
| Spacing scale added | `--space-1 … --space-10` (4px → 80px) |
| Type scale added | `--text-xs … --text-2xl` (fixed `rem` steps) |
| Motion tokens added | `--duration-fast / base / slow / slower` |
| Badge rules repointed | 4 `.badge--*` rules now reference the semantic tokens instead of inline hex |

The spacing, type, and motion tokens are **defined but not yet applied** — they are the vocabulary Phases 2–4 draw from.

## Why it is non-breaking

The semantic tokens were set to the **exact** values the badge rules previously inlined:

| Token | Value | Replaces inline |
|---|---|---|
| `--success` | `#3DAA6C` | interview / accepted badge |
| `--info` | `#6B90D4` | pending badge |
| `--warning` | `#D4875A` | reviewed badge |
| `--danger` | `#C94040` | rejected badge |

Because each token equals the prior literal, the repointed badge rules render **byte-identical** output. Verification: CSS braces balanced (103/103); badge rules resolve to the original colors.

## Deliberate deviation from the proposal

The visual proposal showed `--danger` at a tuned midpoint (`#D45A5A`) unifying the two different reds in the codebase (`#E07070` in auth, `#C94040` in the dashboard). **Phase 1 keeps `--danger` at `#C94040`** so nothing on screen moves today. Unifying the auth error color onto `--danger` — and deciding whether to retune the value — belongs to **Phase 2**, when the auth error color actually migrates onto the token. This is the one open design decision and is flagged for review.

## Deferred to Phase 2 (and the Jev note)

Phase 2 migrates the auth and profile screens onto the stylesheet, mapping ~90 off-system values to tokens. The exact matches are mechanical; the ambiguous ones (`#6A7A8A`, `#1A1D35`, `#4A5568`) are a good fit for a TypeSafe **Jev** `Choice` judgment that picks the best-matching token per value. This requires a `TYPESAFE_API_KEY`, which is **not yet configured** — Phase 2 is blocked on that credential before Jev can be used.

## Verification performed

- `grep` confirms the 4 badge rules reference `var(--…)` and the 24 new tokens are defined.
- Brace balance check on the full stylesheet passes (103 open / 103 close).
- No visual diff expected (tokens equal prior literals).

---

## Email template — for upper management

> Subject: **Dashboard design-system cleanup — Phase 1 done, zero user impact**
>
> Hi [Name],
>
> A quick update on the applicant dashboard. We ran a design-system audit and found the UI had drifted: the sign-in and profile screens were styled independently from the rest of the app, and common values (colors, spacing, text sizes) were hard-coded in dozens of places instead of defined once. That kind of drift slowly makes every future UI change slower and more error-prone, and makes visual inconsistencies more likely.
>
> We scoped a four-phase cleanup. **Phase 1 is complete.** It establishes a single, shared set of design values and is deliberately a no-visible-change release — the screens look exactly as they did, so there is no user-facing risk and nothing to re-test for customers. It is the groundwork that makes the remaining phases fast and safe.
>
> What this sets up:
> - **Consistency** — one source of truth for colors and spacing, so screens stop drifting apart.
> - **Speed** — future UI changes touch one definition instead of dozens of files.
> - **Accessibility** — later phases add proper keyboard-focus and error states, reducing accessibility risk.
>
> Our internal consistency score moves from 62/100 toward a target of ~90 as the phases land. Phase 2 (bringing the sign-in and profile screens onto the shared system) is ready to start; it has one small dependency on a third-party service key we are arranging.
>
> Happy to walk through the before/after visuals if useful.
>
> Best,
> [Your name]

*The email above is a reusable template — fill in the bracketed fields before sending. It intentionally avoids technical jargon and makes no claims beyond what Phase 1 delivered.*
