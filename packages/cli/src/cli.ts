#!/usr/bin/env node
/**
 * pi-esr CLI
 *
 * Usage:
 *   pi-esr setup              Auto-detect and configure all agents
 *   pi-esr setup --claude     Configure Claude Code only
 *   pi-esr setup --cursor     Configure Cursor only
 *   pi-esr setup --opencode   Configure OpenCode only
 *   pi-esr setup --pi         Configure Pi Agent only
 *   pi-esr status             Show configuration status
 */

import { setupAll, setupOne, statusAll } from "./setup.js";

const cmd = process.argv[2] ?? "setup";

if (cmd === "setup") {
  const agent = process.argv[3];
  if (agent) {
    const flag = agent.replace(/^--/, "");
    const result = setupOne(flag);
    printResult(result);
  } else {
    console.log("🔧 pi-esr setup — configuring all supported agents...\n");
    const results = setupAll();
    for (const r of results) printResult(r);
    console.log("\n✅ Done. Restart your agent to use ESR tools.");
  }
} else if (cmd === "status") {
  console.log("pi-esr v0.3.0");
  console.log("");
  const results = statusAll();
  for (const r of results) {
    const icon = r.status === "configured" ? "✅" : r.status === "already" ? "✓" : "✗";
    console.log(`  ${icon} ${r.agent}: ${r.message}`);
  }
} else {
  console.log(`Usage: pi-esr <command>`);
  console.log(`  setup          Auto-configure all agents`);
  console.log(`  setup --claude Configure Claude Code`);
  console.log(`  setup --codex   Configure Codex`);
  console.log(`  setup --cursor Configure Cursor`);
  console.log(`  setup --opencode Configure OpenCode`);
  console.log(`  setup --pi     Configure Pi Agent`);
  console.log(`  status         Show setup status`);
}

function printResult(r: { agent: string; status: string; message: string }): void {
  const icon =
    r.status === "configured" ? "✅" :
    r.status === "already" ? "✓" :
    r.status === "not-found" ? "⊘" : "✗";
  console.log(`  ${icon} ${r.agent}: ${r.message}`);
}
