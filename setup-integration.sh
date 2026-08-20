#!/bin/bash
# DIRF Multi-Repository Integration Setup
# This script sets up DIRF for easy use across multiple projects

set -e

# Use current DIRF location if in DIRF repo, otherwise use default
if [ -f "src/cli.js" ] && [ -f "README.md" ] && grep -q "Do It Right First" README.md 2>/dev/null; then
  DIRF_SOURCE="$(pwd)"
else
  DIRF_SOURCE="${DIRF_SOURCE:-$HOME/tools/dirf}"
fi

DIRF_ALIAS="${DIRF_ALIAS:-dirf}"

echo "=== DIRF Multi-Repository Integration Setup ==="
echo ""
echo "DIRF Source: $DIRF_SOURCE"
echo "Command Alias: $DIRF_ALIAS"
echo ""

# Check if DIRF exists at source location
if [ ! -f "$DIRF_SOURCE/src/cli.js" ]; then
  echo "❌ DIRF not found at $DIRF_SOURCE"
  echo "Please run this script from the DIRF repository or clone DIRF first:"
  echo "  git clone https://github.com/gpb360/DIRF.git $DIRF_SOURCE"
  exit 1
fi

# Detect shell and configuration file
SHELL_CONFIG=""
if [ -n "$ZSH_VERSION" ]; then
  SHELL_CONFIG="$HOME/.zshrc"
elif [ -n "$BASH_VERSION" ]; then
  SHELL_CONFIG="$HOME/.bashrc"
else
  SHELL_CONFIG="$HOME/.profile"
fi

echo "🔧 Detected shell config: $SHELL_CONFIG"
echo ""

# Add DIRF alias to shell config
ALIAS_LINE="alias $DIRF_ALIAS='$DIRF_SOURCE/src/cli.js'"

if ! grep -q "alias $DIRF_ALIAS=" "$SHELL_CONFIG" 2>/dev/null; then
  echo "➕ Adding DIRF alias to $SHELL_CONFIG"
  echo "" >> "$SHELL_CONFIG"
  echo "# DIRF (Do It Right First)" >> "$SHELL_CONFIG"
  echo "$ALIAS_LINE" >> "$SHELL_CONFIG"
  echo "✅ Alias added. Run 'source $SHELL_CONFIG' or restart your shell"
else
  echo "✅ DIRF alias already exists in $SHELL_CONFIG"
fi

echo ""
echo "=== Integration Patterns ==="
echo ""
echo "1. Shell Alias (Recommended for CLI use):"
echo "   $DIRF_ALIAS status"
echo "   $DIRF_ALIAS build feature 'Implement user auth'"
echo ""
echo "2. Direct Path (For scripts):"
echo "   $DIRF_SOURCE/src/cli.js setup ."
echo ""
echo "3. MCP Integration (Add to .mcp.json):"
echo '   {"mcpServers": {"dirf": {"command": "node", "args": ["'"$DIRF_SOURCE"'/src/mcp.js"]}}}'
echo ""

# Create multi-repo update script
UPDATE_SCRIPT="$HOME/update-dirf-everywhere.sh"
cat > "$UPDATE_SCRIPT" << UPDATE_SCRIPT_EOF
#!/bin/bash
# DIRF Multi-Repository Update Script
# Update DIRF across all registered projects

DIRF_SOURCE="$DIRF_SOURCE"
PROJECTS_FILE="$HOME/.dirf-projects"

echo "=== DIRF Multi-Repository Update ==="
echo ""

# Update DIRF itself
if [ -d "$DIRF_SOURCE" ]; then
  echo "🔄 Updating DIRF source..."
  cd "$DIRF_SOURCE"
  git pull
  echo "✅ DIRF updated to: \$(git log -1 --oneline)"
  echo ""
else
  echo "❌ DIRF source not found: $DIRF_SOURCE"
  echo "Update DIRF_SOURCE environment variable or edit this script"
  exit 1
fi

# Read projects and update each
if [ -f "$PROJECTS_FILE" ]; then
  while IFS= read -r project; do
    if [ -d "\$project" ]; then
      echo "📁 Checking \$project"
      cd "\$project"

      # Update submodule if present
      if [ -f ".gitmodules" ]; then
        git submodule update --remote tools/dirf 2>/dev/null && echo "  ✅ Submodule updated" || echo "  ⚠️  Submodule update failed"
      fi

      # Test DIRF integration
      if command -v $DIRF_ALIAS &> /dev/null; then
        $DIRF_ALIAS validate 2>/dev/null && echo "  ✅ DIRF integration valid" || echo "  ⚠️  DIRF validation issues"
      fi
      echo ""
    fi
  done < "\$PROJECTS_FILE"
else
  echo "No projects registered yet."
  echo "Register projects with:"
  echo "  echo /path/to/project >> \$PROJECTS_FILE"
fi

echo "=== Update Complete ==="
UPDATE_SCRIPT_EOF

chmod +x "$UPDATE_SCRIPT"
echo "➕ Created update script: $UPDATE_SCRIPT"
echo ""

# Create projects registry
PROJECTS_FILE="$HOME/.dirf-projects"
if [ ! -f "$PROJECTS_FILE" ]; then
  touch "$PROJECTS_FILE"
  echo "➕ Created projects registry: $PROJECTS_FILE"
  echo "   Add projects with: echo /path/to/project >> $PROJECTS_FILE"
else
  echo "✅ Projects registry exists: $PROJECTS_FILE"
fi

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Next steps:"
echo "1. Reload your shell: source $SHELL_CONFIG"
echo "2. Test DIRF: $DIRF_ALIAS status"
echo "3. Register projects: echo /path/to/project >> $PROJECTS_FILE"
echo "4. Update all projects later: $UPDATE_SCRIPT"
echo ""
echo "Quick test now:"
$DIRF_SOURCE/src/cli.js --version 2>/dev/null && echo "✅ DIRF CLI ready at: $DIRF_SOURCE" || echo "⚠️ DIRF needs setup"
