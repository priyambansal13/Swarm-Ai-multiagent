#!/usr/bin/env bash
# SwarmAI setup for macOS and Linux.
#   ./setup.sh                 full guided setup (keys → Docker → build → n8n → start)
#   ./setup.sh start|stop|restart|status|doctor|configure|n8n|tunnel
#   ./setup.sh setup --tunnel  also opens a Cloudflare tunnel for Telegram/WhatsApp webhooks
#   ./setup.sh setup --yes     non-interactive (reads keys from existing .env files / environment)
set -euo pipefail
cd "$(dirname "$0")"

need_node() {
  echo "Node.js 20+ is required."
  if [[ "$(uname)" == "Darwin" ]]; then
    if command -v brew >/dev/null 2>&1; then
      read -r -p "Install Node.js 22 with Homebrew now? [y/N] " a
      if [[ "${a:-n}" =~ ^[Yy] ]]; then brew install node@22 && brew link --overwrite --force node@22 && return 0; fi
    fi
    echo "Install: brew install node@22   or   https://nodejs.org"
  else
    echo "Install Node.js 20+ from https://nodejs.org or with your package manager (e.g. nvm install 22)."
  fi
  exit 1
}

if ! command -v node >/dev/null 2>&1; then need_node; fi
major=$(node -p 'process.versions.node.split(".")[0]')
if (( major < 20 )); then echo "Found Node.js $(node -v)."; need_node; fi

if ! command -v docker >/dev/null 2>&1; then
  if [[ "$(uname)" == "Darwin" ]]; then
    echo "Docker is required: install Docker Desktop (https://docker.com/products/docker-desktop) or OrbStack (brew install --cask orbstack), start it, then re-run."
  else
    echo "Docker is required: https://docs.docker.com/engine/install/ (with the compose plugin), then re-run."
  fi
  exit 1
fi

exec node scripts/swarm.mjs "$@"
