---
name: pr-review-cycle
kind: workflow
description: "Automated PR review cycle with confidence scoring, security standards checks, and iterative fix loops until merge-ready."
uses: []
details: []
inputs: ["PR URL", "PR diff"]
outputs: ["review comments with confidence scores", "merge decision PASS/FAIL"]
capabilities: ["code review", "security review", "confidence scoring", "iterative review"]
---

# PR Review Cycle Workflow

**Purpose:** Automated PR review workflow with confidence scoring and iterative improvement until merge-ready.

## Workflow Cycle

```
┌─────────────────────────────────────────────────────────────────┐
│  1. CREATE PR                                                    │
└────────────────┬────────────────────────────────────────────────┘
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. AGENT REVIEW - Analyzes PR changes                           │
│     • Code quality review (confidence: 0-100)                   │
│     • Security review (confidence: 0-100)                       │
│     • Performance review (confidence: 0-100)                    │
│     • Test coverage review (confidence: 0-100)                  │
└────────────────┬────────────────────────────────────────────────┘
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. SCORE & COMMENTS                                             │
│     • Overall confidence score: 0-100                           │
│     • Issue comments with individual scores                     │
│     • Security standard compliance check                       │
│     • Merge decision: PASS/FAIL                                 │
└────────────────┬────────────────────────────────────────────────┘
                 ▼
        ┌──────────────────────┐
        │  CONFIDENCE ≥ 80?     │
        │  SECURITY STANDARDS?  │
        └──────────┬───────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
        YES                 NO
         │                   │
         ▼                   ▼
┌──────────────────┐   ┌─────────────────────┐
│  4. MERGE TO     │   │  5. FIX ISSUES       │
│     STAGING      │   │     Create new PR    │
└──────────────────┘   │     → Back to step 2 │
                       └─────────────────────┘

**PR description contract:** every PR created by this cycle carries a
description — what changed, why, and how it was verified. Never a
title-only PR (see the workflow policy's Communication section).

## Usage

### Basic Usage
```bash
# Run the full review cycle
claude workflow pr-review-cycle --pr-url="<PR_URL>"

# Run specific review stages
claude workflow pr-review-cycle --stage="review" --pr-url="<PR_URL>"
claude workflow pr-review-cycle --stage="security" --pr-url="<PR_URL>"
```

### Configuration
Set confidence thresholds in `.claude/settings.json`:
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

## Review Stages

### 1. Code Quality Review
- Architecture & design patterns
- Code organization & readability  
- Error handling & edge cases
- Documentation completeness
- Testing adequacy
- Performance considerations

### 2. Security Review
- Authentication & authorization
- Input validation & sanitization
- Secret/credential handling
- Dependency vulnerabilities
- Access controls
- Data encryption

### 3. Performance Review
- Algorithm efficiency
- Resource usage (memory, CPU)
- Database query optimization
- Caching strategies
- Load handling

### 4. Test Coverage Review
- Unit test coverage
- Integration test presence
- Edge case testing
- Mock/stub appropriateness
- Test clarity and maintainability

## Output Format

### Console Output
```
🔍 PR Review: #123 - Feature X implementation
━━━━━━━━━━────────────────────────────━━━━━━━━━━

Overall Confidence: 72/100 ⚠️

📊 Stage Scores:
  • Code Quality: 75/100 ✅
  • Security: 65/100 ❌ (below threshold 90)
  • Performance: 80/100 ✅  
  • Test Coverage: 70/100 ⚠️ (below threshold 75)

🚫 BLOCKING ISSUES (3):
  1. [SECURITY] Missing input validation on user data (score: 30)
  2. [COVERAGE] Edge cases not covered (score: 40)
  3. [PERFORMANCE] N+1 query problem (score: 50)

💡 SUGGESTIONS (2):
  1. Consider adding caching for better performance
  2. Extract magic numbers to constants

❌ Review Result: FAIL - Below confidence threshold (80/100)
🔄 Next Action: Fix issues and create follow-up PR
```

### PR Comments
The workflow posts comments directly to the PR with:
- Issue severity (BLOCKING/SUGGESTION)
- Confidence score (0-100)
- File/line location
- Suggested fix
- Reference to security standards

## Merge Decision

The PR is considered **PASS** when:
- Overall confidence ≥ threshold (default 80)
- Security score ≥ security threshold (default 90)  
- No blocking issues
- All security standards met

Otherwise, the PR is **FAIL** and needs fixes.

## Fix Cycle

When review fails:
1. Workflow creates detailed issue report
2. Developers fix issues
3. Create follow-up PR with fixes
4. Run review again
5. Repeat until PASS

## Integration with CI/CD

Add to GitHub Actions:
```yaml
name: PR Review
on: [pull_request]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run PR Review Workflow
        run: |
          npm install -g @anthropic/claude-code
          claude workflow pr-review-cycle --pr-url="${{ github.event.pull_request.html_url }}"
```

## Local Development

Run locally before creating PR:
```bash
# Review uncommitted changes
claude workflow pr-review-cycle --local

# Review specific branch vs main
claude workflow pr-review-cycle --source=feature-branch --target=main
```