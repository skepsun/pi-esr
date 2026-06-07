#!/usr/bin/env node
/**
 * pi-esr-opencode CLI
 *
 * Outputs OpenCode MCP config to stdout. Pipe to opencode.json:
 *   npx @pi-esr/adapter-opencode > opencode.json
 *
 * Or use --print to see the config that would be written.
 */

const config = {
  mcp: {
    "pi-esr": {
      type: "local",
      command: ["npx", "@pi-esr/adapter-mcp"],
      enabled: true,
      timeout: 5000,
    },
  },
};

const flag = process.argv[2];

if (flag === "--print" || flag === "-p") {
  console.log(JSON.stringify(config, null, 2));
} else {
  // Output just the MCP config snippet for appending
  const snippet = {
    mcp: config.mcp,
  };
  console.log(JSON.stringify(snippet, null, 2));
}
