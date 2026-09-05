---
name: pr-review-consensus
kind: workflow
description: "Multi-agent pull request review that grades PR quality, fixes identified issues, and reaches 90% confidence approval through consensus verification."
uses: []
details: []
inputs: ["pull request", "branch diff", "PR metadata"]
outputs: ["pr-review/<pr-number>-consensus.md", "pr-review/<pr-number>-final-approval.md"]
capabilities: ["code review", "multi-agent consensus", "security review", "regression triage"]
---

# PR Review & Consensus Workflow

Multi-agent pull request review system to achieve 90% confidence approval through systematic grading, fixing, and verification.

---

## Objective

Review pull requests using multiple independent agents, grade PR quality, fix identified issues, and achieve 90% confidence approval through consensus verification.

---

## Phases

1. **PR Intake** - Initial assessment and documentation
2. **Multi-Agent Review** - Independent parallel reviews by 3+ agents  
3. **Consensus Grading** - Aggregate reviews and assign confidence score
4. **Issue Fixing** - Address identified problems systematically
5. **Re-verification** - Multiple agents re-review after fixes
6. **Final Approval** - Achieve 90%+ confidence and merge

---

## Phase 1: PR Intake

**Goal**: Document PR details and establish review baseline

**Actions**:
- Extract PR metadata (number, title, author, branch, files changed)
- Document PR description and stated objectives
- Identify affected components and risk level
- Note any dependencies or coordinated changes
- Establish baseline expectations

**Deliverable**:
- `pr-review/<pr-number>-intake.md` with PR context

**Validation**:
- PR purpose and scope clearly documented
- Risk level appropriately assessed
- Review criteria established

---

## Phase 2: Multi-Agent Review

**Goal**: 3+ agents independently review the PR in parallel

**Actions**:
- Agent 1: **Code Quality Review** - Implementation, patterns, maintainability
- Agent 2: **Functional Review** - Requirements met, edge cases, user experience  
- Agent 3: **Security & Performance Review** - Security risks, performance impact
- Agent 4+: **Domain Expert Review** - Component-specific expertise (if needed)

**Each Agent Provides**:
- Overall assessment (approve/request changes/reject)
- Specific issues found with line numbers
- Confidence score (0-100%)
- Required fixes before merge
- Optional improvements suggested

**Deliverable**:
- `pr-review/<pr-number>-agent< N>-review.md` for each agent

**Validation**:
- Minimum 3 independent reviews completed
- Each review includes confidence score
- Specific, actionable feedback provided

---

## Phase 3: Consensus Grading

**Goal**: Aggregate reviews and determine overall PR confidence

**Actions**:
- Compile all agent reviews into summary matrix
- Calculate aggregate confidence score
- Identify consensus vs. disagreements
- Classify issues: blocking vs. optional vs. nitpicks
- Determine if PR passes threshold (90% confidence)

**Scoring System**:
- **Approve**: 90%+ confidence, no blocking issues
- **Request Changes**: 70-89% confidence, blocking issues fixable
- **Reject**: <70% confidence or fundamental problems

**Deliverable**:
- `pr-review/<pr-number>-consensus.md` with aggregated assessment
- Decision: APPROVE/REQUEST CHANGES/REJECT
- Issue prioritization if fixes needed

**Validation**:
- All agent inputs considered
- Confidence calculation transparent
- Clear decision with supporting evidence

---

## Phase 4: Issue Fixing

**Goal**: Systematically address all blocking issues

**Actions**:
- Prioritize issues by severity and confidence impact
- Assign fixes to appropriate agent/author
- Implement fixes with testing
- Document each fix with before/after evidence
- Update PR with fixes

**Fix Categories**:
1. **Blocking Issues** - Must fix for approval
2. **Confidence Boosters** - Issues that lower multiple agent scores
3. **Optional Improvements** - Nice-to-have but not required

**Deliverable**:
- Updated code with fixes applied
- `pr-review/<pr-number>-fixes.md` documenting changes
- New test coverage for fixes

The structured DIRF review ledger is the trigger for this phase. Run
`dirf review trigger review.json`; a `fix_and_update_same_pr` request is passed
to the harness-owned fixer. The fixer updates the existing PR branch, not a
second PR. Verify the returned artifact with `dirf review verify-update
request.json updated-review.json` before Phase 5 re-review.
This compares artifact targets only. Verify the live repository, PR, base and
head before consuming the trigger.
That verification emits `trigger_review_ledger`; Phase 5 consumes that event
and reviews the new head to produce the next ledger.

**Validation**:
- All blocking issues resolved
- Fixes don't introduce new problems
- Tests pass for all changes

---

## Phase 5: Re-verification

**Goal**: Same 3+ agents re-review to confirm confidence improvement

**Actions**:
- Agents review only the changes (delta) from original review
- Focus on whether blocking issues are adequately addressed
- Provide updated confidence scores
- Note any new concerns introduced by fixes

**Re-review Protocol**:
- Same agents review their original focus areas
- Compare new state against their original requirements
- Update confidence scores based on fixes
- Flag if fixes introduced new issues

**Deliverable**:
- `pr-review/<pr-number>-agent<N>-re-review.md` for each agent
- Updated confidence scores

**Validation**:
- All re-reviews completed
- Confidence scores compared to baseline
- Clear improvement (or regression) documented

---

## Phase 6: Final Approval

**Goal**: Achieve 90%+ consensus confidence and approve merge

**Actions**:
- Aggregate re-review confidence scores
- Confirm 90%+ threshold achieved
- Document final consensus
- Create merge approval record
- Update any tracking systems

**Approval Criteria**:
- ✅ 90%+ aggregate confidence across all agents
- ✅ No blocking issues remaining
- ✅ All re-reviewers approve or abstain
- ✅ No new issues introduced in fixes

**Deliverable**:
- `pr-review/<pr-number>-final-approval.md`
- Merge decision with confidence score
- PR ready to merge

**Validation**:
- 90%+ threshold clearly met
- Documentation supports decision
- Process integrity maintained

---

## Agent Roles & Expertise

### Agent 1: Code Quality Specialist
**Focus**: Implementation quality, patterns, maintainability
**Reviews**:
- Code style and conventions
- Design patterns and architecture
- Error handling and edge cases
- Documentation quality
- Technical debt implications

### Agent 2: Functional Reviewer  
**Focus**: Requirements, user experience, business logic
**Reviews**:
- Feature completeness vs. requirements
- User experience and accessibility
- Edge cases and error flows
- Integration points and compatibility
- Testing coverage

### Agent 3: Security & Performance Analyst
**Focus**: Security risks, performance impact, scalability
**Reviews**:
- Security vulnerabilities and best practices
- Performance regression risk
- Resource usage and efficiency
- Scalability concerns
- Dependencies and supply chain

### Agent 4: Domain Expert (Optional)
**Focus**: Component-specific technical expertise
**Reviews**:
- Domain-specific best practices
- Framework/architecture compliance
- Integration with existing systems
- Team-specific conventions

---

## Confidence Scoring System

Each agent scores 0-100% on:

### Individual Agent Scoring

**Code Quality Agent (40% weight)**:
- Implementation quality (0-15)
- Pattern adherence (0-10)  
- Error handling (0-10)
- Documentation (0-5)

**Functional Agent (30% weight)**:
- Requirements met (0-15)
- User experience (0-10)
- Edge cases (0-5)

**Security Agent (30% weight)**:
- Security safety (0-15)
- Performance impact (0-10)
- Scalability (0-5)

### Aggregate Confidence Formula

```
Overall Confidence = 
  (Agent1_Score × 0.40 + Agent2_Score × 0.30 + Agent3_Score × 0.30) ×
  (1 - Blocking_Issue_Penalty)
```

**Blocking Issue Penalty**: -10% per blocking issue, max -30%

---

## Progress Tracking

After each phase, record progress:

```bash
dirf record-progress "Completed [phase]: [summary]" \
  --phase "[current phase]" \
  --next "[next phase or action]" \
  --files "[changed files]"
```

**Example**:
```bash
# After initial reviews
dirf record-progress "3 agents completed initial reviews - aggregate confidence 72%, 2 blocking issues found" \
  --phase "multi-agent review" \
  --next "Fix blocking issues: security vulnerability in auth.js, missing error handling in api/users" \
  --files "pr-review/1171-agent1-review.md,pr-review/1171-agent2-review.md,pr-review/1171-agent3-review.md"

# After fixes
dirf record-progress "Fixed both blocking issues - added input sanitization and error handling with tests" \
  --phase "issue fixing" \
  --next "Re-verification by all 3 agents" \
  --files "src/auth.js,src/api/users.ts,tests/auth.test.js"

# After re-verification
dirf record-progress "Re-verification complete - confidence improved to 94%, all agents approve" \
  --phase "final approval" \
  --next "Ready to merge PR #1171"
```

---

## Issue Classification System

### 🔴 Blocking Issues (Must Fix)
- Security vulnerabilities
- Broken functionality
- Missing critical requirements
- Performance regression >20%
- Test coverage gaps for core functionality

### 🟡 Confidence Issues (Should Fix)  
- Code style inconsistencies
- Missing edge case handling
- Documentation gaps
- Minor performance concerns (<10% regression)
- Optional improvements that boost confidence

### 🟢 Nitpicks (Optional)
- Preference-based style differences
- Very minor optimizations
- Nice-to-have enhancements

---

## Consensus Building Process

### When Agents Disagree

**Minor Disagreement (<15% score variance)**:
- Average the scores
- Note disagreement in consensus doc
- Proceed with aggregate score

**Major Disagreement (>15% variance)**:
- Hold consensus meeting
- Agents explain their positions
- Identify root cause of disagreement
- May bring in 4th tie-breaker agent
- Re-score after discussion

### When Confidence Stalls 70-89%

**Confidence Boosting Strategies**:
1. **Quick Wins**: Fix highest-impact issues first
2. **Targeted Fixes**: Address issues that multiple agents flagged
3. **Clarification**: Add docs/tests that address concerns
4. **Partial Approval**: Approve with TODOs for low-risk improvements

---

## Quality Gates

### Before Merge Approval

✅ **90%+ aggregate confidence** across all agents  
✅ **Zero blocking issues** remaining  
✅ **All re-reviewers approve** or abstain  
✅ **No new issues** introduced by fixes  
✅ **Tests pass** for all changes  
✅ **Documentation updated** for functional changes

### When to Reject PR

❌ **<70% confidence** even after fixes  
❌ **Fundamental architectural problems**  
❌ **Security vulnerabilities** that can't be safely fixed  
❌ **Breaking changes** without proper migration  
❌ **Authors unresponsive** to feedback after 2 cycles

---

## Multi-Agent Coordination

### Parallel Execution Strategy

**Phase 2 (Initial Review)**: All agents review simultaneously
**Phase 5 (Re-verification)**: All agents review delta simultaneously

### Agent Handoff Protocol

When issues require domain-specific fixes:
- Issue identified by Agent → assigned to most appropriate fixer
- Fixer implements → all agents verify fix is adequate
- Consensus on whether fix resolves concern

### Conflict Resolution

**Technical Disagreements**:
- Cite specific requirements or standards
- Provide evidence/measurements
- May require external expert input

**Process Disagreements**:
- Refer to this workflow document
- Escalate to workflow agreement
- Don't let process block progress

---

## Output Documentation Structure

```
pr-review/
├── <pr-number>-intake.md           # PR context and baseline
├── <pr-number>-agent1-review.md    # Code quality review
├── <pr-number>-agent2-review.md    # Functional review  
├── <pr-number>-agent3-review.md    # Security/performance review
├── <pr-number>-consensus.md         # Aggregate assessment
├── <pr-number>-fixes.md             # What was fixed and how
├── <pr-number>-agent1-rereview.md  # Reverification
├── <pr-number>-agent2-rereview.md
├── <pr-number>-agent3-rereview.md
├── <pr-number>-final-approval.md    # Final decision and confidence
└── <pr-number>-summary.md           # Executive summary
```

---

## Example Confidence Calculation

**Initial Reviews**:
- Agent 1 (Code Quality): 75% - "Good patterns, missing edge cases"
- Agent 2 (Functional): 80% - "Requirements met, UX concerns"  
- Agent 3 (Security): 65% - "SQL injection risk, performance OK"

**Aggregate**:
```
Initial = (75×0.40 + 80×0.30 + 65×0.30) = 30 + 24 + 19.5 = 73.5%
```

**Issues Found**:
- 1 Blocking (SQL injection): -10% penalty
- 1 Confidence (missing edge cases): -0% (not blocking)

**Adjusted**: 73.5% - 10% = 63.5% → **REQUEST CHANGES**

**After Fixes**:
- Agent 1: 85% - "Edge cases added"
- Agent 2: 85% - "UX improvements made"  
- Agent 3: 90% - "SQL injection fixed, performance good"

**Final Aggregate**:
```
Final = (85×0.40 + 85×0.30 + 90×0.30) = 34 + 25.5 + 27 = 86.5%
```

**No blocking issues → 86.5% → Still below 90%**

**Cycle 2 Fixes**:
- Add comprehensive tests (+5% all agents)
- Improve documentation (+3% all agents)

**Final**: 94.5% → **APPROVE** ✅

---

## Success Metrics

✅ **Quality Threshold**: 90%+ confidence PRs pass  
✅ **Efficiency**: Average 2 review cycles per PR  
✅ **Coverage**: All changed files reviewed by specialist agents  
✅ **Consensus**: High agreement between agents (low variance)  
✅ **Learning**: Agent feedback improves future PRs  

---

## Integration with Development Workflow

### Pre-PR Submission
- Authors run self-review using workflow criteria
- Automated checks pass (tests, linting)
- Documentation requirements met

### During Review
- PR enters multi-agent review queue
- Parallel reviews completed within 24 hours
- Consensus meeting scheduled if needed

### Post-Merge
- Document lessons learned
- Update patterns/standards based on feedback
- Track PR quality metrics over time

---

**Workflow Version**: 1.0  
**Last Updated**: 2025-08-04  
**Status**: Ready for multi-agent execution
