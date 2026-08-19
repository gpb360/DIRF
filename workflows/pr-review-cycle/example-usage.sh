#!/bin/bash
# Example usage of the PR Review Cycle system
# Copy this to any project to get started

echo "🚀 PR Review Cycle System - Example Usage"
echo ""

# Example 1: Review local changes
echo "1️⃣ Review local changes before creating PR:"
echo "   npx pr-review --local"
echo ""

# Example 2: Review a specific GitHub PR
echo "2️⃣ Review a GitHub PR:"
echo "   npx pr-review --pr-url='https://github.com/user/repo/pull/123'"
echo ""

# Example 3: Review against different branch
echo "3️⃣ Review against develop branch:"
echo "   npx pr-review --local --target=develop"
echo ""

# Example 4: List recent reviews
echo "4️⃣ List all recent reviews:"
echo "   npx pr-review --list"
echo ""

# Example 5: Development cycle
echo "5️⃣ Complete development cycle:"
echo "   # Make changes"
echo "   git commit -am 'Add new feature'"
echo ""
echo "   # Review before PR"
echo "   npx pr-review --local"
echo ""
echo "   # If review fails, fix issues and review again"
echo "   git commit -am 'Fix: Address review feedback'"
echo "   npx pr-review --local"
echo ""
echo "   # When review passes, create PR"
echo "   git push origin feature-branch"
echo ""

# Example 6: CI/CD integration
echo "6️⃣ Add to .github/workflows/pr-review.yml:"
cat << 'EOF'
name: PR Review
on: [pull_request]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run PR Review
        run: npx pr-review --pr-url="${{ github.event.pull_request.html_url }}"
EOF

echo ""
echo "📚 For more details, see: INTEGRATION-GUIDE.md"
echo ""
echo "⚙️  Configuration: Edit .claude/settings.json to adjust thresholds"
echo ""
echo "🎯 Typical thresholds:"
echo "   • Confidence: 80/100"
echo "   • Security: 90/100 (most important)"
echo "   • Performance: 70/100"
echo "   • Test Coverage: 75/100"
echo ""

# Quick demo
read -p "Run a quick demo review on this project? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "Running demo review..."
  npx pr-review --local 2>/dev/null || echo "⚠️  Review system not fully installed yet"
  echo ""
  echo "Install with: npm install -g ."
fi