# Operator Context & Working Constraints

> This is a companion document to `vehicle-lead-finder-project-brief.md`. That file describes the *project*. This file describes the *person and environment building it*, since that shapes what advice is actually usable. Read both before advising.

---

## 1. Who is building this, and why it matters

The operator was **newly hired into an IT & Marketing officer role**, and this project (Vehicle Lead Finder) is their **first assignment** at the company. Relevant implications for any AI helping with this:

- This is likely being watched as a signal of competence in a new job — advice should favor **working, shippable, explainable** solutions over clever/exotic ones. If something breaks, the operator needs to be able to explain *why* it broke and *how it was fixed*, not just that an AI fixed it.
- The operator is learning the stack (Node.js/TypeScript/SQLite/Playwright etc.) largely *through* this project, guided by AI (ChatGPT so far, now this conversation) rather than from prior deep expertise. Explanations should assume a capable, fast-learning newcomer to this specific stack — not assume prior Node.js/backend project experience.
- There is no internal team or senior engineer backing this up day-to-day (per the original requirements doc, the operator is the sole user/operator of the tool, and marketing "never touches the tool"). The operator is effectively solo on the technical side.

## 2. Confidentiality constraint — important, ongoing

The company has **strict internal policies**, and the operator **cannot disclose company details, internal plans, or specifics** beyond what's needed to describe the technical problem. This means:

- Any future AI helping on this should **not push for company-identifying details** (company name, exact business plans, internal strategy, real financial/market data) to "do a better job" — the operator has already indicated they can't share that, and won't be able to regardless of how the question is framed.
- Town names, business categories, and the general shape of the project (B2B vehicle-services lead generation in Central Province, Sri Lanka) have been shared as necessary technical context and appear to be safe to discuss — but nothing beyond that should be assumed safe to ask for or infer further.
- If future context seems to nudge toward sensitive territory (e.g. "what's the actual outbound sales pitch," "what's the budget for this," "who are the real target clients"), the correct move is to work with what's already been shared rather than probing for more.

## 3. Technical environment — this is the part most likely to bite later

This is the most operationally important section, because it directly affects what's actually executable, and there's a real unresolved conflict inside the project plan because of it.

**Local machine (company-issued, policy-locked):**
- **Node.js is blocked** — both the standard installer and a portable/no-install version were tried; both were blocked by company policy/endpoint restrictions.
- **Successfully installed and usable locally:** VS Code, Git, and "Antigravity" (an agentic coding tool/IDE the operator has installed alongside VS Code).
- Because Node.js can't run locally, **no part of this Node.js project can currently be executed, tested, or debugged on the operator's own machine.**

**Actual development environment: GitHub Codespaces**
- All development so far — everything described in the project brief, including the working OSM collector, SQLite database, and test runs — has been done inside a **GitHub Codespace** (a cloud-hosted dev container), not locally.
- This is the *only* environment where `npm`/`node`/`ts-node` currently work for this operator.

**⚠️ This creates a direct conflict with an already-established part of the project plan:**
The implementation roadmap explicitly states that the real Google Maps collection run (Phase E) should happen from a **local/office machine**, specifically *because* cloud IPs (like Codespaces) are far more likely to get CAPTCHA'd or blocked by Google. That guidance was written before this constraint was fully surfaced. As it stands:
- The operator **cannot run Node.js locally at all**, so the originally-planned mitigation for the Google Maps CAPTCHA/blocking risk (do the real run from the office machine) **is not currently possible**.
- This needs to be treated as an **open, unresolved risk for Phase E**, not a settled detail — any future work on the Google Maps collector should revisit this before assuming the "run it locally" plan still holds. Possible directions worth considering when that phase comes up: whether Codespaces (or another cloud runner) can be made to work well enough despite the higher block risk, whether there's any policy-compliant way to get a Node runtime approved for that specific task, or whether the Google Maps source might need to be deprioritized/dropped if no workable execution environment exists for it.

## 4. How the operator has been working so far

- Primarily driving development by **asking an AI (ChatGPT, and now this conversation) what to do**, then implementing/pasting/running the guidance inside the Codespace.
- This has gotten a real, partially-working pipeline built (OSM collector, SQLite storage, phone-normalization merge logic) — so the approach is functional, just naturally uneven in places (as documented in the project brief's "what went wrong" section — e.g. unused config values, an unfixed known bug, dead schema).
- Git is installed locally and presumably used for version control/pushing to the Codespace-backed repo, but no further detail on branching/workflow has been discussed.

## 5. Multi-AI development workflow

The operator is coordinating multiple AI tools for this project:

- **Claude** — plans and manages the project overall (architecture decisions, task breakdown, guiding the development agent).
- **ChatGPT** — backup when Claude's usage limit is reached, and also used to independently verify/validate Claude's decisions.
- **Development agent** — originally **Antigravity** (local-only agentic IDE); as of this decision, switched to **Kilo Code installed as a VS Code extension while connected to the GitHub Codespace** (see the dedicated decision brief on this switch for full rationale).

**Why this changed:** Antigravity ran locally, but the project **cannot execute locally at all** (Node.js is blocked — see §3), so every change had to go through a slow push → switch-to-Codespace → run → switch-back loop before a mistake was even visible. Kilo Code, run as a VS Code remote workspace extension, executes *inside the Codespace itself* — same environment as `npm start` and the SQLite database — so the agent can run and observe results directly, without leaving the session.

**What this changes vs. what it doesn't:**
- The specific need to **pre-verify logic offline before handoff** (because testing was otherwise impossible until a push) is reduced — execution is no longer blocked.
- The need for **small, single-purpose, well-scoped tasks** is *not* reduced. A fast feedback loop makes each verification cheap; it doesn't make a broad multi-file change any easier to review or roll back if part of it is wrong. Scoping discipline is now valuable for reviewability and clarity, not because testing is expensive.
- The mindset shift: previously the goal was to **avoid needing to test** (each test cost a full environment round-trip). Now the goal is to **test after every scoped change, cheaply and continuously** — there's no reason to batch changes to "save" a test cycle anymore.

**Practical implications for how Claude (or any planning AI) should operate here:**
- Prefer handing the development agent **small, single-purpose, fully-specified changes** (one function or one file at a time) — this is about reviewability and easy rollback now, not round-trip cost avoidance.
- Each handoff should still come with **an explicit verification step** — exactly what to run and what output confirms success — so "done" isn't ambiguous, even though checking it is now cheap.
- Because ChatGPT is also validating Claude's decisions, and both AIs won't share memory/context automatically, **keeping a single up-to-date shared set of documents is what prevents the two planning AIs from silently drifting into contradictory guidance** — treat this pair (plus the decision briefs and task briefs) as the source of truth both are working from, and keep it current as decisions are made.

### Standard task-handoff template

Every task handed to the development agent should follow this shape — treating each one like a code review request rather than a loose instruction:

```
Task NNN — <one-line title>

Purpose:
  Why this change is needed (one sentence).

Scope (files that MAY change):
  - path/to/file.ts
  - path/to/other.ts

Out of scope (must NOT change):
  - anything not listed above — call it out explicitly if a temptation
    to touch something adjacent is likely (e.g. "do not touch schema.ts")

Expected behavior:
  Before: <short description or before/after diagram>
  After:  <short description or before/after diagram>

Verification (run in the Codespace):
  1. exact command to run
  2. exact command/query to check the result
  3. exact expected output — not "should work," but the literal
     expected rows/values
```

Smaller, single-purpose tasks (one file or one function) are strongly preferred over batched changes — see §5 above for why: a failed multi-file push costs a full round-trip to even identify *which* change broke it.

## 6. What this means for how future AI assistance should be shaped

- **Assume Codespaces as the only runnable environment** unless told otherwise. Don't suggest "just run it locally" as a troubleshooting step — it's not available.
- **Don't ask for or expect company-confidential details** to give good advice — work with the technical/project facts already established in the project brief.
- **Flag the Phase E (Google Maps) execution-environment conflict early** if/when that phase comes up — it's a real open problem, not a solved one, and revisiting it late (after other collectors are built) would be more costly than addressing it now.
- Favor **clear, explainable, teachable** solutions — this is a newcomer building their first real deliverable at a new job, largely via AI guidance, and will likely need to explain or defend decisions to others at the company later.
