/**
 * pi-esr: Pi Command Registrations
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { ESRGraph, ESRRuntime, ESRRuntimeStateStore, buildESRContext } from "@pi-esr/core";
import type { MemoryStore } from "@pi-esr/core";
import { persistGraph } from "../persistence/snapshot";
import { persistRuntimeState } from "../persistence/runtime-state";
import { clearGraphState } from "../persistence/graph-persist";

let _memoryStore: MemoryStore | null = null;

export function setMemoryStoreForCommands(store: MemoryStore | null): void {
  _memoryStore = store;
}

function buildRuntimeSummary(runtimeStore: ESRRuntimeStateStore): string[] {
  const nodes = runtimeStore.getNodes().sort((a, b) => a.node_id.localeCompare(b.node_id));
  const events = runtimeStore.getEvents();
  const lines = ["", `Runtime Nodes: ${nodes.length} | Events: ${events.length}`, ""];

  if (nodes.length === 0) {
    lines.push("  (none)");
    return lines;
  }

  for (const node of nodes) {
    const deps = node.dependencies.length > 0
      ? ` → ${node.dependencies.join(", ")}`
      : "";
    const err = node.last_error ? ` ❌ ${node.last_error.slice(0, 50)}` : "";
    const icon = node.state === "succeeded" ? "✓" : node.state === "failed" ? "✗" : node.state === "cached" ? "↻" : node.state === "running" ? "⏳" : "○";
    lines.push(`  ${icon} ${node.node_id} [${node.kind}] ${node.state}${deps}${err}`);
  }
  return lines;
}

export function registerCommands(pi: ExtensionAPI, graph: ESRGraph, runtime: ESRRuntime, runtimeStore: ESRRuntimeStateStore): void {
  pi.registerCommand("esr", {
    description: "Show the ESR (Engineering State Runtime) graph",
    handler: async (_args, ctx) => {
      const lines = buildESRContext(graph).split("\n").concat(buildRuntimeSummary(runtimeStore));
      if (ctx.mode === "tui" && ctx.hasUI) {
        await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
          const headerText = theme.fg("accent", theme.bold(" ESR Graph "));
          const headerLine = `${theme.fg("borderMuted", "═══")}${headerText}${theme.fg("borderMuted", "═".repeat(20))}`;

          class ESRView {
            private text = [headerLine, ...lines, "", theme.fg("dim", "Press Escape to close"), ""];

            invalidate(): void {}

            handleInput(data: string): void {
              if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done();
            }

            render(width: number): string[] {
              return this.text.map(line => truncateToWidth(line, width));
            }
          }

          return new ESRView();
        });
      } else {
        ctx.ui.notify(lines.join("\n"), "info");
      }
    },
  });

  pi.registerCommand("esr-clear", {
    description: "Clear the ESR graph (reset all entities, relations, artifacts)",
    handler: async (_args, ctx) => {
      const confirmed = await ctx.ui.confirm(
        "Clear ESR Graph",
        "Are you sure you want to clear all ESR entities, relations, artifacts, and runtime nodes?",
      );
      if (confirmed) {
        graph.clear();
        runtimeStore.clear();
        persistGraph(pi, graph);
        persistRuntimeState(pi, runtimeStore);
        clearGraphState(pi);
        ctx.ui.notify("ESR graph cleared", "info");
      }
    },
  });

  pi.registerCommand("esr-step", {
    description: "Run one ESR runtime tick",
    handler: async (_args, ctx) => {
      const result = await runtime.tick();
      ctx.ui.notify(`ESR runtime tick: ${result.status}${result.selectedNodeId ? ` (${result.selectedNodeId})` : ""}`, "info");
    },
  });

  pi.registerCommand("esr-run", {
    description: "Run ESR runtime until idle",
    handler: async (args, ctx) => {
      const parsed = Number.parseInt(args.trim(), 10);
      const maxSteps = Number.isFinite(parsed) ? parsed : 100;
      const results = await runtime.runUntilIdle(maxSteps);
      const last = results[results.length - 1];
      ctx.ui.notify(`ESR runtime run: steps=${results.length} last=${last?.status ?? "idle"}`, "info");
    },
  });

  // ── Memory commands ──────────────────────────────────

  pi.registerCommand("esr-mem", {
    description: "Show ESR memory: observations, journal, or search",
    handler: async (args, ctx) => {
      const mem = _memoryStore;
      if (!mem) {
        ctx.ui.notify("Memory store not available (better-sqlite3 not installed)", "error");
        return;
      }

      const query = args.trim();
      let lines: string[] = [];

      if (query) {
        // Search
        const results = mem.search(query, 30);
        lines.push(`Search: "${query}" — ${results.length} results`);
        lines.push("");
        for (const obs of results) {
          const tags = obs.tags?.length ? ` [${obs.tags.join(", ")}]` : "";
          lines.push(`  ▸ ${obs.entity_id}${tags}`);
          lines.push(`    ${obs.content.slice(0, 120)}`);
          lines.push(`    ${obs.created_at}`);
          lines.push("");
        }
      } else {
        // Overview
        const total = mem.count();
        const journalEntries = mem.getAllJournal(20);
        lines.push(`ESR Memory — ${total} observations, ${journalEntries.length} recent journal entries`);
        lines.push("");
        if (journalEntries.length > 0) {
          lines.push("Recent state transitions:");
          for (const j of journalEntries) {
            lines.push(`  ${j.created_at} | ${j.entity_id}: ${j.transition}`);
          }
          lines.push("");
        }
        lines.push("Use /esr-mem <query> to search, /esr-mem <entity_id> for entity timeline.");
      }

      if (ctx.mode === "tui" && ctx.hasUI) {
        await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
          const headerText = theme.fg("accent", theme.bold(" ESR Memory "));
          const headerLine = `${theme.fg("borderMuted", "═══")}${headerText}${theme.fg("borderMuted", "═".repeat(15))}`;

          class MemView {
            private text = [headerLine, ...lines, "", theme.fg("dim", "Press Escape to close"), ""];
            invalidate(): void {}
            handleInput(data: string): void {
              if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) done();
            }
            render(width: number): string[] {
              return this.text.map(line => truncateToWidth(line, width));
            }
          }
          return new MemView();
        });
      } else {
        ctx.ui.notify(lines.join("\n"), "info");
      }
    },
  });
}
