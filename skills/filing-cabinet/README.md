---
name: filing-cabinet
kind: skill
description: "Inventory excessive Git worktrees, review branch history, and recommend archive/remove/retain actions behind an explicit single-use approval contract"
uses: []
details: ["CONTRACT.md"]
inputs: ["repository with worktrees", "approval to act"]
outputs: ["worktree inventory", "recommendations", "decision contract"]
capabilities: ["worktree hygiene", "governed maintenance"]
---

# Filing Cabinet

DIRF grows worktrees faster than they get cleaned up. This skill inventories
every worktree in a repository, classifies each by branch state and recency,
and recommends `retain` / `review` / `archive` / `remove` behind an explicit
single-use approval contract. It never deletes, archives, or rewrites anything
itself — the approval contract is enforced before any destructive action.

## When to use

- The repository has many worktrees and nobody remembers what they are.
- A session needs to know which worktree holds valid unmerged work.
- Cleanup was proposed and needs an evidence-backed decision.

## How it works

1. **Inventory** — run the bundled script
   (`scripts/filing-cabinet.mjs`) in the repository: it lists every worktree
   with its branch, merge status against the default branch, ahead/behind
   counts, dirty state, and last commit date.
2. **Classify** per the risk classes in the decision contract:

   | Action class | Risk | Gate |
   |---|---|---|
   | inventory / review | none | allow (read-only) |
   | worktree archive | low | logged, no approval |
   | worktree remove | moderate | single-use approval |
   | branch delete | high | single-use approval + merged-or-backed-up evidence |
   | history rewrite | deny | written mandate only |
   | consolidate into PR | moderate | approval to publish |

3. **Recommend** — each worktree gets exactly one of
   `retain` / `review` / `archive` / `remove` with the evidence that supports it.
4. **Act only on approval** — the operator approves per item; the approval is
   single-use, names the exact worktree/branch and action, and binds the
   evidence digest. Nothing runs without it.

## Evidence requirements (summary)

- archive: worktree listed in the inventory; clean or dirty recorded
- remove: inventory entry + branch merged status + last commit date
- branch delete: `git branch --merged` proof or a named backup ref
- history rewrite: written mandate + backup plan (denied by default)
- PR consolidation: diff summary + review notes + test evidence

See [CONTRACT.md](CONTRACT.md) for the full allow/deny/approval contract.

## Rules

- The inventory script is read-only. It never checks out, deletes, archives,
  merges, pushes, or rewrites anything.
- A dirty worktree is never recommended for removal without review.
- Valid unmerged work found in a cleanup candidate is consolidated into a PR
  before any removal is approved.
- The repository owner is the sole authority; no agent-initiated destructive
  action happens without their per-item single-use approval.
