# DIRF Quick Reference Card

## Shell Commands

```bash
# Setup project
dirf setup .

# Check status
dirf status

# Create workflow
dirf build feature-name "Task description"

# Track progress
dirf record-progress "What you did" --next "What's next"

# Resume session
dirf resume

# Validate setup
dirf validate
```

## MCP Tools

```json
{
  "dirf_resolve_project": "Get project info",
  "dirf_read_handoff": "Read current state",
  "dirf_record_progress": "Track workflow steps",
  "dirf_list_attempts": "See all workflows",
  "dirf_write_handoff": "Update handoff manually"
}
```

## Progress Tracking Pattern

```bash
# After each meaningful step:
dirf record-progress "Completed X" \
  --phase "current-phase" \
  --next "Next step description" \
  --files "file1.js,file2.js"
```

## Session Recovery

```bash
# Session ends unexpectedly
# Start new session, then:
dirf resume

# Shows exactly where you left off:
# - Current phase
# - Last completed action
# - Changed files
# - Exact next action
```

## Multi-Project Management

```bash
# Register project
echo /path/to/project >> ~/.dirf-projects

# Update everything
~/update-dirf-everywhere.sh
```

## Common Patterns

### Feature Development
```bash
dirf build feature "Add user authentication"
dirf record-progress "Defined requirements" --next "Design schema"
dirf record-progress "Created schema" --files "schema.sql" --next "Implement API"
```

### Bug Fix
```bash
dirf build fix-login-bug "Fix login timeout issue"
dirf record-progress "Identified root cause" --next "Apply fix"
dirf record-progress "Fix applied" --files "auth.js" --next "Test"
```

### Code Review
```bash
dirf build review-pr "Review pull request #123"
dirf record-progress "Reviewed changes" --next "Check tests"
dirf record-progress "Tests pass" --next "Approve"
```

## Integration Files

- **Shell Config:** `~/.bashrc` (contains `dirf` alias)
- **Projects Registry:** `~/.dirf-projects` (list of projects)
- **Update Script:** `~/update-dirf-everywhere.sh` (bulk updates)
- **MCP Config:** `.mcp.json` or Claude Code settings

## Key Benefits

✅ **Always Current** - HANDOFF.md updates every step
✅ **Session Recovery** - Resume from exact interruption
✅ **Platform Agnostic** - Works everywhere
✅ **Zero Friction** - One command per step
✅ **No Lost Work** - Progress preserved automatically

## Troubleshooting

**Command not found?**
```bash
alias dirf='C:\path\to\dirf\src\cli.js'
```

**Handoff not updating?**
```bash
dirf status  # Check project configured
dirf validate  # Check setup integrity
```

**Need to update DIRF?**
```bash
cd C:\path\to\dirf
git pull
```

---

**DIRF Location:** `C:\path\to\dirf`
**Integration Status:** ✅ Ready for multi-repo use
**Version:** fix/stack-aware-routing (with progressive handoff)
