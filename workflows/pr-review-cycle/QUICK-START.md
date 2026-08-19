# PR Review Cycle System - Quick Start

## 30 Second Setup

```bash
# Copy this workflow to ANY project
cp -r workflows/pr-review-cycle ./

# Run setup
cd pr-review-cycle && bash setup.sh && cd ..

# Review your current changes
npx pr-review --local
```

## Basic Usage

### Before Creating a PR
```bash
# Review your local changes
npx pr-review --local

# If review passes, create PR
git push origin feature-branch

# If review fails, fix issues and review again
git commit -am "Fix: Address review feedback"
npx pr-review --local
```

### Reviewing Existing PRs
```bash
# Review a GitHub PR
npx pr-review --pr-url="https://github.com/user/repo/pull/123"

# List recent reviews
npx pr-review --list
```

## The Review Cycle

1. **Create PR** → AI Agents Review → Score & Issues
2. **Fix Issues** → New PR → Review Again
3. **Repeat** until Confidence Score ≥ 80
4. **Merge to Staging**

## What Gets Reviewed

- ✅ **Code Quality** (architecture, readability, error handling)
- ✅ **Security** (OWASP Top 10, auth, input validation)
- ✅ **Performance** (algorithms, queries, resources)
- ✅ **Test Coverage** (unit tests, edge cases, integration)

## Score Interpretation

- **90-100**: ✅ Excellent - Ready to merge
- **80-89**: ✅ Good - Minor suggestions
- **70-79**: ⚠️ Fair - Should address issues
- **< 70**: ❌ Poor - Must fix before merge

## Configuration

Edit `.claude/settings.json`:
```json
{
  "prReviewThresholds": {
    "confidence": 80,
    "security": 90,
    "performance": 70,
    "coverage": 75
  }
}
```

## Example Output

```
📊 PR REVIEW RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Overall Confidence Score: 72/100

Stage Scores:
  ✅ code-quality: 75/100
  ❌ security: 65/100 (threshold: 90)
  ✅ performance: 80/100
  ⚠️ coverage: 70/100 (threshold: 75)

🚫 CRITICAL ISSUES (2):
  1. [SECURITY] SQL injection risk - user input not sanitized (25/100)
     📁 src/api.js:15
  2. [COVERAGE] Missing test for authentication failure (40/100)

💡 SUGGESTIONS (1):
  1. [PERFORMANCE] N+1 query problem - consider eager loading (70/100)

❌ Review Result: FAIL
🔧 Next Action: Fix issues and create follow-up PR

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Installation in Any Project

```bash
# Method 1: Copy the workflow
git clone https://github.com/gpb360/DIRF.git temp-dirf
cp -r temp-dirf/workflows/pr-review-cycle ./pr-review
rm -rf temp-dirf

# Method 2: Download directly
curl -L https://github.com/gpb360/DIRF/archive/refs/heads/main.tar.gz | \
  tar -xz --strip=4 DIRF-main/workflows/pr-review-cycle

# Method 3: Install as npm package (when published)
npm install -g pr-review-cycle
```

## Git Integration

```bash
# Add git alias for convenience
git config alias.review '!f() { npx pr-review --local "$@"; }; f'

# Now you can simply run:
git review

# Add to pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
npx pr-review --local || exit 1
EOF
chmod +x .git/hooks/pre-commit
```

## CI/CD Integration

Add to `.github/workflows/pr-review.yml`:
```yaml
name: PR Review
on: [pull_request]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run PR Review
        run: npx pr-review --pr-url="${{ github.event.pull_request.html_url }}"
```

## Troubleshooting

**"command not found: npx"**
```bash
# Install Node.js from https://nodejs.org/
# Or use npm directly
npm install -g pr-review-cycle
```

**"No diff found"**
```bash
# Ensure you have changes to review
git status
git diff main...HEAD
```

**"Agent timeout"**
```bash
# Increase timeout in .claude/settings.json
{
  "agentTimeout": 600000  // 10 minutes
}
```

## Support

- 📖 Full Guide: `INTEGRATION-GUIDE.md`
- 🐛 Issues: https://github.com/gpb360/DIRF/issues
- 💡 Examples: `example-usage.sh`

This system works on **any project** - not just DIRF!