# DIRF Flow Board design

## Goal

Create a small desktop view of canonical DIRF Projects, Attempts, lifecycle progress, resume context, and linked Git worktree cleanup. It is a coordination viewer, not an issue tracker or live agent monitor.

## Boundary

- The application lives in `E:\dirf-flow-board`.
- DIRF remains the owner of canonical state under `~/.dirf/`.
- The application uses one-shot DIRF CLI calls returning JSON; it never reads DIRF files or imports `state.js` directly.
- DearFlow is a reference for its Electron shell, bucket sidebar, project filter, cards, and detail panel only.

## Attempt lifecycle

New Attempts start as `planned`. A user may Start, Advance, Block, Reopen, or Complete an Attempt. Start selects the first Workflow phase; Advance follows the stored phase order. Block requires a reason. Complete is available only on the final phase after the user confirms its done-when checks passed.

Each tracked Attempt may store a Worker label, Current Phase, lifecycle status, timestamps, blocker, and optional Linked Worktree. Multiple Attempts may be In Progress within one Project. Historical Attempts remain in History until individually upgraded with **Start Tracking**.

## Resume

Resume shows the canonical Project Handoff and Attempt Handoff read-only, with canonical Project state taking precedence. The application copies a host-neutral Resume Prompt containing the Project, Attempt, and Linked Worktree. It does not open a terminal or editor.

## Interface

The default is Portfolio View with the `In Progress` bucket selected. The sidebar contains `Planned`, `In Progress`, `Blocked`, `Done`, `History`, and `Cleanup`; a Project filter can pin the view. Attempt cards show name, Project, Current Phase, Worker, last update, and either blocker or next action. The detail panel contains Workflow progress, both handoffs, lifecycle actions, and Resume Prompt.

New Attempt asks for Project, main checkout or an existing worktree, short name, and one-sentence task. It calls the existing `dirf build` behavior and opens the resulting Planned card.

## Worktree hygiene

DIRF discovers worktrees through each registered Git Project; it never crawls drives. Linked worktrees whose Attempt is Done are immediately offered for archive. Unfinished worktrees become stale after a configurable period, default 14 days, without an Attempt update or Git commit. Unlinked worktrees are surfaced for linking or review.

Archive records Project, Attempt, path, branch, HEAD, cleanliness, and archive time without touching the checkout. After a configurable reminder period, default 30 days, removal is offered again. Nothing is deleted automatically. Dirty or conflicted worktrees remain Needs Attention and cannot be archived or deleted. Approved removal rechecks cleanliness and HEAD, removes only the worktree checkout, runs Git worktree prune, and never deletes its branch.

## Settings

Version one stores only DIRF CLI location, stale days, and archive reminder days in user-level `~/.dirf/settings.json`. It tries `dirf` on `PATH` first and otherwise remembers a user-selected `src/cli.js`.

## Excluded

Live agent detection, agent spawning, terminal embedding, transcript discovery, worktree creation, branch deletion, drag-and-drop state changes, handoff editing, filesystem watchers, notifications, and external issue synchronization.
