#!/bin/bash
# pi-loom: SessionStart — inject [PI_LOOM] symbolic index into model context
# Uses loom-cli.mjs context-inject — zero shell dependencies beyond node.

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"
CLI="$PLUGIN_ROOT/scripts/loom-cli.mjs"

if [ ! -f "$CLI" ]; then
  CLI="$(dirname "$0")/loom-cli.mjs"
fi
if [ ! -f "$CLI" ]; then
  exit 0
fi

node "$CLI" context-inject 2>/dev/null
exit 0
