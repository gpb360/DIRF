---
name: record-progress
kind: skill
description: "Record workflow progress after each step and keep HANDOFF.md current for session recovery"
uses: []
details: []
inputs: ["progress message", "phase", "next action", "changed files"]
outputs: ["updated HANDOFF.md"]
capabilities: ["session recovery", "progress tracking"]
---

# Record Progress

Automatically track workflow progress and keep HANDOFF.md current for session recovery.

## What It Does

This skill ensures `HANDOFF.md` is always up-to-date by recording progress after each workflow step. When a session terminates (from context limits, time limits, or manual termination), you can resume exactly where you left off.

## How to Use

### CLI Command

```bash
dirf record-progress "Completed user authentication endpoint" \
  --phase "implement backend" \
  --next "Implement password reset flow" \
  --files "src/api/auth.js,src/middleware/auth.js"
```

### MCP Tool (for AI agents)

```json
{
  "name": "dirf_record_progress",
  "arguments": {
    "message": "Completed user authentication endpoint",
    "currentPhase": "implement backend",
    "nextAction": "Implement password reset flow",
    "changedFiles": ["src/api/auth.js", "src/middleware/auth.js"]
  }
}
```

## What Gets Updated

Each call updates these sections in HANDOFF.md:

- **Current phase**: Where you are in the workflow
- **Last action**: What you just completed (with timestamp)
- **Completed steps**: Running list of completed work
- **Changed files**: Files modified in this step
- **Exact next action**: What to do next

## Example Workflow Session

```bash
# Start work on authentication system
dirf build auth-system "Implement user authentication"

# After completing user interviews
dirf record-progress "Defined user outcomes and requirements" \
  --phase "discovery" \
  --next "Review existing authentication patterns"

# After reviewing patterns
dirf record-progress "Reviewed existing auth patterns in codebase" \
  --phase "discovery" \
  --next "Implement authentication endpoints" \
  --files "docs/pattern-analysis.md"

# After implementing endpoints
dirf record-progress "Implemented login and registration endpoints" \
  --phase "implement" \
  --next "Add password reset functionality" \
  --files "src/api/auth.js,src/middleware/auth.js"

# Session terminates here... RESUME
dirf resume

# Output shows:
## Current phase
implement

## Last action
Implemented login and registration endpoints (August 3, 2025, 4:15 PM)

## Exact next action
Add password reset functionality

# Continue from exactly where you left off
```

## Benefits

✅ **Always current**: HANDOFF.md updates with every step, not just at thresholds
✅ **Session recovery**: Resume from exact interruption point
✅ **No lost work**: Progress recorded before session termination
✅ **Platform-agnostic**: Works on Claude Code, Codex, Cursor, local models
✅ **Zero friction**: One command/tool call per step
✅ **Minimal state**: Just phase, last action, files, and next action

## Best Practices

1. **After each meaningful step**: Call it when you complete work, not just at phase boundaries
2. **Be specific in messages**: "Completed X" is better than "Made progress"
3. **Keep next actions actionable**: "Implement password reset" not "Continue working"
4. **Track changed files**: Helps with debugging and rollback
5. **Update phase when it changes**: Keep phase in sync with workflow structure

## Integration with Workflows

DIRF workflows can automatically include this skill. When enabled, the workflow instructions will say:

> After completing each step, record progress by calling the `dirf_record_progress` MCP tool (or running `dirf record-progress "<message>" --next "<exact-next-action>"). This keeps HANDOFF.md current for recovery.

## Requirements

- DIRF project must be configured (`dirf setup`)
- Works on any platform that can run CLI commands or MCP tools
- No special dependencies or platform-specific features needed

## See Also

- `dirf resume` - Resume from a handoff
- `dirf state read-handoff` - View current handoff state
- `dirf state which` - See current project context
