#!/bin/bash
# PR Review Cycle Workflow Setup

echo "🚀 Setting up PR Review Cycle Workflow..."

# Create required directories
mkdir -p .claude/settings
mkdir -p .pr-reports

# Install dependencies if needed
if ! command -v gh &> /dev/null; then
    echo "⚠️  GitHub CLI not found. Install with: brew install gh"
fi

if ! command -v claude &> /dev/null; then
    echo "⚠️  Claude Code CLI not found. Install from: https://claude.ai/code"
fi

# Configure Claude settings
cat > .claude/settings.json <<EOF
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
EOF

# Make workflow executable
chmod +x workflows/pr-review-cycle/review-workflow.js

echo "✅ Setup complete!"
echo ""
echo "Usage:"
echo "  # Review a PR"
echo "  ./workflows/pr-review-cycle/review-workflow.js --pr-url=\"<PR_URL>\""
echo ""
echo "  # Review local changes"
echo "  ./workflows/pr-review-cycle/review-workflow.js --local"