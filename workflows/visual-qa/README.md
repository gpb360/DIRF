---
name: visual-qa
kind: workflow
description: "Compare current application screens with design mockups and systematically fix outstanding visual issues."
uses: []
details: []
inputs: ["screen/component target", "design mockups", "design tokens"]
outputs: ["qa/screenshots/", "qa/visual-issues.md", "verification report"]
capabilities: ["visual conformance", "design comparison", "ui regression triage"]
---

# Visual QA Workflow

Compare current application screens with design mockups and systematically fix outstanding visual issues.

---

## Objective

Identify visual discrepancies between the current application state and design mockups, then fix outstanding issues systematically.

## Phases

1. **Screen Capture** - Capture current application state
2. **Design Comparison** - Compare against design mockups  
3. **Issue Identification** - List specific visual discrepancies
4. **Fix Implementation** - Address each identified issue
5. **Verification** - Re-capture and verify fixes match design

## Definition of Done

- All visual discrepancies identified and documented
- Each issue fixed with code changes
- Final screen capture matches design mockup
- No outstanding visual issues remain

## Agent Roles

- **UI Designer** - Design mockup review and visual standards
- **Frontend Developer** - Screen capture and comparison
- **Developer** - Implement visual fixes
- **QA Tester** - Final verification

## Handoff Protocol

After each phase, record progress:

```bash
dirf record-progress "Completed phase description" \
  --phase "current phase" \
  --next "next action" \
  --files "list of changed files"
```

## Open Questions

- Which screen/component needs visual QA?
- Where are the design mockups located?
- Are there specific design tokens/colors/spacing to follow?
- What visual issues are already known?

---

## Phase 1: Screen Capture

**Goal**: Capture the current application state for comparison

**Actions**:
- Navigate to the target screen/component
- Take screenshots of current state
- Document responsive breakpoints if applicable
- Note any obvious visual issues

**Deliverable**:
- Screenshots saved to `qa/screenshots/before/`
- Current state documented in HANDOFF.md

**Validation**:
- Screenshots clearly show current UI state
- All relevant components captured

---

## Phase 2: Design Comparison  

**Goal**: Compare current state against design mockups

**Actions**:
- Load design mockups for the target screen
- Side-by-side comparison: current vs design
- Identify specific discrepancies:
  - Colors (hex codes)
  - Spacing (pixels/rem)
  - Typography (font, size, weight)
  - Layout/alignment
  - Missing elements
  - Size/proportions

**Deliverable**:
- Detailed comparison report
- List of specific discrepancies found

**Validation**:
- Each discrepancy is specific and measurable
- Comparison covers all elements in the design

---

## Phase 3: Issue Identification

**Goal**: Create prioritized list of visual issues to fix

**Actions**:
- Document each discrepancy with:
  - Location (component/file)
  - Current state (what's wrong)
  - Expected state (what it should be)
  - Severity (critical/medium/low)
  - Implementation complexity
- Prioritize by severity × complexity
- Create fix checklist

**Deliverable**:
- `qa/visual-issues.md` with all issues documented
- Prioritized fix order

**Validation**:
- Each issue has clear before/after states
- Fix order is logical and achievable

---

## Phase 4: Fix Implementation

**Goal**: Implement fixes for identified visual issues

**Actions**:
- Work through issues in priority order
- For each issue:
  - Locate relevant CSS/component file
  - Apply design-compliant fixes
  - Test locally for immediate impact
  - Check for regressions
- Follow design system tokens if available

**Deliverable**:
- Code changes for each visual issue
- Local testing completed

**Validation**:
- Each fix matches design specification
- No obvious regressions introduced

---

## Phase 5: Verification

**Goal**: Confirm all fixes match design mockup

**Actions**:
- Re-capture screenshots after all fixes
- Side-by-side comparison: fixed state vs design mockup
- Confirm each issue is resolved
- Document any remaining discrepancies
- Final sign-off on visual quality

**Deliverable**:
- `qa/screenshots/after/` with final state
- Verification report
- Handoff sign-off

**Validation**:
- Fixed screenshots match design mockup
- All critical issues resolved
- Any remaining issues documented and acceptable

---

## Progress Tracking

Use the progressive handoff system throughout:

```bash
# After screen capture
dirf record-progress "Captured current state - 3 screenshots taken" \
  --phase "screen capture" \
  --next "Compare with design mockups" \
  --files "qa/screenshots/before/home.png,qa/screenshots/before/dashboard.png"

# After design comparison  
dirf record-progress "Comparison complete - found 12 visual discrepancies" \
  --phase "design comparison" \
  --next "Prioritize and document issues" \
  --files "qa/comparison-report.md"

# After issue identification
dirf record-progress "Documented 12 issues in qa/visual-issues.md" \
  --phase "issue identification" \
  --next "Fix critical spacing and color issues" \
  --files "qa/visual-issues.md"

# After fixes
dirf record-progress "Fixed 8 of 12 visual issues - 4 remaining for next iteration" \
  --phase "fix implementation" \
  --next "Final verification and sign-off" \
  --files "src/components/Home.css,src/components/Button.css"

# After verification
dirf record-progress "Visual QA complete - all critical issues resolved" \
  --phase "verification" \
  --next "Ready for production deployment"
```

---

## Session Recovery

If the session ends at any point, resume with:

```bash
dirf resume
```

You'll see exactly where you left off - current phase, last action, and next steps.

---

## Design System Integration

When available, use design system tokens:

- **Colors**: Use design token variables instead of hardcoded values
- **Spacing**: Follow design system spacing scale
- **Typography**: Use defined font scales and weights  
- **Components**: Use design system component library

This ensures consistency and makes future updates easier.

---

## Tools and Resources

- **Screenshot capture**: Browser dev tools, automated tools
- **Design mockups**: Figma, Sketch, or design system docs
- **Comparison tools**: Side-by-side viewers, diff tools
- **Design tokens**: Design system documentation
- **CSS inspection**: Browser dev tools element inspector

---

## Example Issue Documentation

```markdown
## Issue #1: Hero Section Spacing

**Location**: `src/components/Hero.css`  
**Current**: 32px padding between title and subtitle  
**Expected**: 16px padding per design spec  
**Severity**: Medium  
**Complexity**: Low (1 line CSS change)

**Fix**: Change line 42 from `padding-bottom: 32px` to `padding-bottom: 16px`
```

---

## Success Criteria

✅ **Complete Issue Coverage**: All visual discrepancies identified  
✅ **Accurate Fixes**: Each fix matches design specification  
✅ **No Regressions**: Other screens/components unaffected  
✅ **Design Compliance**: Final state matches design mockup  
✅ **Documentation**: Issues and fixes well-documented  

---

**Workflow Version**: 1.0  
**Last Updated**: 2025-08-04  
**Status**: Ready for execution
