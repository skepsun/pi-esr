#!/usr/bin/env node
/**
 * pi-esr CLI
 *
 * Usage:
 *   pi-esr setup                  Project-local install (default)
 *   pi-esr setup --global         Global install for all projects
 *   pi-esr setup --claude         MCP-only for Claude Code
 *   pi-esr setup --codex          MCP-only for Codex
 *   pi-esr plugin install         Install native plugin (Claude Code + Codex + Pi)
 *   pi-esr plugin install --pi    Pi Agent only
 *   pi-esr plugin install --pi --global  Global Pi install
 */

import {
  setupAll, setupOne, statusAll, removeAll, removeOne,
  pluginInstallAll, pluginInstallOne, pluginInstallPiGlobal, pluginRemoveAll, pluginRemoveOne, pluginStatusAll,
  setupPiGlobal,
} from "./setup.js";

const args = process.argv.slice(2);
const cmd = args[0] ?? "setup";
const isGlobal = args.includes("--global") || args.includes("-g");
const agentFlag = args.find(a => !a.startsWith("-") && a !== cmd && a !== "plugin" && a !== "install" && a !== "remove" && a !== "status");
const agent = agentFlag?.replace(/^--/, "");

if (cmd === "setup") {
  if (isGlobal && !agent) {
    console.log("🌍 pi-esr setup --global — installing globally for all projects...\n");
    printResult(setupPiGlobal());
    printResult(setupOne("claude"));
    printResult(setupOne("codex"));
    printResult(setupOne("cursor"));
    printResult(setupOne("opencode"));
  } else if (agent) {
    printResult(setupOne(agent));
  } else {
    console.log("🔧 pi-esr setup — configuring all supported agents...\n");
    const results = setupAll();
    for (const r of results) printResult(r);
  }
  console.log("\n✅ Done. Restart your agent to use ESR tools.");
} else if (cmd === "status") {
  console.log("pi-esr v0.6.3\n");
  const results = statusAll();
  for (const r of results) {
    const icon = r.status === "configured" ? "✅" : r.status === "already" ? "✓" : "✗";
    console.log(`  ${icon} ${r.agent}: ${r.message}`);
  }
} else if (cmd === "remove") {
  if (agent) {
    printResult(removeOne(agent));
  } else {
    console.log("🔧 pi-esr remove — removing from all supported agents...\n");
    const results = removeAll();
    for (const r of results) printResult(r);
    console.log("\n✅ Done. Restart your agent for changes to take effect.");
  }
} else if (cmd === "plugin") {
  const sub = args[1];
  if (sub === "install") {
    if (agent) {
      if (agent === "pi" && isGlobal) {
        printResult(pluginInstallPiGlobal());
      } else {
        printResult(pluginInstallOne(agent));
      }
    } else {
      console.log("🔌 pi-esr plugin install — native plugins plus MCP registration for Claude Code and Codex...\n");
      const results = pluginInstallAll();
      for (const r of results) printResult(r);
      console.log("\n✅ Done. Restart your agent to use ESR tools.");
    }
  } else if (sub === "remove") {
    if (agent) {
      printResult(pluginRemoveOne(agent));
    } else {
      console.log("🔌 pi-esr plugin remove — removing from all agents...\n");
      const results = pluginRemoveAll();
      for (const r of results) printResult(r);
      console.log("\n✅ Done. Restart your agent for changes to take effect.");
    }
  } else if (sub === "status") {
    console.log("pi-esr plugin status:\n");
    const results = pluginStatusAll();
    for (const r of results) {
      const icon = r.status === "configured" ? "✅" : r.status === "already" ? "✓" : r.status === "not-found" ? "⊘" : "✗";
      console.log(`  ${icon} ${r.agent}: ${r.message}`);
    }
  } else {
    console.log("Usage: pi-esr plugin <command>");
    console.log("  install           Install plugin (Claude Code + Codex + Pi)");
    console.log("  install --pi      Pi Agent only (project-local)");
    console.log("  install --pi --global  Pi Agent globally");
    console.log("  remove            Remove plugin from all agents");
    console.log("  remove --pi       Remove Pi Agent plugin");
    console.log("  status            Show plugin status");
  }
} else {
  console.log("Usage: pi-esr <command>");
  console.log("  setup              Project-local install (recommended)");
  console.log("  setup --global     Global install for all projects");
  console.log("  plugin install     Install native plugins + MCP");
  console.log("  plugin install --pi --global  Global Pi install");
}

function printResult(r: { agent: string; status: string; message: string }): void {
  const icon =
    r.status === "configured" ? "✅" :
    r.status === "already" ? "✓" :
    r.status === "not-found" ? "⊘" : "✗";
  console.log(`  ${icon} ${r.agent}: ${r.message}`);
}
