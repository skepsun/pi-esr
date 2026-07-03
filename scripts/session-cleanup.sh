#!/bin/bash
# pi-loom: SessionEnd / Stop — cleanup + consolidation
# Expires overdue memories and cleans old raw events.

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"
CLI="$PLUGIN_ROOT/scripts/loom-cli.mjs"
[ ! -f "$CLI" ] && CLI="$(dirname "$0")/loom-cli.mjs"
[ ! -f "$CLI" ] && exit 0

node "$CLI" cleanup 2>/dev/null
exit 0
