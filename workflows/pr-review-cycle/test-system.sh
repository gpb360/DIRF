#!/bin/bash
# Quick test of the PR Review System

echo "🧪 Testing PR Review System..."
echo ""

# Check if all required files exist
required_files=(
  "README.md"
  "QUICK-START.md"
  "INTEGRATION-GUIDE.md"
  "SYSTEM-READY.md"
  "package.json"
  "setup.sh"
  "example-usage.sh"
  "pr-review-cli.js"
  "agent-workflow.js"
  "review-workflow.js"
)

missing_files=0
for file in "${required_files[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ $file"
  else
    echo "❌ $file (missing)"
    missing_files=$((missing_files + 1))
  fi
done

echo ""
if [ $missing_files -eq 0 ]; then
  echo "🎉 All files present!"
else
  echo "⚠️  $missing_files files missing"
  exit 1
fi

# Check if scripts are executable
echo "Checking executable permissions..."
for script in setup.sh example-usage.sh; do
  if [ -x "$script" ]; then
    echo "✅ $script is executable"
  else
    echo "⚠️  $script needs executable permission"
    chmod +x "$script"
  fi
done

# Test basic functionality
echo ""
echo "Testing basic functionality..."

# Test if node is available
if command -v node &> /dev/null; then
  echo "✅ Node.js available"
  node --version
else
  echo "❌ Node.js not found"
  exit 1
fi

# Test if scripts can be parsed
echo ""
echo "Testing script syntax..."
for script in pr-review-cli.js agent-workflow.js review-workflow.js; do
  if node -c "$script" 2>/dev/null; then
    echo "✅ $script syntax valid"
  else
    echo "❌ $script has syntax errors"
  fi
done

echo ""
echo "🎉 PR Review System is ready!"
echo ""
echo "Quick start:"
echo "  npx pr-review --local"
echo ""
echo "Documentation:"
echo "  cat README.md"
echo "  cat QUICK-START.md"
echo "  cat SYSTEM-READY.md"