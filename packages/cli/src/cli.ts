#!/usr/bin/env node
/**
 * pi-esr CLI
 *
 * Usage:
 *   pi-esr plugin install       Install as native plugin (✨ recommended)
 *   pi-esr plugin install --claude | --codex | --pi
 *   pi-esr plugin remove        Remove native plugin
 *   pi-esr plugin remove --claude | --codex | --pi
 *   pi-esr plugin status        Show plugin installation status
 *   pi-esr setup (legacy)       Auto-configure all agents via MCP+prompt injection
 *   pi-esr remove (legacy)      Remove legacy setup from all agents
 *   pi-esr status               Show configuration status
 */

import {
  setupAll, setupOne, statusAll, removeAll, removeOne,
  pluginInstallAll, pluginInstallOne, pluginRemoveAll, pluginRemoveOne, pluginStatusAll,
} from "./setup.js";

const cmd = process.argv[2] ?? "setup";

if (cmd === "setup") {
  const agent = process.argv[3];
  if (agent) {
    const flag = agent.replace(/^--/, "");
    printResult(setupOne(flag));
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
} else if (cmd === "remove") {
  const agent = process.argv[3];
  if (agent) {
    const flag = agent.replace(/^--/, "");
    printResult(removeOne(flag));
  } else {
    console.log("🔧 pi-esr remove — removing from all supported agents...\n");
    const results = removeAll();
    for (const r of results) printResult(r);
    console.log("\n✅ Done. Restart your agent for changes to take effect.");
  }
} else if (cmd === "plugin") {
  const sub = process.argv[3];
  if (sub === "install") {
    const agent = process.argv[4];
    if (agent) {
      printResult(pluginInstallOne(agent.replace(/^--/, "")));
    } else {
      console.log("🔌 pi-esr plugin install — native plugins for Claude Code, Codex & Pi...\n");
      const results = pluginInstallAll();
      for (const r of results) printResult(r);
      console.log("\n✅ Done. Restart your agent to use ESR tools.");
    }
  } else if (sub === "remove") {
    const agent = process.argv[4];
    if (agent) {
      printResult(pluginRemoveOne(agent.replace(/^--/, "")));
    } else {
      console.log("🔌 pi-esr plugin remove — removing from all agents...\n");
      const results = pluginRemoveAll();
      for (const r of results) printResult(r);
      console.log("\n✅ Done. Restart your agent for changes to take effect.");
    }
  } else if (sub === "status") {
    console.log("pi-esr plugin status:");
    console.log("");
    const results = pluginStatusAll();
    for (const r of results) {
      const icon = r.status === "configured" ? "✅" : r.status === "already" ? "✓" : r.status === "not-found" ? "⊘" : "✗";
      console.log(`  ${icon} ${r.agent}: ${r.message}`);
    }
  } else {
    console.log("Usage: pi-esr plugin <command>");
    console.log("  install           Install as native plugin (Claude Code + Codex + Pi)");
    console.log("  install --claude  Install Claude Code plugin only");
    console.log("  install --codex   Install Codex plugin only");
    console.log("  install --pi      Install Pi Agent plugin only");
    console.log("  remove            Remove plugin from all agents");
    console.log("  remove --claude   Remove Claude Code plugin");
    console.log("  remove --codex    Remove Codex plugin");
    console.log("  remove --pi       Remove Pi Agent plugin");
    console.log("  status            Show plugin installation status");
  }
} else {
  console.log(`Usage: pi-esr <command>`);
  console.log(`  plugin install       Install as native plugin (✨ recommended)`);
  console.log(`  plugin install --claude | --codex | --pi`);
  console.log(`  plugin remove        Remove native plugin`);
  console.log(`  plugin remove --claude | --codex | --pi`);
  console.log(`  plugin status        Show plugin status`);
  console.log(`  setup (legacy)       Auto-configure all agents via MCP+prompt injection`);
  console.log(`  remove (legacy)      Remove legacy setup from all agents`);
  console.log(`  status               Show setup status`);
}

function printResult(r: { agent: string; status: string; message: string }): void {
  const icon =
    r.status === "configured" ? "✅" :
    r.status === "already" ? "✓" :
    r.status === "not-found" ? "⊘" : "✗";
  console.log(`  ${icon} ${r.agent}: ${r.message}`);
}
