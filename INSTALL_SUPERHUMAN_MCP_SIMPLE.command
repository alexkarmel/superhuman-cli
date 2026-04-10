#!/bin/bash

#############################################
# Superhuman MCP - One-Click Installer
# Single file – copy anywhere and double-click to install
#
# If macOS says it can't be opened (unidentified developer / not trusted):
#   Right-click this file → Open → click "Open" in the dialog.
#   Or in Terminal: xattr -d com.apple.quarantine "/path/to/this/file.command"
#
# If it says "cannot be executed due to access privileges":
#   In Terminal: chmod +x "/path/to/this/file.command"   then double-click again.
#   Or run it with: bash "/path/to/this/file.command"
#############################################

# Ensure Bun is on PATH (in case we install it in this run)
export PATH="$HOME/.bun/bin:$PATH"

clear

echo "╔════════════════════════════════════════════════════╗"
echo "║                                                    ║"
echo "║     Superhuman MCP Installer for Claude            ║"
echo "║                                                    ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo "This will set up Superhuman to work with Claude Desktop."
echo "The installation will take about 2–3 minutes."
echo ""
echo "Press ENTER to start, or close this window to cancel."
read -r

echo ""
echo "Starting installation..."
echo ""

# Run the full setup; capture exit code
SETUP_EXIT=0
(
  set -e

  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  RED='\033[0;31m'
  NC='\033[0m'

  # Safety guard: refuse to run from inside a superhuman-cli checkout.
  # This installer rm -rf's $HOME/superhuman-cli and re-clones it. If the user
  # launched it from inside their own working copy (e.g. a dev clone with
  # uncommitted work), that wipes everything non-committed. Bail early.
  INTENDED_INSTALL_DIR="$HOME/superhuman-cli"
  CURRENT_PWD="$(pwd -P)"
  RESOLVED_INSTALL_DIR="$(cd "$HOME" 2>/dev/null && pwd -P)/superhuman-cli"

  # Check 1: PWD is the install dir or inside it
  case "$CURRENT_PWD/" in
    "$INTENDED_INSTALL_DIR"/*|"$RESOLVED_INSTALL_DIR"/*)
      IN_INSTALL_DIR=1 ;;
    *)
      IN_INSTALL_DIR=0 ;;
  esac

  # Check 2: inside any git repo whose remote points at superhuman-cli
  IN_SUPERHUMAN_REPO=0
  if command -v git &>/dev/null && git -C "$CURRENT_PWD" rev-parse --is-inside-work-tree &>/dev/null; then
    if git -C "$CURRENT_PWD" remote -v 2>/dev/null | grep -q 'superhuman-cli'; then
      IN_SUPERHUMAN_REPO=1
    fi
  fi

  if [ "$IN_INSTALL_DIR" = "1" ] || [ "$IN_SUPERHUMAN_REPO" = "1" ]; then
    echo -e "${RED}❌ Refusing to run from inside a superhuman-cli checkout.${NC}"
    echo ""
    echo "   Current directory: $CURRENT_PWD"
    echo ""
    echo "   This installer wipes and re-clones $INTENDED_INSTALL_DIR, which"
    echo "   would destroy any uncommitted work in your current checkout."
    echo ""
    echo "   To install: copy this .command file somewhere OUTSIDE the repo"
    echo "   (e.g. your Desktop) and double-click it from there."
    exit 1
  fi

  echo "📋 Step 1: Checking prerequisites..."

  if ! command -v git &>/dev/null; then
    echo -e "${RED}❌ Git is not installed.${NC}"
    echo "Install Xcode Command Line Tools: run   xcode-select --install"
    echo "Then run this installer again."
    exit 1
  fi
  echo -e "${GREEN}✅ Git found${NC}"

  if ! command -v python3 &>/dev/null; then
    echo -e "${RED}❌ Python 3 is not installed.${NC}"
    echo "macOS usually includes it. Install from https://www.python.org or use Homebrew."
    exit 1
  fi
  echo -e "${GREEN}✅ Python 3 found${NC}"

  if [ ! -d "/Applications/Superhuman.app" ]; then
    echo -e "${RED}❌ Superhuman.app not found in /Applications${NC}"
    echo "Please install Superhuman Desktop first from https://superhuman.com"
    exit 1
  fi
  echo -e "${GREEN}✅ Superhuman.app found${NC}"

  CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude"
  if [ ! -d "$CLAUDE_CONFIG_DIR" ]; then
    echo -e "${YELLOW}⚠️  Creating Claude config directory...${NC}"
    mkdir -p "$CLAUDE_CONFIG_DIR"
  fi
  echo -e "${GREEN}✅ Claude config directory ready${NC}"
  echo ""

  echo "📦 Step 2: Installing Bun runtime..."
  export PATH="$HOME/.bun/bin:$PATH"
  if command -v bun &>/dev/null; then
    echo -e "${GREEN}✅ Bun already installed: $(bun --version)${NC}"
  else
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    echo -e "${GREEN}✅ Bun installed${NC}"
  fi
  # Use full path to bun so Claude (which may not have ~/.bun/bin in PATH) can spawn the MCP server
  if [ -x "$HOME/.bun/bin/bun" ]; then
    BUN_CMD="$HOME/.bun/bin/bun"
  else
    BUN_CMD="$(command -v bun || echo 'bun')"
  fi
  echo ""

  echo "📥 Step 3: Installing superhuman-cli..."
  INSTALL_DIR="$HOME/superhuman-cli"
  # Clone from your fork (must be public so coworkers can clone without login)
  SUPERHUMAN_CLI_REPO="https://github.com/alexkarmel/superhuman-cli.git"
  if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}⚠️  Removing previous install...${NC}"
    rm -rf "$INSTALL_DIR"
  fi
  git clone "$SUPERHUMAN_CLI_REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  bun install
  echo -e "${GREEN}✅ superhuman-cli installed at $INSTALL_DIR${NC}"
  echo ""

  echo "🔧 Step 4: Creating LaunchAgent (Superhuman with debugging)..."
  LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
  LAUNCH_AGENT_FILE="$LAUNCH_AGENT_DIR/com.superhuman.debugging.plist"
  mkdir -p "$LAUNCH_AGENT_DIR"
  LOG_PATH="$HOME/Library/Logs/superhuman-debugging.log"

  cat > "$LAUNCH_AGENT_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.superhuman.debugging</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Applications/Superhuman.app/Contents/MacOS/Superhuman</string>
        <string>--remote-debugging-port=9333</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_PATH</string>
    <key>StandardErrorPath</key>
    <string>$LOG_PATH</string>
</dict>
</plist>
EOF
  launchctl unload "$LAUNCH_AGENT_FILE" 2>/dev/null || true
  launchctl load "$LAUNCH_AGENT_FILE"
  echo -e "${GREEN}✅ LaunchAgent loaded${NC}"
  echo ""

  echo "🔐 Step 4b: Creating LaunchAgent (auto credential sync for drafts)..."
  LAUNCH_AGENT_AUTH_FILE="$LAUNCH_AGENT_DIR/com.superhuman.mcp.auth-sync.plist"
  AUTH_LOG_PATH="$HOME/Library/Logs/superhuman-auth-sync.log"
  cat > "$LAUNCH_AGENT_AUTH_FILE" << AUTHEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.superhuman.mcp.auth-sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BUN_CMD</string>
        <string>$INSTALL_DIR/src/index.ts</string>
        <string>account</string>
        <string>auth</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>600</integer>
    <key>StandardOutPath</key>
    <string>$AUTH_LOG_PATH</string>
    <key>StandardErrorPath</key>
    <string>$AUTH_LOG_PATH</string>
</dict>
</plist>
AUTHEOF
  launchctl unload "$LAUNCH_AGENT_AUTH_FILE" 2>/dev/null || true
  launchctl load "$LAUNCH_AGENT_AUTH_FILE"
  echo -e "${GREEN}✅ Credential sync agent loaded (runs on login and every 10 min)${NC}"
  echo ""

  echo "⚙️  Step 5: Configuring Claude Desktop..."
  CONFIG_FILE="$CLAUDE_CONFIG_DIR/claude_desktop_config.json"
  if [ -f "$CONFIG_FILE" ]; then
    echo -e "${YELLOW}⚠️  Backing up existing config${NC}"
    cp "$CONFIG_FILE" "$CONFIG_FILE.backup"
  fi

  if [ -f "$CONFIG_FILE" ]; then
    python3 << PYTHON_SCRIPT
import json
config_file = "$CONFIG_FILE"
install_dir = "$INSTALL_DIR"
bun_cmd = "$BUN_CMD"
with open(config_file, 'r') as f:
    config = json.load(f)
if 'mcpServers' not in config:
    config['mcpServers'] = {}
config['mcpServers']['superhuman'] = {
    'command': bun_cmd,
    'args': [f'{install_dir}/src/index.ts', '--mcp'],
    'env': { 'SUPERHUMAN_MCP_DISABLE_SEND': '1' }
}
with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)
print("Config updated")
PYTHON_SCRIPT
  else
    cat > "$CONFIG_FILE" << EOF
{
  "mcpServers": {
    "superhuman": {
      "command": "$BUN_CMD",
      "args": [
        "$INSTALL_DIR/src/index.ts",
        "--mcp"
      ],
      "env": {
        "SUPERHUMAN_MCP_DISABLE_SEND": "1"
      }
    }
  }
}
EOF
  fi
  echo -e "${GREEN}✅ Claude Desktop configured${NC}"
  echo ""

  echo "🚀 Step 6: Starting Superhuman with debugging..."
  killall Superhuman 2>/dev/null || true
  sleep 2
  launchctl start com.superhuman.debugging
  sleep 5
  if ps aux | grep -v grep | grep "Superhuman.*9333" >/dev/null; then
    echo -e "${GREEN}✅ Superhuman running on port 9333${NC}"
  else
    echo -e "${YELLOW}⚠️  If Superhuman did not start, check $LOG_PATH${NC}"
  fi
  echo ""
  echo "🔄 Syncing Superhuman credentials (for drafts in Claude)..."
  "$BUN_CMD" "$INSTALL_DIR/src/index.ts" account auth >> "$AUTH_LOG_PATH" 2>&1 || true
  echo -e "${GREEN}✅ One-time sync attempted (background sync runs on every login and every 10 min)${NC}"
  echo ""
  echo "═══════════════════════════════════════"
  echo "✨ Setup complete"
  echo "═══════════════════════════════════════"
) || SETUP_EXIT=$?

if [ "$SETUP_EXIT" -eq 0 ]; then
  echo ""
  echo "╔════════════════════════════════════════════════════╗"
  echo "║                                                    ║"
  echo "║           ✅ Installation Complete! ✅             ║"
  echo "║                                                    ║"
  echo "╚════════════════════════════════════════════════════╝"
  echo ""
  echo "📝 What was done:"
  echo "  ✅ Superhuman MCP configured for Claude Desktop"
  echo "  ✅ Superhuman set to auto-start with debugging on login"
  echo "  ✅ Credential sync runs automatically on every login and every 10 min (no Terminal needed)"
  echo "  ✅ Claude Desktop config updated"
  echo ""
  echo "⚠️  IMPORTANT — You must restart Claude Desktop for this to take effect:"
  echo ""
  echo "  1. Quit Claude Desktop completely (Cmd+Q)"
  echo "  2. Reopen Claude Desktop"
  echo ""
  echo "💡 Drafts in Superhuman: If you use reply/forward from Claude, leave Superhuman open"
  echo "   once after boot (or open it when you need drafts). Sync runs in the background."
  echo ""
  echo "💬 Try: \"Show my inbox\" or \"Draft a reply to the latest from John\""
else
  echo ""
  echo "╔════════════════════════════════════════════════════╗"
  echo "║                                                    ║"
  echo "║              ⚠️  Installation Failed               ║"
  echo "║                                                    ║"
  echo "╚════════════════════════════════════════════════════╝"
  echo ""
  echo "Please check:"
  echo "  • Superhuman is installed in /Applications"
  echo "  • You have an internet connection (for Bun and the repo)"
  echo "  • Git is installed (Xcode Command Line Tools: xcode-select --install)"
  echo ""
  echo "Then run this installer again."
fi

echo ""
echo "Press ENTER to close..."
read -r
# Close this Terminal window so the user doesn't have to do it
osascript -e 'tell application "Terminal" to close front window' 2>/dev/null || true
