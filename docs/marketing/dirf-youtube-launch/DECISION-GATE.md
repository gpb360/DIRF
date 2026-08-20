# Recording decision gate

Reply with **Approve recommended defaults** or list only the items you want
changed. Approval here opens Gates A and B for script locking; it does not
authorize voice credits, rendering, upload, scheduling, or publication.

## Recommended defaults

1. **Positioning — approve.**
   - Category: “The preflight, routing, continuity, and evidence layer for
     agent work.”
   - Campaign line: “Keep your agent stack. Give it a route, a record, and a
     finish line.”
2. **Pronunciation — “derf.”**
   - First mention: “DIRF—said *derf*—means Do It Right First.”
   - Use DIRF in captions and on screen.
3. **Public repository — approve.**
   - URL: `https://github.com/gpb360/DIRF`
   - DIRF currently runs from a local clone; do not call this an npm package
     installation.

     ```bash
     git clone https://github.com/gpb360/DIRF.git
     cd DIRF
     node src/cli.js
     ```
4. **Project proof — anonymize by default.**
   - Show Project A–D and describe the project type.
   - Do not show Project A–D by real name, client data, private repository
     names, local user paths, or secrets until
     each name is separately approved for publication.
5. **Narration — local-only.**
   - Record the test locally and commit only the text script and timing notes.
   - Audio files remain private and ignored by Git.
6. **Recording baseline — exact current `main`, labeled honestly.**
   - Candidate SHA: `886a7627f471bf03f7b1db454fbdaf16c4e38cbc`.
   - Package metadata still says `0.26.1`; describe this as “current DIRF main,”
     not “the v0.26.1 release.”
   - The published v0.26.1 release resolves to
     `34267f30b04eb74d3ffd9997f8b3d6ece499e88f` and lacks the governed-action
     CLI used in episode five.
   - After approval, create a clean recording worktree at the candidate SHA,
     run the complete validation gate, and replace the candidate with the
     verified recording SHA in every episode manifest.

## 60-second narration test

> Most AI agent work does not fail because the model cannot write code. It
> fails between the moments of work. The task changes, the next session loses
> the route, a different agent loads the wrong skills, and “done” arrives
> before the evidence does. DIRF—said derf—means Do It Right First. It does not
> replace your agent, your coding method, or your judgment. It looks at the
> task, the repository, and the capabilities already installed on your
> machine. Then it creates a lean route, keeps a record of the attempt, and
> carries one exact next action into the next session or worktree. Keep your
> agent stack. Give it a route, a record, and a finish line. In this series,
> I’ll show the real commands, the boundaries, and where DIRF fits beside the
> tools you already use.

## Live-state evidence captured 2026-08-11

- Local checkout: `86347bb49706a87e798231d7826418e29b3ab292`
- `origin/main`: `886a7627f471bf03f7b1db454fbdaf16c4e38cbc`
- Local checkout: four commits behind, with unrelated untracked files present
- Latest public release: v0.26.1, published 2026-08-08
- PR #28 merged into current main: tracker-neutral, local-first issue governance
