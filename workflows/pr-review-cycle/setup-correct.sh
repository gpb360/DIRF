#!/bin/bash
# PR Review System Setup - Fixed for Project Root

echo "🚀 Setting up PR Review System (No NPX Required)..."

# Get the absolute path to the workflow directory
WORKFLOW_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$WORKFLOW_DIR/../.." && pwd)"

echo "Workflow directory: $WORKFLOW_DIR"
echo "Project root: $PROJECT_ROOT"

# Create git alias with correct absolute path
echo "Setting up git alias..."
git config --unset alias.review 2>/dev/null
git config alias.review "!node '$WORKFLOW_DIR/pr-review-cli.js' --local"

# Create a convenient local command
cat > "$PROJECT_ROOT/pr-review" << 'EOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/workflows/pr-review-cycle/pr-review-cli.js" "$@"
EOF
chmod +x "$PROJECT_ROOT/pr-review"

echo "✅ Setup complete!"
echo ""
echo "Quick Usage:"
echo "  git review              # Review local changes (from project root)"
echo "  ./pr-review --local     # Review local changes (from project root)"
echo "  ./pr-review --list      # List recent reviews"
echo ""
echo "Direct Usage:"
echo "  node workflows/pr-review-cycle/pr-review-cli.js --local"
echo ""
echo "Test it:"
echo "  git review --help"