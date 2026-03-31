#!/bin/bash
set -e

# ============================================================
# fb-searcher — Raspberry Pi 5 Setup Script (virgin install)
# Tested on: Raspberry Pi OS (Bookworm, 64-bit)
# Run: curl -sL https://raw.githubusercontent.com/frankreb/fb-searcher/main/setup.sh | bash
# Or:  git clone ... && cd fb-searcher && chmod +x setup.sh && ./setup.sh
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

NODE_VERSION="20"
REPO_URL="https://github.com/frankreb/fb-searcher.git"
INSTALL_DIR="$HOME/fb-searcher"

echo ""
echo "=========================================="
echo "  fb-searcher — Raspberry Pi 5 Setup"
echo "  Full virgin install"
echo "=========================================="
echo ""

# -----------------------------------------------------------
# 0. Detect architecture
# -----------------------------------------------------------
ARCH=$(uname -m)
info "Detected architecture: $ARCH"
if [[ "$ARCH" != "aarch64" && "$ARCH" != "armv7l" && "$ARCH" != "x86_64" ]]; then
  warn "Untested architecture: $ARCH. Proceeding anyway..."
fi

# -----------------------------------------------------------
# 1. Base system packages (needed for everything else)
# -----------------------------------------------------------
info "Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

info "Installing base tools..."
sudo apt-get install -y \
  curl \
  wget \
  git \
  ca-certificates \
  gnupg \
  build-essential \
  python3 \
  make \
  gcc \
  g++

# -----------------------------------------------------------
# 2. Chromium browser + dependencies for Puppeteer
# -----------------------------------------------------------
info "Installing Chromium and browser dependencies..."

# Chromium package name varies by distro/version
CHROMIUM_PKG=""
if apt-cache show chromium &>/dev/null; then
  CHROMIUM_PKG="chromium"
elif apt-cache show chromium-browser &>/dev/null; then
  CHROMIUM_PKG="chromium-browser"
fi

# Install browser rendering dependencies
sudo apt-get install -y \
  fonts-liberation \
  fonts-noto-color-emoji \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libxss1 \
  libxtst6 \
  xdg-utils \
  libpango-1.0-0 \
  libcairo2 \
  libasound2t64 2>/dev/null || sudo apt-get install -y libasound2

# Install Chromium
if [ -n "$CHROMIUM_PKG" ]; then
  sudo apt-get install -y "$CHROMIUM_PKG"
elif command -v snap &>/dev/null; then
  info "Installing Chromium via snap..."
  sudo snap install chromium
else
  error "Cannot install Chromium. No apt package or snap available."
fi

# Find the Chromium binary
CHROMIUM_BIN=""
for candidate in chromium chromium-browser /snap/bin/chromium; do
  if command -v "$candidate" &>/dev/null || [ -x "$candidate" ]; then
    CHROMIUM_BIN=$(command -v "$candidate" 2>/dev/null || echo "$candidate")
    break
  fi
done
[ -z "$CHROMIUM_BIN" ] && error "Chromium installed but binary not found."
info "Chromium found at: $CHROMIUM_BIN"

# Verify it runs
"$CHROMIUM_BIN" --version 2>/dev/null && info "Chromium is working." || warn "Chromium installed but --version check failed. May still work."

# -----------------------------------------------------------
# 3. Node.js + npm (via nvm)
# -----------------------------------------------------------
info "Setting up Node.js v${NODE_VERSION}..."

export NVM_DIR="$HOME/.nvm"

# Install nvm if not present
if [ ! -d "$NVM_DIR" ]; then
  info "Installing nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi

# Load nvm into current shell
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"

# Check if correct Node version exists
if command -v node &>/dev/null; then
  CURRENT_NODE=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$CURRENT_NODE" -ge "$NODE_VERSION" ]; then
    info "Node.js $(node -v) already installed."
  else
    warn "Node.js $(node -v) is too old. Installing v${NODE_VERSION}..."
    nvm install "$NODE_VERSION"
    nvm use "$NODE_VERSION"
    nvm alias default "$NODE_VERSION"
  fi
else
  info "Installing Node.js v${NODE_VERSION}..."
  nvm install "$NODE_VERSION"
  nvm use "$NODE_VERSION"
  nvm alias default "$NODE_VERSION"
fi

# Reload to be sure
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Verify both node and npm work
command -v node &>/dev/null || error "Node.js installation failed."
command -v npm &>/dev/null || error "npm not found. Should come with Node.js."
info "Node.js $(node -v) and npm $(npm -v) are ready."

# Add nvm to shell profile if not already there
for PROFILE_FILE in "$HOME/.bashrc" "$HOME/.profile"; do
  if [ -f "$PROFILE_FILE" ]; then
    if ! grep -q 'NVM_DIR' "$PROFILE_FILE"; then
      info "Adding nvm to $PROFILE_FILE..."
      cat >> "$PROFILE_FILE" << 'NVMRC'

# nvm (Node Version Manager)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
NVMRC
    fi
  fi
done

# -----------------------------------------------------------
# 4. Codex CLI
# -----------------------------------------------------------
if command -v codex &>/dev/null; then
  info "Codex CLI already installed."
else
  info "Installing Codex CLI globally..."
  npm install -g @openai/codex
  if command -v codex &>/dev/null; then
    info "Codex CLI installed successfully."
  else
    warn "Codex CLI installed but not in PATH. You may need to open a new terminal."
  fi
fi

# -----------------------------------------------------------
# 5. Clone or update the project
# -----------------------------------------------------------
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Project already cloned at $INSTALL_DIR. Pulling latest..."
  cd "$INSTALL_DIR"
  git pull
elif [ -f "$INSTALL_DIR/package.json" ]; then
  # We're running from inside the repo (user cloned manually)
  info "Project found at $INSTALL_DIR."
  cd "$INSTALL_DIR"
else
  info "Cloning fb-searcher to $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

APP_DIR="$(pwd)"

# -----------------------------------------------------------
# 6. Install npm dependencies
# -----------------------------------------------------------
info "Installing project dependencies..."
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
npm install --production=false

# -----------------------------------------------------------
# 7. Build TypeScript
# -----------------------------------------------------------
info "Building project..."
npm run build

# -----------------------------------------------------------
# 8. Create data directories
# -----------------------------------------------------------
mkdir -p "$APP_DIR/data"
mkdir -p "$APP_DIR/cookies"

# -----------------------------------------------------------
# 9. Environment file
# -----------------------------------------------------------
if [ ! -f "$APP_DIR/.env" ]; then
  info "Creating .env from template..."
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"

  # Set the Chromium path
  echo "" >> "$APP_DIR/.env"
  echo "# Raspberry Pi Chromium path (auto-detected)" >> "$APP_DIR/.env"
  echo "PUPPETEER_EXECUTABLE_PATH=${CHROMIUM_BIN}" >> "$APP_DIR/.env"

  warn ">>> You MUST edit .env with your credentials before starting! <<<"
  warn "    nano $APP_DIR/.env"
else
  info ".env already exists, skipping."
fi

# -----------------------------------------------------------
# 10. Puppeteer config for system Chromium
# -----------------------------------------------------------
cat > "$APP_DIR/.puppeteerrc.cjs" << PCONF
const { join } = require('path');
module.exports = {
  skipChromiumDownload: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '${CHROMIUM_BIN}',
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
PCONF
info "Puppeteer configured to use system Chromium."

# -----------------------------------------------------------
# 11. Swap (Chromium needs memory)
# -----------------------------------------------------------
CURRENT_SWAP=$(free -m | awk '/^Swap:/ {print $2}')
if [ "$CURRENT_SWAP" -lt 1024 ]; then
  warn "Swap is only ${CURRENT_SWAP}MB. Increasing to 2GB for Chromium..."
  if [ -f /etc/dphys-swapfile ]; then
    sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
    sudo dphys-swapfile setup
    sudo dphys-swapfile swapon
    info "Swap set to 2GB."
  else
    # Fallback: create a swap file manually
    info "Creating 2GB swap file..."
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    info "Swap file created and enabled."
  fi
fi

# -----------------------------------------------------------
# 12. Systemd service (auto-start on boot)
# -----------------------------------------------------------
SERVICE_FILE="/etc/systemd/system/fb-searcher.service"
info "Creating systemd service..."

NODE_PATH=$(which node)
NODE_DIR=$(dirname "$NODE_PATH")
CODEX_PATH=$(which codex 2>/dev/null || echo "")
NPM_GLOBAL_BIN=$(npm -g bin 2>/dev/null || echo "$NVM_DIR/versions/node/v${NODE_VERSION}.*/bin")

sudo tee "$SERVICE_FILE" > /dev/null << SVCEOF
[Unit]
Description=FB Searcher - Facebook Marketplace & Groups Monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
Environment=PUPPETEER_EXECUTABLE_PATH=${CHROMIUM_BIN}
Environment=PATH=${NODE_DIR}:${NPM_GLOBAL_BIN}:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=${APP_DIR}/.env
ExecStart=${NODE_PATH} ${APP_DIR}/dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# Memory limits for Pi 5 (adjust if needed)
MemoryMax=512M
MemoryHigh=384M

[Install]
WantedBy=multi-user.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable fb-searcher
info "Systemd service created and enabled (auto-start on boot)."

# -----------------------------------------------------------
# 13. Make node/npm/codex available in current shell
# -----------------------------------------------------------
# Write a small env loader script that the user can source
ENV_LOADER="$APP_DIR/.load-env.sh"
cat > "$ENV_LOADER" << ENVEOF
# Source this to load node/npm/codex into your current shell
export NVM_DIR="\$HOME/.nvm"
[ -s "\$NVM_DIR/nvm.sh" ] && . "\$NVM_DIR/nvm.sh"
[ -s "\$NVM_DIR/bash_completion" ] && . "\$NVM_DIR/bash_completion"
ENVEOF

# Also create a global profile.d script so ALL new shells get node/npm automatically
sudo tee /etc/profile.d/nvm-global.sh > /dev/null << 'PROFEOF'
# Load nvm for all users (if installed in their home)
if [ -d "$HOME/.nvm" ]; then
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi
PROFEOF
sudo chmod +x /etc/profile.d/nvm-global.sh

# -----------------------------------------------------------
# Done!
# -----------------------------------------------------------
PI_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "=========================================="
echo "  Setup complete!"
echo "=========================================="
echo ""
echo "  Everything is installed:"
echo "    - Chromium: $CHROMIUM_BIN"
echo "    - Node.js:  $(node -v)"
echo "    - npm:      $(npm -v)"
echo "    - Codex:    $(command -v codex 2>/dev/null || echo 'run: source ~/.bashrc')"
echo "    - Project:  $APP_DIR"
echo ""
warn "To use node/npm/codex in THIS terminal, run:"
echo ""
echo "     source ~/.bashrc"
echo ""
echo "  (New terminals will work automatically.)"
echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  NEXT STEPS (you must do these manually):   │"
echo "  └─────────────────────────────────────────────┘"
echo ""
echo "  1. Load tools in this terminal:"
echo "     source ~/.bashrc"
echo ""
echo "  2. Edit your config with Telegram credentials:"
echo "     nano $APP_DIR/.env"
echo ""
echo "  3. Add your Facebook cookies:"
echo "     nano $APP_DIR/cookies/cookies.json"
echo ""
echo "  4. (Optional) Set up Codex CLI for AI filtering:"
echo "     codex"
echo "     Then set AI_FILTER_ENABLED=true in .env"
echo ""
echo "  5. Start the service:"
echo "     sudo systemctl start fb-searcher"
echo ""
echo "  6. Check logs:"
echo "     journalctl -u fb-searcher -f"
echo ""
echo "  7. Open the dashboard:"
echo "     http://${PI_IP}:3000"
echo ""
