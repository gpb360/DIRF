#!/bin/bash
# PR Review System Setup - No NPX Required

echo "🚀 Setting up PR Review System (No NPX Required)..."

# Create git alias for easy use
echo "Setting up git alias..."
git config alias.review '!node workflows/pr-review-cycle/pr-review-cli.js --local'

# Create a convenient pr-review command
echo "Creating system command..."
cat > pr-review-local << 'EOF'
#!/bin/bash
node workflows/pr-review-cycle/pr-review-cli.js "$@"
EOF
chmod +x pr-review-local

echo "✅ Setup complete!"
echo ""
echo "Usage:"
echo "  git review              # Review local changes"
echo "  ./pr-review-local --local # Review local changes"
echo "  ./pr-review-local --list    # List recent reviews"
echo ""
echo "Or use directly:"
echo "  node workflows/pr-review-cycle/pr-review-cli.js --local"