#!/bin/bash
# pi-loom: PostToolUse on loom_status/loom_recall — unlock protocol
# Called after the agent runs loom_status or loom_recall successfully

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"
CLI="$PLUGIN_ROOT/scripts/loom-cli.mjs"
[ ! -f "$CLI" ] && CLI="$(dirname "$0")/loom-cli.mjs"
[ ! -f "$CLI" ] && exit 0

node "$CLI" unlock
