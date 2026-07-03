#!/bin/bash
# pi-loom: PreToolUse — protocol enforcement
# Blocks non-loom, non-ESR tools until loom_status() or loom_recall() is called

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"
CLI="$PLUGIN_ROOT/scripts/loom-cli.mjs"
[ ! -f "$CLI" ] && CLI="$(dirname "$0")/loom-cli.mjs"
[ ! -f "$CLI" ] && exit 0

# Pipe hook stdin to guard command
node "$CLI" guard
