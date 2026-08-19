# Visual QA Task for Storytellers

## Copy this prompt into Storytellers:

---

**Task: Visual QA Workflow - Compare current screen with design mock and fix outstanding visual issues**

I need you to help me perform visual QA on the current application screen by comparing it with our design mockups and fixing any outstanding visual discrepancies.

## Phase 1: Screen Capture

Please:
1. Take a screenshot of the current application state
2. Save it to our project as `qa/screenshots/before/current-state.png`
3. Document what screen/component you're looking at
4. Note any obvious visual issues you can see

## Phase 2: Design Mockup Comparison

Please:
1. Access our design mockups (they should be in our design system docs or Figma)
2. Compare the current screen capture against the design mockup side-by-side
3. Identify specific visual discrepancies:
   - Colors that don't match
   - Incorrect spacing/padding
   - Typography issues (font size, weight, line-height)
   - Missing elements
   - Alignment issues
   - Size/proportion problems

## Phase 3: Document Issues

Please create a detailed list in `qa/visual-issues.md` with each issue including:
- **Location**: Which component/file needs changes
- **Current State**: What's currently wrong (specific measurements if possible)
- **Expected State**: What it should look like per design
- **Severity**: Critical/Medium/Low
- **Fix Complexity**: Simple/Moderate/Complex

## Phase 4: Implement Fixes

Please work through the issues in priority order (Severity × Complexity):
1. For each visual issue, locate the relevant CSS/component file
2. Apply the fix to match the design specification
3. Test locally to confirm the fix works
4. Check for any regressions in other areas

Use design system tokens and variables when available rather than hardcoded values.

## Phase 5: Final Verification

Please:
1. Take new screenshots after all fixes: `qa/screenshots/after/fixed-state.png`
2. Compare side-by-side with the design mockup
3. Confirm each issue is resolved
4. Document any remaining discrepancies
5. Provide final sign-off on visual quality

## Progress Tracking

After completing each phase, please record your progress by calling the DIRF MCP tool:

```json
{
  "name": "dirf_record_progress",
  "arguments": {
    "message": "Completed [phase name]: [brief summary]",
    "currentPhase": "[current phase]",
    "nextAction": "[next phase or specific next step]",
    "changedFiles": ["list of files modified"]
  }
}
```

This ensures your work is preserved even if our session ends.

## Design Standards to Follow

- Use our design system tokens for colors, spacing, typography
- Follow accessibility guidelines (contrast ratios, touch targets)
- Maintain responsive design principles
- Ensure cross-browser compatibility

## What I Need From You

1. **Visual Comparison**: Side-by-side analysis showing current vs expected
2. **Issue List**: Clear, actionable list of each visual discrepancy
3. **Code Fixes**: Actual code changes to resolve each issue
4. **Verification**: Confirmation that fixes match the design mockup
5. **Screenshots**: Before/after comparison for documentation

Please start with Phase 1 (Screen Capture) and work through each phase systematically. Let me know if you need access to specific design files or have questions about any visual elements.

---

**Ready to begin? Start with capturing the current screen state and let me know what you're working with.**