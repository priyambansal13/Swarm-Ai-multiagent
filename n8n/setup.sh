#!/usr/bin/env bash
# Kept for compatibility — the cross-platform tool does the work (also works on Windows: setup.cmd n8n).
cd "$(dirname "$0")/.." && exec node scripts/swarm.mjs n8n "$@"
