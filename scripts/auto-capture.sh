#!/bin/bash
# pi-loom: PostToolUse / PostToolUseFailure — auto-capture
# Pipes hook stdin to loom-cli.mjs capture command for pattern-matched memory storage.
# Zero shell dependencies beyond node and bash.

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}}"
CLI="$PLUGIN_ROOT/scripts/loom-cli.mjs"
if [ ! -f "$CLI" ]; then
  CLI="$(dirname "$0")/loom-cli.mjs"
fi
if [ ! -f "$CLI" ]; then
  exit 0
fi

# Pipe hook stdin directly to capture command — all pattern matching
# is done in JavaScript, eliminating the jq dependency entirely.
cat | node "$CLI" capture 2>/dev/null
exit 0
