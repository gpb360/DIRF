# DIRF Flow Board implementation plan

## 1. DIRF JSON contract

- Add JSON output only to the Project, Attempt, Handoff, Resume, and worktree-facing commands required by the Flow Board.
- Add canonical lifecycle operations in `state.js` and thin CLI commands for Start Tracking, Start, Assign Worker, Advance, Block, Reopen, and Complete.
- Add user settings and Linked/Archived Worktree state through `state.js`.
- Add read-only registered-project worktree inspection plus approval-gated archive/removal operations.
- Keep existing human CLI output compatible while shortening only touched command language.
- Test lifecycle transitions, final-phase completion gate, legacy compatibility, stale calculation, dirty/conflicted protection, HEAD recheck, and branch preservation.

## 2. Create `E:\dirf-flow-board`

- Initialize a separate Git repository using Electron, React, TypeScript, and `electron-vite`.
- Selectively reproduce DearFlow's window shell and manager layout; do not copy its terminal, SQLite ledger, provider, transcript, agent, or worktree orchestration services.
- Add a context-isolated preload API and main-process DIRF CLI adapter with strict argument construction and JSON validation.
- Discover `dirf` on `PATH`; add the one-time CLI file picker fallback.

## 3. Read-only Flow Board

- Load Portfolio View, project filter, bucket counts, grouped Attempt cards, and detail panel.
- Render Workflow phases and both handoffs read-only.
- Add explicit Refresh and refresh after every successful action.
- Cover empty store, unavailable DIRF, malformed JSON, historical Attempts, and missing handoffs.

## 4. Lifecycle and Resume

- Add New Attempt and Start Tracking.
- Add valid state-specific lifecycle actions with confirmation where required.
- Add Worker entry with tags sourced from prior Worker labels.
- Generate and copy the agreed Resume Prompt.
- Test invalid transitions, phase order, blocker requirements, completion confirmation, and shell-safe task arguments.

## 5. Cleanup bucket

- Show completed, stale, unlinked, Needs Attention, archived, and reminder-due worktrees.
- Add Link, Archive, Remind Later, and approved Remove actions.
- Revalidate Git state immediately before archive/removal and display why unsafe items are blocked.
- Verify a clean disposable fixture worktree can be archived and removed while its branch remains.

## Release gate

- DIRF validation and Node test suite pass.
- Flow Board typecheck, build, and focused lifecycle/IPC tests pass.
- Manual Windows smoke proves project listing, attempt creation, lifecycle transitions, copied Resume Prompt, History tracking, worktree linking, archive reminder, and safe checkout-only removal.
