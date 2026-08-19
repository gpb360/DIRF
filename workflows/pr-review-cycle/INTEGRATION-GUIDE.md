# PR Review Cycle System - Complete Integration Guide

## Overview

This is a **universal PR review system** that works on ANY project - not just DIRF. It uses multi-agent AI analysis to provide confidence scores, issue detection, and automated feedback on pull requests.

## The Review Cycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEVELOPMENT CYCLE                              │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  1. Create Feature PR  │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  2. AI Agents Review  │
        │     • Code Quality    │
        │     • Security         │
        │     • Performance      │
        │     • Test Coverage    │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  3. Score + Feedback   │
        │     • Confidence 0-100 │
        │     • Issue Comments  │
        │     • Security Check   │
        └───────────┬───────────┘
                    │
            ┌───────┴────────┐
            │                │
        PASS │           FAIL │
            │                │
            ▼                ▼
    ┌─────────────┐  ┌──────────────────┐
    │ Merge to    │  │ Fix Issues       │
    │ Staging     │  │ Create Follow-up  │
    └─────────────┘  └────────┬─────────┘
                               │
                               └──► Back to step 2
```

## Quick Start (Any Project)

### 1. Installation

```bash
# Clone the workflow system
git clone https://github.com/gpb360/DIRF.git temp-dirf
cp -r temp-dirf/workflows/pr-review-cycle ./
rm -rf temp-dirf

# Or download directly
curl -o pr-review-setup.sh https://raw.githubusercontent.com/gpb360/DIRF/main/workflows/pr-review-cycle/setup.sh
chmod +x pr-review-setup.sh
./pr-review-setup.sh
```

### 2. Basic Usage

```bash
# Review a GitHub PR
npx pr-review --pr-url="https://github.com/user/repo/pull/123"

# Review local changes before creating PR
npx pr-review --local

# Review against specific branch
npx pr-review --local --target=develop

# List all recent reviews
npx pr-review --list
```

### 3. Configuration

Create `.claude/settings.json` in your project:

```json
{
  "prReviewThresholds": {
    "confidence": 80,
    "security": 90,
    "performance": 70,
    "coverage": 75
  },
  "prReviewWorkflow": {
    "enabled": true,
    "autoComment": true,
    "blockingIssues": true,
    "stages": ["code-quality", "security", "performance", "coverage"]
  }
}
```

## Detailed Workflow

### Stage 1: Code Quality Review

**What it checks:**
- Architecture & design patterns
- Code organization & readability
- Error handling & edge cases
- Documentation completeness
- Performance considerations

**Output:**
```json
{
  "score": 85,
  "issues": [
    {
      "severity": "suggestion",
      "file": "src/auth.js",
      "line": 42,
      "message": "Consider extracting to separate function",
      "code": "function authenticate(user, pass) { ... }",
      "score": 65,
      "fix": "Extract login logic to authenticateUser(user)"
    }
  ],
  "summary": "Good code quality with minor suggestions"
}
```

### Stage 2: Security Review

**What it checks:**
- OWASP Top 10 vulnerabilities
- Input validation & sanitization
- Authentication & authorization
- Secret/credential handling
- Dependency vulnerabilities
- Access control issues

**Output:**
```json
{
  "score": 72,
  "issues": [
    {
      "severity": "high",
      "file": "src/api.js",
      "line": 15,
      "message": "SQL injection risk - user input not sanitized",
      "code": "query(`SELECT * FROM users WHERE id=${userId}`)",
      "score": 25,
      "fix": "Use parameterized queries",
      "references": ["OWASP-A03:2021"]
    }
  ],
  "summary": "Critical security issues found",
  "compliance": false
}
```

### Stage 3: Performance Review

**What it checks:**
- Algorithm efficiency (Big O)
- Resource usage (memory, CPU, I/O)
- Database query optimization
- Caching opportunities
- Scalability concerns

**Output:**
```json
{
  "score": 90,
  "issues": [
    {
      "severity": "suggestion",
      "file": "src/data.js",
      "line": 78,
      "message": "N+1 query problem - consider eager loading",
      "code": "users.forEach(u => u.getPosts())",
      "score": 70,
      "impact": "O(n) database queries",
      "fix": "Use JOIN or eager loading"
    }
  ],
  "summary": "Good performance with optimization opportunities"
}
```

### Stage 4: Test Coverage Review

**What it checks:**
- Unit test coverage percentage
- Missing edge cases
- Integration test presence
- Mock/stub appropriateness
- Test clarity

**Output:**
```json
{
  "score": 68,
  "coverage": 65,
  "issues": [
    {
      "severity": "blocking",
      "file": "src/auth.js",
      "function": "authenticateUser",
      "message": "Missing test for authentication failure",
      "score": 40,
      "test": "describe('authenticateUser failure', () => { ... })"
    }
  ],
  "summary": "Test coverage below threshold"
}
```

## Integration Examples

### Example 1: Web Development Workflow

```bash
# Developer creates feature branch
git checkout -b feature/user-authentication

# Developer makes changes
git commit -am "Add user authentication"

# Developer runs local review before creating PR
npx pr-review --local

# Review fails: Security score 65 (need 90)
# Developer fixes security issues
git commit -am "Fix: Add input validation and parameterized queries"

# Developer runs review again
npx pr-review --local

# Review passes: Overall 85/100
# Developer creates PR
git push origin feature/user-authentication

# CI/CD runs automated review
npx pr-review --pr-url="https://github.com/org/repo/pull/42"
```

### Example 2: CI/CD Integration

```yaml
# .github/workflows/pr-review.yml
name: PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install PR Review System
        run: npm install -g pr-review-cli

      - name: Run PR Review
        run: |
          npx pr-review --pr-url="${{ github.event.pull_request.html_url }}"
        continue-on-error: true

      - name: Comment Results
        uses: actions/github-script@v6
        if: always()
        with:
          script: |
            const fs = require('fs');
            const report = JSON.parse(fs.readFileSync('.pr-review-report.json', 'utf8'));
            const body = \`## PR Review Results

            **Overall Score:** \${report.overallScore}/100
            **Decision:** \${report.mergeDecision}

            \${report.reviews.security.compliance ? '✅' : '❌'} Security: \${report.reviews.security.score}/100
            \${report.reviews['code-quality'].score >= 80 ? '✅' : '❌'} Quality: \${report.reviews['code-quality'].score}/100

            \${report.mergeDecision === 'FAIL' ? '### Issues Found\\n' + report.issues.map(i => '- ' + i.message).join('\\n') : '✅ Ready to merge'}
            \`;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });
```

### Example 3: Local Development Integration

```bash
# Setup git alias for convenience
git config alias.review '!npx pr-review --local'

# Now you can run
git review

# Or add to pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
echo "Running PR review on local changes..."
npx pr-review --local
if [ $? -ne 0 ]; then
  echo "❌ Review failed. Commit aborted."
  echo "Fix issues and try again, or use --no-verify to bypass."
  exit 1
fi
EOF
chmod +x .git/hooks/pre-commit
```

## Understanding Scores

### Score Ranges

- **90-100**: Excellent - Ready to merge
- **80-89**: Good - Minor suggestions, acceptable
- **70-79**: Fair - Some issues that should be addressed
- **60-69**: Poor - Significant issues, fixes recommended
- **0-59**: Critical - Major problems, merge blocked

### Stage Thresholds

Default thresholds (configurable):

```json
{
  "confidence": 80,    // Overall confidence threshold
  "security": 90,      // Security is most important
  "performance": 70,   // Performance can be optimized later
  "coverage": 75       // Test coverage threshold
}
```

### Issue Severity

- **Critical**: Security vulnerability, must fix
- **High**: Major bug or flaw, must fix
- **Blocking**: Prevents merge, must fix
- **Medium**: Should fix, can delay
- **Low**: Nice to have, optional

## Fix Cycle Workflow

### When Review Fails

1. **Read the report**
   ```bash
   cat .pr-review-report.json | jq '.issues'
   ```

2. **Fix critical issues first**
   ```bash
   # Security issues get priority
   cat .pr-review-report.json | jq '.reviews.security.issues[] | select(.severity == "critical")'
   ```

3. **Test fixes locally**
   ```bash
   # Run review again
   npx pr-review --local
   ```

4. **Create follow-up PR**
   ```bash
   git checkout -b fix/pr-review-feedback
   git commit -am "Fix: Address PR review feedback"
   git push origin fix/pr-review-feedback
   ```

5. **Iterate until pass**
   ```bash
   # Repeat until review passes
   npx pr-review --local
   ```

## Advanced Configuration

### Custom Prompts

Create `.pr-review-prompts.json`:

```json
{
  "code-quality": {
    "focus": ["architecture", "error-handling", "documentation"],
    "exclude": ["formatting", "style"]
  },
  "security": {
    "standards": ["OWASP-Top-10", " CWE-25"],
    "additionalChecks": ["GDPR-compliance", "SOC2"]
  }
}
```

### Team Thresholds

Adjust thresholds per team needs:

```json
{
  "prReviewThresholds": {
    "confidence": 90,    // High standards team
    "security": 95,     // Security-focused team
    "performance": 80,  // Performance-critical app
    "coverage": 85      // High coverage requirement
  }
}
```

## Troubleshooting

### Common Issues

**Issue**: "Git diff failed"
```bash
# Ensure you're in a git repository
git status

# Ensure target branch exists
git branch -a | grep main
```

**Issue**: "Agent timeout"
```bash
# Increase timeout in settings.json
{
  "agentTimeout": 600000  // 10 minutes
}
```

**Issue**: "Low scores on good code"
```bash
# Review and adjust thresholds
# Some projects may have different standards
```

## Project Examples

### React Web App
```bash
npx pr-review --local --target=main
# Focuses on: component quality, hooks, state management
```

### Node.js API
```bash
npx pr-review --local --target=develop
# Focuses on: endpoint security, validation, error handling
```

### Python Project
```bash
npx pr-review --local --target=master
# Analyzes: Python code quality, security patterns, test coverage
```

The system is **language-agnostic** and works on any codebase!