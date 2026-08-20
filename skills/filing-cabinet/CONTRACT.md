# Filing Cabinet — allow / deny / approval decision contract

Accepted evidence requirements (attempt filing-cabinet, decision gate
"check evidence requirements", 2026-08-20).

## Authority

The repository owner is the sole authority. No agent-initiated destructive
action without an explicit single-use approval naming the exact worktree or
branch, the exact action, and the bound evidence digest. Approval is consumed
once; a later policy cannot loosen an earlier denial.

## Action classes

| Class | Example | Risk | Decision |
|---|---|---|---|
| inventory | list worktrees, branches, state | none | allow (read-only) |
| review | inspect branch history, diffs | none | allow (read-only) |
| archive | move worktree aside without branch loss | low | allow, logged |
| remove | unlink a worktree (branches intact) | moderate | approval required |
| branch delete | delete a branch with unmerged commits | high | approval required + evidence |
| history rewrite | force-push rebase, filter-branch | deny | written mandate only |
| publish | merge / push a consolidation PR | moderate | approval required |

## Evidence requirements (per class, before approval)

- **archive / remove worktree**: inventory entry for the exact path; branch
  merged status (`git branch --merged <default>`); ahead/behind counts; dirty
  state (`git status --porcelain`); last commit date.
- **branch delete**: merged proof or a named backup ref (tag or remote);
  last commit date; PR link if one exists.
- **history rewrite**: written mandate naming the exact refs and the intended
  result; backup plan (bundle or tag) recorded before any rewrite. Denied by
  default.
- **PR consolidation**: diff summary; review notes; test evidence; the exact
  PR number and target branch.

## Recommendations

Every inventoried worktree receives exactly one recommendation:

- **retain** — clean and merged, or actively recent; keep.
- **review** — dirty, or unmerged with recent commits; inspect before deciding.
- **archive** — clean and unmerged but stale; archive rather than remove.
- **remove** — clean, merged, and stale; safe to remove after approval.

A dirty worktree is never recommended for removal without review. Valid
unmerged work found in a cleanup candidate is consolidated into a PR before
any removal is approved.

## Enforcement

The inventory script (`scripts/filing-cabinet.mjs`) is read-only and performs
no state change. Destructive actions are performed only by the operator after
per-item approval. Denials are final for the named target until new evidence
is supplied.
