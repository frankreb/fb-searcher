#!/bin/bash
set -e

# ============================================================
# fb-searcher — Raspberry Pi 5 Setup Script
# Tested on: Raspberry Pi OS (Bookworm, 64-bit)
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_VERSION="20"

echo ""
echo "=========================================="
echo "  fb-searcher — Raspberry Pi 5 Setup"
echo "=========================================="
echo ""

# -----------------------------------------------------------
# 1. System packages
# -----------------------------------------------------------
info "Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

info "Installing system dependencies..."
sudo apt-get install -y \
  curl \
  git \
  build-essential \
  python3 \
  chromium-browser \
  chromium-codecs-ffmpeg \
  fonts-liberation \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdrm2 \
  libgbm1 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libxss1 \
  libxtst6 \
  xdg-utils \
  libpango-1.0-0 \
  libcairo2 \
  libasound2

# -----------------------------------------------------------
# 2. Node.js (via nvm)
# -----------------------------------------------------------
if command -v node &> /dev/null; then
  CURRENT_NODE=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$CURRENT_NODE" -ge "$NODE_VERSION" ]; then
    info "Node.js $(node -v) already installed."
  else
    warn "Node.js $(node -v) is too old. Installing v${NODE_VERSION}..."
    INSTALL_NODE=true
  fi
else
  INSTALL_NODE=true
fi

if [ "${INSTALL_NODE:-false}" = true ]; then
  info "Installing Node.js v${NODE_VERSION} via nvm..."
  export NVM_DIR="$HOME/.nvm"
  if [ ! -d "$NVM_DIR" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install "$NODE_VERSION"
  nvm use "$NODE_VERSION"
  nvm alias default "$NODE_VERSION"
  info "Node.js $(node -v) installed."
fi

# Make sure nvm is loaded
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# -----------------------------------------------------------
# 3. Codex CLI
# -----------------------------------------------------------
if command -v codex &> /dev/null; then
  info "Codex CLI already installed."
else
  info "Installing Codex CLI globally..."
  npm install -g @openai/codex
  info "Codex CLI installed. Run 'codex' once to configure your auth."
fi

# -----------------------------------------------------------
# 4. Project dependencies
# -----------------------------------------------------------
info "Installing project dependencies..."
cd "$APP_DIR"

# Tell Puppeteer to skip its bundled Chromium — we use the system one
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

npm install

# -----------------------------------------------------------
# 5. Build TypeScript
# -----------------------------------------------------------
info "Building project..."
npm run build

# -----------------------------------------------------------
# 6. Create data directories
# -----------------------------------------------------------
mkdir -p "$APP_DIR/data"
mkdir -p "$APP_DIR/cookies"

# -----------------------------------------------------------
# 7. Environment file
# -----------------------------------------------------------
if [ ! -f "$APP_DIR/.env" ]; then
  info "Creating .env from .env.example..."
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"

  # Set Chromium path for Raspberry Pi
  echo "" >> "$APP_DIR/.env"
  echo "# Raspberry Pi Chromium path" >> "$APP_DIR/.env"
  echo "PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser" >> "$APP_DIR/.env"

  warn "Please edit .env with your Telegram bot token, chat ID, and other settings:"
  warn "  nano $APP_DIR/.env"
else
  info ".env already exists, skipping."
fi

# -----------------------------------------------------------
# 8. Puppeteer config for system Chromium
# -----------------------------------------------------------
PUPPETEER_CONFIG="$APP_DIR/.puppeteerrc.cjs"
if [ ! -f "$PUPPETEER_CONFIG" ]; then
  info "Creating Puppeteer config for system Chromium..."
  cat > "$PUPPETEER_CONFIG" << 'PCONF'
const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  skipChromiumDownload: true,
  executablePath: '/usr/bin/chromium-browser',
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
PCONF
fi

# -----------------------------------------------------------
# 9. Systemd service (auto-start on boot)
# -----------------------------------------------------------
SERVICE_FILE="/etc/systemd/system/fb-searcher.service"
info "Setting up systemd service..."

# Resolve node path
NODE_PATH=$(which node)
NVM_DIR_RESOLVED="${NVM_DIR:-$HOME/.nvm}"

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
Environment=PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
Environment=PATH=${NVM_DIR_RESOLVED}/versions/node/v${NODE_VERSION}.*/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=${APP_DIR}/.env
ExecStart=${NODE_PATH} ${APP_DIR}/dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# Memory limits for Pi 5 (adjust as needed)
MemoryMax=512M
MemoryHigh=384M

[Install]
WantedBy=multi-user.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable fb-searcher

# -----------------------------------------------------------
# 10. Swap (Puppeteer can be memory-hungry)
# -----------------------------------------------------------
CURRENT_SWAP=$(free -m | awk '/^Swap:/ {print $2}')
if [ "$CURRENT_SWAP" -lt 1024 ]; then
  warn "Swap is ${CURRENT_SWAP}MB. Chromium needs more memory."
  info "Increasing swap to 2GB..."
  sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile 2>/dev/null || true
  sudo dphys-swapfile setup 2>/dev/null || true
  sudo dphys-swapfile swapon 2>/dev/null || true
  info "Swap configured to 2GB."
fi

# -----------------------------------------------------------
# Done
# -----------------------------------------------------------
echo ""
echo "=========================================="
echo "  Setup complete!"
echo "=========================================="
echo ""
info "Next steps:"
echo ""
echo "  1. Edit your config:"
echo "     nano $APP_DIR/.env"
echo ""
echo "  2. Add your Facebook cookies:"
echo "     nano $APP_DIR/cookies/cookies.json"
echo "     (see docs/SETUP.md for how to extract cookies)"
echo ""
echo "  3. Configure Codex CLI (for AI filtering):"
echo "     codex"
echo "     Then set AI_FILTER_ENABLED=true in .env"
echo ""
echo "  4. Start the service:"
echo "     sudo systemctl start fb-searcher"
echo ""
echo "  5. Check logs:"
echo "     journalctl -u fb-searcher -f"
echo ""
echo "  6. View the dashboard:"
echo "     http://$(hostname -I | awk '{print $1}'):3000"
echo ""
