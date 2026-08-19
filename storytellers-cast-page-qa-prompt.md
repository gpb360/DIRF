# Cast Page Visual QA - Prompt for Storytellers

## Copy this prompt into Storytellers:

---

**Task: Visual QA on Cast Page - Compare current implementation with design mockup and fix outstanding visual issues**

I need you to perform visual QA on the **Cast Page** component by comparing it with our design mockup and fixing any visual discrepancies.

## Target Component

**Cast Page** - This is the component that displays character/actor information and should match our design specifications.

## Phase 1: Screen Capture

Please:
1. Navigate to the Cast Page in the application
2. Take screenshots of the current Cast Page state at different breakpoints:
   - Mobile viewport (< 640px)
   - Tablet viewport (640px - 1024px)  
   - Desktop viewport (> 1024px)
3. Save screenshots to `qa/screenshots/cast-page/before/`
4. Document what you're seeing in the current implementation
5. Note any obvious visual issues you can identify

## Phase 2: Design Mockup Comparison

Please:
1. Access the Cast Page design mockup from our design system
2. Compare the current implementation side-by-side with the design
3. Look for specific visual discrepancies:
   - **Layout**: Card/grid structure, spacing between elements
   - **Typography**: Font sizes, weights, line heights for character names, roles
   - **Colors**: Background colors, text colors, accent colors matching design tokens
   - **Images**: Character avatars/portraits sizing, cropping, aspect ratios
   - **Spacing**: Padding, margins, gaps between cast cards
   - **Responsive**: How it adapts across breakpoints
   - **Missing elements**: Any UI elements from design not implemented

## Phase 3: Document Issues

Please create `qa/cast-page-issues.md` with each issue including:
- **Component**: Which specific part of the Cast Page (header, card grid, individual card, etc.)
- **Current State**: What's currently wrong (specific CSS/values if possible)
- **Expected State**: What it should look like per design mockup
- **CSS Location**: Which file/component needs changes
- **Severity**: Critical/Medium/Low priority
- **Fix Complexity**: Simple/Moderate/Complex

## Phase 4: Implement Fixes

Please work through issues in priority order (Severity × Complexity):
1. For each visual issue, locate the relevant React component and CSS
2. Apply fixes to match the design specification
3. Use design system tokens (colors, spacing, typography) when available
4. Test locally after each fix to confirm it works
5. Check for regressions in other parts of the Cast Page
6. Ensure responsive behavior works across breakpoints

## Phase 5: Final Verification

Please:
1. Take new screenshots after all fixes: `qa/screenshots/cast-page/after/`
2. Compare side-by-side with the design mockup at all breakpoints
3. Confirm each identified issue is resolved
4. Test the Cast Page functionality still works (filtering, sorting, interactions)
5. Document any remaining minor discrepancies
6. Provide final verification that the Cast Page matches the design

## Progress Tracking

After completing each phase, please record progress using the DIRF MCP tool:

```json
{
  "name": "dirf_record_progress",
  "arguments": {
    "message": "Completed Cast Page [phase]: [brief summary]",
    "currentPhase": "[current phase]",
    "nextAction": "[next phase or specific next step]",
    "changedFiles": ["list of files modified in storytellers/"]
  }
}
```

This ensures your work is preserved even if our session ends.

## Design Standards to Follow

- Use Storytellers design system tokens for colors, spacing, typography
- Ensure proper contrast ratios for accessibility
- Maintain responsive design patterns from other components
- Follow existing component patterns in the codebase
- Test at mobile (390px), tablet (768px), and desktop (1024px+) viewports

## What I Need From You

1. **Screenshots**: Before/after at multiple breakpoints
2. **Issue List**: Detailed visual discrepancies in `qa/cast-page-issues.md`
3. **Code Fixes**: Specific changes to match design mockup
4. **Verification**: Confirmation that Cast Page matches design
5. **Responsive Testing**: Confirmed working across all breakpoints

## Starting Point

- The Cast Page component should be in the Storytellers codebase
- Look for files like `CastPage.tsx`, `CastCard.tsx`, or similar naming
- Current implementation may have issues similar to what we found in ProjectCard

Please start with Phase 1 (Screen Capture) and work through each phase systematically. Let me know if you need access to specific design files or have questions about the Cast Page implementation.

---

**Ready to begin Cast Page visual QA? Start with capturing the current state at multiple breakpoints.**