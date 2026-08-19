# PR Review System - No NPX Required

## 🚀 Direct Node.js Usage

Since you don't have `npx`, here's how to use the system directly:

## Quick Start (Without NPX)

### Method 1: Direct Node Execution
```bash
# From the workflow directory
cd workflows/pr-review-cycle
node pr-review-cli.js --local

# Or from project root
node workflows/pr-review-cycle/pr-review-cli.js --local
```

### Method 2: Git Alias (Recommended)
```bash
# Add git alias for easy use
git config alias.review '!node workflows/pr-review-cycle/pr-review-cli.js --local'

# Now you can simply run:
git review
```

### Method 3: System-Wide Alias
```bash
# Add to your PATH and create alias
echo 'alias pr-review="node /path/to/amf-dirf/workflows/pr-review-cycle/pr-review-cli.js"' >> ~/.bashrc
source ~/.bashrc

# Now you can run from anywhere:
pr-review --local
```

### Method 4: Batch File (Windows)
```bash
# Create pr-review.bat
@echo off
node "C:\path\to\amf-dirf\workflows\pr-review-cycle\pr-review-cli.js" %*

# Use anywhere:
pr-review --local
```

## Updated Examples

### Basic Usage
```bash
# Review local changes
node workflows/pr-review-cycle/pr-review-cli.js --local

# Review specific branch
node workflows/pr-review-cycle/pr-review-cli.js --local --target=develop

# List recent reviews
node workflows/pr-review-cycle/pr-review-cli.js --list
```

### Git Alias Usage
```bash
# Setup once
git config alias.review '!node workflows/pr-review-cycle/pr-review-cli.js --local'

# Use forever
git review
```

### Windows Batch Usage
```bash
# Create pr-review.bat in your project
echo @echo off > pr-review.bat
echo node "C:\path\to\amf-dirf\workflows\pr-review-cycle\pr-review-cli.js" %%* >> pr-review.bat

# Use it
pr-review --local
```

## Project-Specific Setup

### For Any Project (Copy Method)
```bash
# Copy the system to your project
cp -r workflows/pr-review-cycle /path/to/your-project/

# Use directly
cd /path/to/your-project
node pr-review-cycle/pr-review-cli.js --local

# Or create local alias
cd /path/to/your-project
echo 'alias review="node pr-review-cycle/pr-review-cli.js"' >> .git/config
review --local
```

### For Windows Projects
```bash
# Copy system to project
xcopy /E /I workflows\pr-review-cycle C:\path\to\your-project\pr-review

# Create batch file
echo @echo off > pr-review.bat
echo node pr-review\pr-review-cli.js %%* >> pr-review.bat

# Use
pr-review --local
```

## Development Workflow

### Without NPX
```bash
# Make changes
git commit -am "Add new feature"

# Review (direct node)
node workflows/pr-review-cycle/pr-review-cli.js --local

# If fails, fix and review again
git commit -am "Fix: Address feedback"
node workflows/pr-review-cycle/pr-review-cli.js --local

# When passes, push
git push origin feature-branch
```

### With Git Alias
```bash
# Setup once
git config alias.review '!node workflows/pr-review-cycle/pr-review-cli.js --local'

# Use in workflow
git commit -am "Add feature"
git review  # Much simpler!
git push origin feature-branch
```

## CI/CD Integration (No NPX)

### GitHub Actions
```yaml
name: PR Review
on: [pull_request]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Run PR Review
        run: |
          node workflows/pr-review-cycle/pr-review-cli.js \
            --pr-url="${{ github.event.pull_request.html_url }}"
```

### Local Pre-commit Hook
```bash
# .git/hooks/pre-commit
#!/bin/bash
echo "Running PR review..."
node workflows/pr-review-cycle/pr-review-cli.js --local
if [ $? -ne 0 ]; then
  echo "❌ Review failed. Commit aborted."
  exit 1
fi
```

## Windows-Specific Setup

### PowerShell Function
```powershell
# Add to $PROFILE
function pr-review {
  param($args)
  node "C:\path\to\amf-dirf\workflows\pr-review-cycle\pr-review-cli.js" $args
}

# Use
pr-review --local
```

### CMD Alias
```cmd
# Add to registry or use doskey
doskey pr-review=node "C:\path\to\amf-dirf\workflows\pr-review-cycle\pr-review-cli.js" $*

# Use
pr-review --local
```

## Quick Reference

| Command | Description |
|---------|-------------|
| `node workflows/pr-review-cycle/pr-review-cli.js --local` | Review local changes |
| `node workflows/pr-review-cycle/pr-review-cli.js --list` | List recent reviews |
| `git review` | If git alias is set up |
| `pr-review --local` | If system alias is set up |

## Verification

### Test It Works
```bash
# Test basic functionality
node workflows/pr-review-cycle/pr-review-cli.js --help

# Test review system
node workflows/pr-review-cycle/test-system.sh

# Quick syntax check
node -c workflows/pr-review-cycle/pr-review-cli.js
```

## Copy to Another Project

### Universal Copy Command
```bash
# Works on any system
cp -r workflows/pr-review-cycle /path/to/target/project/

# Then in target project
cd /path/to/target/project
node pr-review-cycle/pr-review-cli.js --local
```

### Windows Copy
```bash
# Windows equivalent
xcopy /E /I workflows\pr-review-cycle C:\path\to\target\project\pr-review

# Then use
cd C:\path\to\target\project
node pr-review\pr-review-cli.js --local
```

## Summary

**No NPX needed!** Use any of these methods:

1. **Direct Node**: `node workflows/pr-review-cycle/pr-review-cli.js --local`
2. **Git Alias**: `git config alias.review '!node workflows/pr-review-cycle/pr-review-cli.js --local'`
3. **System Alias**: Add to `.bashrc` or create batch file
4. **Copy to Project**: `cp -r workflows/pr-review-cycle /path/to/project/`

All methods work without `npx`! 🚀