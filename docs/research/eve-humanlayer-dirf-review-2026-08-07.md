# DIRF research review — eve.dev + HumanLayer docs

**Date:** 2026-08-07 · **Method:** two parallel research agents (web docs only, no
repo cloning) · **Purpose:** revisit the two doc sets that informed DIRF's
initial design, learn the patterns/processes, and map what's worth importing.

---

## TL;DR

- **HumanLayer pivoted.** The human-in-the-loop SDK we originally borrowed the
  progressive-handoff idea from is gone from the docs. HumanLayer is now a
  task-running platform for coding assistants (tasks, cloud-synced artifacts,
  comment-driven review, guarded workflow checkpoints). The closest analog to
  DIRF's HANDOFF is now **"artifacts as durable handoff state."**
- **Repo recovered, and it's deprecated.** `github.com/humanlayer/humanlayer`
  is not archived but officially deprecated (README replaced 2026-06-19 with
  a notice pointing to a "rebuild" at humanlayer.com; last real commit
  2026-01-07; the SDK was deleted from the tree 2025-09-29, PR #646). A local
  clone exists at `E:\humanlayer` (2,097 commits) — the **full original SDK,
  its Mintlify docs (34 files), and examples were recovered from git history**
  at commit `4f3987f3`. This is the definitive source for the progressive-
  handoff doctrine DIRF borrowed; the repo's own deprecation notice confirms
  gates-as-workflow was the durable pattern.
- **eve.dev is Vercel's agent framework** (open-source, beta, June 2026), and
  its docs-for-AI layer is the single richest import: a four-tier doc surface
  (`llms.txt` / typed `sitemap.md` / `llms-full.txt` / per-page `.md` routes),
  an `agents.md` with fail-closed operational rules, compiler-enforced
  metadata, step-level durable checkpoints, and two-tier eval severity.
- **DIRF already has** the core ideas (ponytail-lean routing, description-as-
  routing-metadata, stack-aware routing, typed registries, handoff
  checkpointing). The findings below are **deltas**, not re-imports.
- Highest-value imports: **verification contract + fail-closed clause**,
  **drafting-separated-from-approval**, **handoff-before-switch rule**,
  **gate-vs-soft done-when tiers**, **replay-don't-rerun resume semantics**,
  **guarded auto-advance**, **typed sitemap with prerequisites**.

---

## 1. What the two products are today

**eve** (eve.dev) — Vercel's filesystem-first framework for durable backend
agents ("Like Next.js for agents"). An agent is a directory: `instructions.md`
is the permanent identity, optional `skills/` (on-demand procedures),
`tools/`, `subagents/`, `channels/`, `connections/`, `schedules/`, `evals/`.
Ships durable step execution, sandboxed compute, approval gates, LLM-as-judge
evals. Docs are at `eve.dev/llms.txt` (live), `llms-full.txt` (877 KB corpus),
`sitemap.md` (typed index), `agents.md` (operational rules).

**HumanLayer** (docs.humanlayer.com) — macOS desktop app + remote daemons that
run Claude Code/Codex sessions against your repos, organized into **tasks**
with cloud-synced **artifacts** (numbered markdown files, 10 MB cap) and
comment-driven review. Workflows: RPI (default), PRD-Oriented, Oneshot,
Freeform. No llmstxt (404s). The old approval-SDK API
(`@hl.require_approval()`, contact channels, escalations) no longer exists in
the docs.

---

## 2. Pattern library

### 2.1 Docs-for-AI (from eve — the deepest vein)

- **Four-tier doc surface.** `llms.txt` = curated, task-ordered index with
  per-link one-line descriptions, usage instructions *inside the file itself*
  ("use this to choose the smallest relevant documentation set"). `sitemap.md`
  = typed semantic index of every page with `Type | Summary | Prerequisites |
  Topics | Canonical` — machine-queryable, filterable before fetching.
  `llms-full.txt` = one concatenated corpus for offline/large-context.
  Per-page `.md` routes = lazy-load one level deep.
- **Prerequisites as an encoded dependency graph.** The sitemap's
  `Prerequisites` field (e.g. MCP page → `Prerequisites: /docs/connections`)
  lets an agent pre-order its reading and skip what it already has.
- **agents.md with fail-closed rules.** "Do not assume API, authentication,
  OpenAPI, or MCP support unless it is listed in this file." "Verify setup
  with `eve info --json` before reporting success." "Ask the user only for
  genuine decisions (name, model, channels, provider, deploy); automate
  everything else."
- **Version-matched bundled docs.** The npm package ships its own docs
  (`node_modules/eve/docs`) and both llms.txt and the official skill direct
  agents to prefer version-matched docs over the live site — kills the
  "newest-docs-vs-older-install" drift failure.
- **Skills split by load timing, not content type.** `instructions.md` stays
  short and stable (prepended to every call); skills load on demand via a
  `load_skill` tool; the *description* frontmatter is the routing hint
  ("Use when the user needs a release checklist…"), with fallback to the first
  non-empty body line. Compiler **rejects** subagents with no description —
  metadata-or-it-doesn't-build.

### 2.2 State, resume, checkpoints (eve + HumanLayer)

- **Step-level durable checkpoints.** Session/Turn/Step; a step is "a durable
  checkpoint inside a turn." Completed steps never re-run — the framework
  replays the recorded result. Waiting work parks durably and holds no
  compute until its input arrives (approval, OAuth, subagent completion).
- **Artifacts as durable handoff state (HumanLayer).** Every phase's output is
  a numbered markdown artifact; the artifact *is* the handoff state. Session-
  continuation protocol: continue in-session while context remains; **write
  every current decision into the artifact before switching sessions**; on
  near-exhaustion, start a new session with the matching skill + feedback.
- **Deterministic conflict tie-breakers.** "Later artifacts take priority over
  earlier artifacts; live code beats any document for current behavior."

### 2.3 Gates and approvals (HumanLayer — the pivot's core)

- **Checkpoint = drafting separated from approval.** "The agent can propose a
  choice, but the user owns the decision." PRD/TDD approvals, design-
  discussion resolutions are user-owned; research "describes the current
  state and does not choose a future design."
- **Guarded auto-advance.** Covered transitions auto-start the next session;
  the four design→implementation handoffs always wait for the user. "Each
  transition turns itself off after it runs" — no duplicate newer phase.
- **Shortest workflow with the review points you need.** RPI (combined design
  discussion) vs PRD-Oriented (two review points: product before technical) vs
  Oneshot ("a clear and small change can use Oneshot"). Workflow selected to
  fit the decision surface, not the content.
- **Vertical-slice phases.** Implementation split into "phases that a person
  can check" — each names one testable result, the files it changes, its
  checks; each slice "ends with something runnable, visible, or queryable."
  Normal flow pauses after a phase for manual review.
- **Non-blocking external integration.** A failed GitHub update "does not
  block the artifact save."

### 2.4 Delegation and economics (eve + HumanLayer)

- **Zero inherited context.** Declared subagents inherit nothing from the
  root; the root-copy `agent` tool passes data only via its `message` input.
- **Per-session dynamic capability resolution with a compiled static
  fallback** (eve `defineDynamic`): model/tools/skills can switch per session
  from lifecycle events; the `fallback` anchors build-time metadata.
- **Model/effort economics (HumanLayer).** Sub-agents run cheaper models at
  lower effort by default; "inherit" = exact parent model, reserved for the
  implementer. Same flavor as DIRF's Cost-Aware Planning policy.

### 2.6 The original HITL SDK (recovered from `E:\humanlayer` git history)

The SDK era (Python `humanlayer` + TS `@humanlayer/sdk`, feature-identical
mirrors, last version 0.7.10-alpha.1) — the source of the progressive-handoff
ideas DIRF borrowed, now precisely documented:

- **Approval gate as tri-state record.** `FunctionCallStatus.approved:
  bool | None` — **null = still pending** (absence encodes state, never
  "unknown"); denial requires a `comment`; `reject_option_name` gives
  structured feedback; `ResponseOption{prompt_fill, interactive}` lets the
  human send pre-filled steering prompts back to the agent. Denial returns a
  string ("User denied {fn} with message: {comment}") fed into the LLM
  tool-result so the model self-corrects.
- **The store is the contract; decorators are sugar.** The core is an
  `AgentStore` abstraction (`add / get / respond / escalate_email`) over a
  REST backend; `@hl.require_approval()` and `hl.human_as_tool()` are thin
  wrappers. `human_as_tool` generates the tool's `__name__`/`__doc__` from
  channel context (`contact_human_in_slack_in_the_channel_with_the_director_of_engineering`)
  so the agent knows its audience; `allowed_responder_ids` restricts who may
  respond.
- **run_id / call_id / state triad.** `run_id` groups all calls of one
  execution; `call_id` is per-request (manually settable to match external
  IDs); the `state` dict is **preserved across the request lifecycle** and
  returned in webhooks, with explicit **versioned-state guidance** (version
  key, `migrate_v1_to_v2`, validate-on-restore, fallback for missing state).
- **Threading rules for multi-turn handoffs.** Email carries `subject`,
  `references_message_id`, `in_reply_to_message_id` (plus a one-call
  `EmailContactChannel.in_reply_to()` constructor); Slack carries `thread_ts`.
  A resumed turn continues the same thread — it does not spawn a new one.
- **Escalation.** `Escalation{escalation_msg, additional_recipients, channel}`
  — same request, widened recipients (to/cc/bcc) or switched channel, plus an
  urgency message.
- **CLI fallback mode.** No API key → `ApprovalMethod.CLI`: stdin prompt
  ("Hit ENTER to proceed, or provide feedback to the agent to deny"), denial
  returns a string, never raises. One code path, backend optional — the
  zero-dependency spirit DIRF shares.
- **Testability via injection.** `genid` (ID generator) and `sleep` (poll
  delay) are injectable; the client is a stateless poller
  (`while True: sleep(3); get(); if status null: continue`).
- **Progressive handoff, in the wild** (`examples/fastapi-email/app-statehooks.py`):
  a `Thread` model stamped into every spec's `state`; webhook handlers resume
  threads via `Thread.model_validate(spec.state)`; an LLM decides the next
  phase (`request_more_information | ready_to_draft_campaign |
  human_approved__campaign_ready_to_publish`). Durable state blob + resume-on-
  response + LLM-driven phase progression — exactly DIRF's handoff checkpoint
  model.
- **Post-pivot session machine** (`hld/session/types.go`): draft → starting →
  running → completed/failed, plus `interrupted` (resumable),
  `waiting_input` (tool-approval wait), `discarded`; `ApprovalReconciler.
  ReconcileApprovalsForSession(runID)` reconciles approvals after a restart;
  `--resume <SessionID>` continues a session. The operational core of the
  current product, unreferenced by any docs site.

### 2.7 Repo-only docs-for-AI artifacts (no llms.txt anywhere in history)

- `docs/core/state-management.mdx`, `run-ids-and-call-ids.mdx`,
  `email-escalation.mdx` — the recovered SDK-era doctrine.
- `humanlayer.md` — the "Gen 3 autonomous agents" vision: agents needing
  `sleep_until`, orchestration that "durably serialize[s] and resume[s] agent
  workflows across tool calls that might not return for hours or days."
- `CLAUDE.md` + `docs/docs.knowledge.md` + `release.knowledge.md` — release
  discipline: "Always document new parameters in models.py/models.ts with
  their exact names"; "Always query changes from git before updating
  CHANGELOG.md"; "Document features in their final release version, not in
  prep/RC versions."

### 2.5 Evals (eve)

- **Two severity tiers.** Failed *gates* exit non-zero; *soft* assertions mark
  the eval `scored` — tracked, visible, not fatal unless `--strict` (which is
  what CI runs). `mockModel` fixtures give deterministic tool loops.
- **Path-derived identity.** `evals/weather/brooklyn.eval.ts` → id
  `weather/brooklyn`. The file path is the eval's identity.

---

## 3. Gap map — DIRF today vs the findings

| DIRF component (today) | Finding | Gap / recommendation |
|---|---|---|
| `policies/workflow-policy.md` — Workflow Audit (name verify command + result) | eve agents.md: fail-closed "do not assume" + verify-before-claiming-done | No fail-closed anti-hallucination clause; verification is audit, not gate. Add **Verification Contract**: per-phase verify command named in advance; "done" requires its output; "do not assume X unless listed." |
| `policies/workflow-policy.md` — Governance Boundary (state-changing needs mandate) | HumanLayer: drafting separated from approval; user owns design decisions | Covers *state-changing* actions only. Add **decision-ownership clause**: agents draft/propose freely; product/design decisions are user-owned unless the task mandates otherwise; playbooks may mark decision gates. |
| `policies/workflow-policy.md` — Context Reserve (update HANDOFF at 5% reserve) | HumanLayer: write decisions into the artifact *before switching sessions* | Trigger is context-exhaustion only. Make **handoff-before-switch** a hard rule: write decisions into HANDOFF.md before ANY session/agent switch, not only at the reserve. |
| `src/state.js` `advance()` — binary done-when | eve: gate vs soft severity, `--strict` | Add **done-when severity tiers**: `[gate]` blocks advance; `[soft]` tracked data; `--strict`/CI mode promotes soft→gate. |
| `src/state.js` resume — handoff checkpointing (progressive, recent) | eve: completed steps never re-run; replay recorded result | Resume semantics implicit. **Replay contract**: completed phases replay recorded evidence, never re-execute; record evidence ref (verify command + output path) in `attempt.json` at advance. Align naming with "step checkpoint" language. |
| `src/state.js` advance — manual only | HumanLayer: guarded auto-advance, single-fire | Optional `advance --auto`: advances covered transitions, stops at per-playbook gates; single-fire guard (no duplicate phase). |
| `src/router.js` — keyword×3 + stack affinity, demotions | HumanLayer: shortest workflow with the review points you need | Router selects by content, not decision surface. Add **review-point fit**: small/cosmetic/tiny-change signals demote to a leaner playbook (improve-plan) — same shape as the existing medium-noun demotion. |
| `registry/` + `dirf skills scan` | eve sitemap.md: typed index with `Prerequisites` | Registries exist but no published dependency graph. Add `prerequisites` to playbook frontmatter; emit a **typed sitemap** (`dirf sitemap`) listing resolved playbook/agent/skill graph so agents pre-filter before loading. |
| `src/skills.js` — description frontmatter as routing metadata (already!) | eve: same convention + first-non-empty-body fallback + compiler-enforced required | Already aligned. Delta: enforce **description-required** in `dirf validate` for playbooks/skills/agents (eve rejects at build). |
| `dirf build` — build-time routing | eve: per-session dynamic resolution with static fallback | Keep build-time as the compiled default. Add optional **re-resolution on resume** (`resume --reroute`): re-scan installed skills, annotate drift vs the build-time resolution. |
| `playbooks/research/README.md` — 4 lean phases, "mark claims unverified" | eve 4-tier surface + fail-closed; HumanLayer research-vs-design separation | Enrich research playbook: per-claim source tracing, source typing (primary/secondary), decision restatement; recovery rule "each claim traces to a cited source or is marked unverified." |
| Docs, one-level-deep, markdown-authoritative | eve: llms.txt with usage instructions inside the file | **Dogfood**: add `docs/LLMS.txt` (or root `llms.txt`) index for amf-dirf itself — task-ordered, per-link one-liners, usage rules inside the file. |
| — (absent) | HumanLayer: "later artifact wins; live code beats docs" | Add to policy as the **conflict tie-breaker**: among artifacts, later wins; live code beats any doc for current behavior. |
| — (absent) | HumanLayer: failed external update doesn't block the artifact save | Resilience rule: a failed git/PR/push must not block writing the handoff (offline-first ordering). |
| `src/state.js` done-when gates — binary pass/fail | SDK: tri-state `approved: bool\|None` (null = pending), denial requires comment, `reject_option_name` structured feedback | **Gate semantics**: pending-as-absence (never "unknown"); deny-with-comment feeds back into the instruction set as revise-and-retry; `[soft]`/`[gate]` tiers from eve fit on top. |
| `src/state.js` attempt status: planned/in_progress/blocked/done + reopen | hld session machine: interrupted (resumable) + `waiting_input` (tool-approval wait) + discarded; `ApprovalReconciler` after restart | Add **explicit wait types** to status: `waiting_input` vs `blocked`; resume path reconciles pending gates (like the reconciler) instead of relying on the handoff alone. |
| Handoff schema v2 + non-destructive migration (already!) | SDK versioned-state guidance: version key, migrate funcs, **validate-on-restore, fallback for missing state** | Already close. Adopt the restore contract verbatim: on resume, validate handoff against schema, fall back gracefully if a field is missing. |
| `dirf resume` — continues attempt | SDK email threading (subject/references/in_reply_to) + Slack `thread_ts` | **Thread identity**: attempts carry reply-to pointer (parent attempt id / phase); resume continues the same thread instead of spawning a new one. |
| `blocked` status holds a blocker string | `Escalation{escalation_msg, additional_recipients, channel}` | **Escalation semantics**: same attempt id, widened notification set + escalation note marking urgency — blocked ≠ abandoned; an attempt can escalate without forking. |

---

## 4. Ranked recommendations

### P0 — policy clauses (small diffs, large behavior change)

1. **Verification Contract** in `policies/workflow-policy.md` (from eve
   agents.md): each phase names its verify command up front; "done" requires
   its output; fail-closed — "do not assume a capability unless listed."
2. **Decision ownership** (from HumanLayer checkpoints): drafting separated
   from approval; agents propose, user owns product/design decisions; playbook
   frontmatter can mark decision gates.
3. **Handoff-before-switch** hard rule (from HumanLayer session-continuation):
   write decisions to HANDOFF.md before any session/agent switch — the rule
   that makes multi-session work drift-proof.

### P1 — state.js / attempts

4. **Done-when severity tiers**: `[gate]` vs `[soft]` in playbook done-when;
   `advance()` blocks on gates only; `--strict` promotes soft→gate.
5. **Tri-state gate semantics** (from the recovered SDK): pending-as-absence
   (never "unknown"); denial requires a comment; deny-with-comment feeds back
   into the instruction set as revise-and-retry. This is what makes `[gate]`
   a real gate, not a pass/fail check.
6. **Replay-don't-rerun**: at `advance()`, record evidence ref (verify command
   + output) in `attempt.json`; resume replays recorded results for completed
   phases instead of re-running them.
7. **Guarded auto-advance**: `advance --auto` with per-playbook gated
   transitions; single-fire guard so a transition can't duplicate a phase.
8. **Explicit wait types + reconciliation**: statuses gain `waiting_input`
   (vs `blocked`); resume reconciles pending gates (the `ApprovalReconciler`
   idea) rather than trusting the handoff alone. Thread identity on resume:
   attempt carries a reply-to pointer so `resume` continues the same
   conversation. Escalation semantics for blocked attempts: same attempt id,
   widened notify set + escalation note — blocked ≠ abandoned.

### P2 — router / registry / docs

7. **Typed sitemap**: `prerequisites` field in playbook frontmatter +
   `dirf sitemap` emitting the resolved graph (playbooks/agents/skills with
   prerequisites) — pre-filter before load.
8. **Review-point fit in the router**: small/cosmetic/tiny-change signals
   demote to a leaner playbook (shortest workflow with the review points you
   need).
9. **`resume --reroute`**: optional re-scan of installed skills on resume,
   annotating drift vs the build-time resolution (static fallback stays the
   compiled default).
10. **Dogfood llms.txt**: `docs/LLMS.txt` index for amf-dirf — task-ordered,
    usage rules inside the file.
11. **Research playbook enrichment**: per-claim source tracing + source
    typing + decision restatement.

---

## 5. Deliberate non-imports (keep DIRF lean)

- **Don't become a platform.** HumanLayer's pivot (daemons, cloud sync,
  artifacts service) validates DIRF's zero-dependency, offline kit stance.
  No SDK, no daemons, no cloud.
- **No 4-tier docs wholesale.** One-level-deep + a root llms.txt index is the
  lean version; `llms-full.txt`-style corpora are overkill for a kit.
- **No per-session dynamic capabilities by default.** Build-time deterministic
  routing is a feature (reproducible attempts); dynamic resolution only as the
  opt-in `resume --reroute`.
- **No model-economics tables.** HumanLayer's subagent model/effort matrix
  conflicts with DIRF's Runtime Portability (host-agnostic). Model choice stays
  the host's; Cost-Aware Planning already covers the principle.
- **No approval infrastructure.** DIRF represents gates as playbook phases +
  policy, not runtime primitives. HumanLayer's approval SDK *disappeared* —
  gates-as-workflow (their new model) is the durable pattern.

---

## 6. Open questions (for Gary)

1. P0 policy clauses — ship all three in one pass, or pick one to pilot first?
2. Is `advance --auto` worth a CLI surface, or should gated transitions stay
   purely documented in playbooks (policy-only)?
3. Should `resume --reroute` warn (annotate) or hard-fail when the installed
   skill set drifted from build time?
4. `dirf sitemap` vs extending `dirf skills scan` — separate command or a
   `--graph` flag?
5. `E:\humanlayer` is a local clone of the deprecated repo — keep it as the
   permanent reference for the recovered doctrine, or trim it to the recovered
   docs + examples (saves ~disk, loses full history)?
6. Do we extend the attempt lifecycle with `waiting_input` / `interrupted`
   states now, or is `blocked` + blocker string enough for the current
   playbook set?

---

## Sources

- eve.dev: [llms.txt](https://eve.dev/llms.txt),
  [sitemap.md](https://eve.dev/sitemap.md),
  [agents.md](https://eve.dev/agents.md), llms-full.txt, docs pages
  (agent-config, instructions, skills, subagents, evals, context control,
  durable state, dynamic capabilities, remote agents). All live, fetched
  2026-08-07. Marketing: [Introducing eve (Vercel blog)](https://vercel.com/blog/introducing-eve).
- HumanLayer docs site: [docs.humanlayer.com](https://docs.humanlayer.com/) —
  Tasks, Workflow phases, Skills & workflows reference, Workspace model,
  Remote daemons, System prompt additions, Sub-agent models, GitHub/Slack
  guides, Release notes (v0.101.7–0.153.0). `llms.txt`/`llms-full.txt` 404
  (they publish no llmstxt).
- HumanLayer repo: `github.com/humanlayer/humanlayer` (not archived; README
  replaced 2026-06-19 with deprecation notice; last real commit 2026-01-07;
  SDK deleted 2025-09-29, PR #646). Read via the **local clone at
  `E:\humanlayer`** (HEAD `bdea199c`, 2,097 commits) — SDK recovered from
  commit `4f3987f3` via `git show`. Key files: `humanlayer/core/{models,
  approval, cloud, protocol}.py`, `humanlayer-ts/src/approval.ts`,
  `docs/core/{state-management, run-ids-and-call-ids, email-escalation}.mdx`,
  `examples/{openai_client/01-math_example.py, fastapi-email/app-statehooks.py}`,
  current-code `hld/session/types.go`, `hld/store/store.go`,
  `hld/approval/types.go`, `hld/bus/types.go`, `hld/mcp/server.go`,
  `claudecode-go/types.go`, `humanlayer.md`, `docs/docs.knowledge.md`.
  Old SDK surface also cross-checked on
  [PyPI](https://pypi.org/project/humanlayer/).
- **Verification note:** all claims above trace to the cited pages/files;
  where a URL 404'd it is flagged in the agent reports. No repos were cloned
  by this review — the `E:\humanlayer` clone predates it.
