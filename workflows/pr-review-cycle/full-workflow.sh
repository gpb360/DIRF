#!/bin/bash
# Complete PR Review + GitHub Comment Workflow

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 PR Review System${NC} - Professional GitHub Integration"
echo ""

# Check arguments
if [ $# -lt 1 ]; then
    echo "Usage: $0 <pr-url> [--local]"
    echo ""
    echo "Examples:"
    echo "  $0 https://github.com/user/repo/pull/123"
    echo "  $0 https://github.com/gpb360/sample-project/pull/1171 --local"
    exit 1
fi

PR_URL="$1"
LOCAL_FLAG="${2:-}"

# Check for GitHub token
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${YELLOW}⚠️  GITHUB_TOKEN not set${NC}"
    echo "Please set your GitHub token:"
    echo "  export GITHUB_TOKEN=your_token_here"
    echo ""
    echo "Get token from: GitHub Settings → Developer settings → Personal access tokens"
    exit 1
fi

echo -e "${BLUE}📋 Configuration:${NC}"
echo "  PR URL: $PR_URL"
echo "  Local Review: ${LOCAL_FLAG:-false}"
echo "  GitHub Token: ✓ (set)"
echo ""

# Step 1: Run PR Review
echo -e "${BLUE}🔍 Step 1: Running PR Review...${NC}"
if [ "$LOCAL_FLAG" == "--local" ]; then
    ./pr-review --local
else
    echo "Remote review not yet implemented - use --local flag"
    exit 1
fi

REVIEW_EXIT_CODE=$?
echo ""

if [ $REVIEW_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ Review Passed!${NC}"
else
    echo -e "${YELLOW}⚠️  Review Found Issues${NC}"
fi
echo ""

# Step 2: Check if report exists
if [ ! -f ".pr-review-report.json" ]; then
    echo -e "${RED}❌ Review report not found${NC}"
    echo "Expected file: .pr-review-report.json"
    exit 1
fi

# Step 3: Post to GitHub
echo -e "${BLUE}📝 Step 2: Posting Professional Review to GitHub...${NC}"

# Determine node executable path
NODE_CMD="node"
if command -v node &> /dev/null; then
    NODE_CMD="node"
elif command -v nodejs &> /dev/null; then
    NODE_CMD="nodejs"
else
    echo -e "${RED}❌ Node.js not found${NC}"
    exit 1
fi

# Post to GitHub
$NODE_CMD pr-review-cycle/github-pr-commenter.js \
    --pr-url="$PR_URL" \
    --report=.pr-review-report.json

POST_EXIT_CODE=$?
echo ""

if [ $POST_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ Complete!${NC}"
    echo ""
    echo "Check the GitHub PR for professional review feedback:"
    echo "  $PR_URL"
    echo ""
    echo "What to do next:"
    if [ $REVIEW_EXIT_CODE -ne 0 ]; then
        echo -e "  ${YELLOW}1. Review the issues on GitHub${NC}"
        echo "  2. Fix the critical issues"
        echo "  3. Run this workflow again"
    else
        echo -e "  ${GREEN}1. Review is ready to merge!${NC}"
        echo "  2. Merge the PR"
    fi
else
    echo -e "${RED}❌ Failed to post to GitHub${NC}"
    exit $POST_EXIT_CODE
fi