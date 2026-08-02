# DIRF Flow Board contract handoff

## Objective

Implement the DIRF contract required by the separate `E:\dirf-flow-board` application.

## Current phase

Contract implemented; Flow Board application built; final review complete.

## Completed

- Added tracked Attempt lifecycle metadata, phase transitions, Worker assignment, blockers, completion confirmation, and historical Start Tracking.
- Added JSON output for project/attempt/resume data and lifecycle/settings/worktree commands.
- Added user settings for stale and archive reminder intervals.
- Added registered-project worktree inspection, safe archive/reminder/remove flow, dirty/conflict protection, HEAD recheck, and branch preservation.
- Created the separate Electron Flow Board with portfolio bucket sidebar, cards, detail/handoff view, Resume Prompt copy, New Attempt, Settings, and Cleanup bucket.

## Changed files

- `src/state.js`, `src/cli.js`, `tests/flow-board-contract.test.js`
- `E:/dirf-flow-board/`
- Design, ADR, and plan documents under `docs/`

## Validation

- DIRF full suite: 157 passed, 1 skipped.
- Focused lifecycle/worktree suite: 5 passed.
- Flow Board `npm run typecheck`: passed.
- Flow Board `npm run build`: passed.
- `git diff --check`: passed in both repositories.

## Risks

- npm reports 4 Flow Board dependency vulnerabilities; no forced audit downgrade was applied.
- Electron runtime/browser smoke remains manual on Windows.

## Exact next action

Open `E:\dirf-flow-board` with `npm run dev`, choose the DIRF CLI in Settings if PATH discovery fails, and perform the manual lifecycle/worktree smoke.
