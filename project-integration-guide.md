# DIRF Integration Guide for Other Repositories

This guide shows how to integrate DIRF into your projects and keep it updated.

## Quick Start

### Option 1: Shell Alias (Recommended)

```bash
# Add to your .bashrc, .zshrc, or run:
alias dirf='/path/to/dirf/src/cli.js'

# Use in any project:
cd /path/to/your-project
dirf setup .
dirf status
dirf build feature "Implement user authentication"
```

### Option 2: Direct Path

```bash
# In your project:
/path/to/dirf/src/cli.js setup .
/path/to/dirf/src/cli.js build auth "Add login"
```

### Option 3: MCP Integration

Add to your project's `.mcp.json` or Claude Code settings:

```json
{
  "mcpServers": {
    "dirf": {
      "command": "node",
      "args": ["/path/to/dirf/src/mcp.js"]
    }
  }
}
```

## Project Integration Patterns

### Pattern 1: CLI-First Projects

For projects where agents primarily use CLI commands:

```bash
# Setup once
dirf setup .

# Create workflow
dirf build feature "Add user authentication"

# Track progress
dirf record-progress "Completed auth endpoints" \
  --next "Add password reset" \
  --files "src/auth.js"

# Check status
dirf status
```

### Pattern 2: MCP-First Projects

For projects using Claude Code or other MCP-enabled hosts:

```javascript
// Available MCP tools:
{
  "dirf_resolve_project": "Get project info",
  "dirf_list_projects": "List all projects",
  "dirf_read_handoff": "Read current handoff",
  "dirf_write_handoff": "Write handoff",
  "dirf_record_progress": "Record workflow progress",
  "dirf_list_attempts": "List workflow attempts",
  "dirf_get_attempt": "Get specific attempt"
}
```

### Pattern 3: Mixed CLI + MCP

Use both interfaces for maximum flexibility:

```bash
# Setup via CLI
dirf setup .

# Use MCP tools during workflow execution
# dirf_record_progress called automatically by agents

# Resume via CLI
dirf resume
```

## Multi-Project Management

### Register Projects for Updates

```bash
# Add your projects to the registry
echo /path/to/project1 >> ~/.dirf-projects
echo /path/to/project2 >> ~/.dirf-projects
echo /path/to/project3 >> ~/.dirf-projects
```

### Update All Projects

```bash
# Run the update script
~/update-dirf-everywhere.sh
```

This will:
1. Update DIRF to latest version
2. Update each project's DIRF integration
3. Validate DIRF is working in each project

## Workflow Examples

### Example 1: Feature Development

```bash
cd my-project

# Start new feature
dirf build user-auth "Implement user authentication system"

# Work through phases
dirf record-progress "Defined auth requirements" \
  --phase "requirements" \
  --next "Design database schema"

dirf record-progress "Designed users table schema" \
  --phase "design" \
  --next "Create migration files" \
  --files "schema/users.sql"

# Session ends here... resume later
dirf resume
# Continues from: Create migration files
```

### Example 2: MCP-Based Workflow

```javascript
// AI agent workflow
1. Agent calls: dirf_resolve_project
2. Agent calls: dirf_read_handoff
3. Agent completes work step
4. Agent calls: dirf_record_progress({
   message: "Completed authentication endpoints",
   currentPhase: "implementation",
   nextAction: "Add password reset flow",
   changedFiles: ["src/api/auth.js"]
})
5. Session ends
6. New agent calls: dirf_read_handoff
7. Continues from exact interruption point
```

## Keeping DIRF Updated

### Update Frequency

**Recommended: Update DIRF monthly or when new features are needed**

```bash
# Check for updates
cd /path/to/dirf
git pull origin main
git log --oneline -5  # See what's new
```

### Breaking Changes

DIRF follows semantic versioning. Check for breaking changes:

```bash
cd /path/to/dirf
git tag  # See versions
git log v1.0.0..HEAD --oneline  # See changes since last version
```

### Rollback if Needed

```bash
cd /path/to/dirf
git log --oneline  # Find previous working version
git checkout <commit-hash>  # Rollback
```

## Version Locking (For Teams)

### Option 1: Git Submodule

```bash
cd your-project
git submodule add https://github.com/gpb360/DIRF.git tools/dirf
git commit -m "Add DIRF as git submodule"

# Lock to specific version
cd tools/dirf
git checkout v1.2.3  # or specific commit
cd ../
git add tools/dirf
git commit -m "Lock DIRF to v1.2.3"
```

### Option 2: Version File

```bash
# Create .dirf-version in your project
echo "dirf@fix/stack-aware-routing" > .dirf-version
git add .dirf-version
git commit -m "Track DIRF version"

# Use in scripts:
DIRF_VERSION=$(cat .dirf-version)
# Use version to validate compatibility
```

## Troubleshooting

### DIRF Command Not Found

```bash
# Check alias
type dirf

# If not found, add to shell:
echo "alias dirf='/path/to/dirf/src/cli.js'" >> ~/.bashrc
source ~/.bashrc
```

### MCP Tools Not Available

```bash
# Check MCP server is running
node /path/to/dirf/src/mcp.js

# Check .mcp.json configuration
cat .mcp.json

# Restart Claude Code or your MCP host
```

### Handoff Not Updating

```bash
# Check project is configured
dirf status

# Check handoff permissions
dirf state read-handoff

# Test progress recording
dirf record-progress "Test update" --next "Continue"
```

## Best Practices

### 1. Consistent DIRF Version
Use the same DIRF version across all projects for predictability.

### 2. Regular Updates
Update DIRF monthly to get bug fixes and new features.

### 3. Progress Recording
Train agents to call `dirf_record_progress` after each meaningful step.

### 4. Handoff Review
Periodically review HANDOFF.md to ensure it's current and accurate.

### 5. Version Tracking
Track which DIRF version each project uses for debugging.

### 6. Team Coordination
When updating DIRF, notify team members and provide migration notes.

## Advanced Integration

### Custom DIRF Wrappers

Create project-specific wrappers:

```bash
# ~/bin/my-dirf (make executable)
#!/bin/bash
DIRF_PROJECT="/path/to/your-project"
/path/to/dirf/src/cli.js "$@" --path "$DIRF_PROJECT"
```

### Pre-commit Hooks

Add DIRF validation to your project's pre-commit hooks:

```bash
# .git/hooks/pre-commit
#!/bin/bash
dirf validate || exit 1
```

### CI/CD Integration

```yaml
# .github/workflows/dirf-check.yml
name: DIRF Check
on: [push, pull_request]
jobs:
  dirf-validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Validate DIRF
        run: |
          alias dirf='/path/to/dirf/src/cli.js'
          dirf validate
```

## Support and Documentation

- Main README: `dirf/README.md`
- CLI Help: `dirf --help`
- State Commands: `dirf state --help`
- MCP Tools: See MCP server schema

## Integration Checklist

- [ ] DIRF accessible via `dirf` command
- [ ] MCP server configured (if using Claude Code)
- [ ] Project configured: `dirf setup .`
- [ ] Test workflow created: `dirf build test "Test integration"`
- [ ] Progress recording tested: `dirf record-progress "Test" --next "Continue"`
- [ ] Handoff reviewed: `dirf state read-handoff`
- [ ] Team trained on DIRF usage
- [ ] Update process documented for team

---

**Last Updated:** 2025-08-04
**DIRF Version:** fix/stack-aware-routing branch
**Integration Status:** ✅ Ready for multi-repo use
