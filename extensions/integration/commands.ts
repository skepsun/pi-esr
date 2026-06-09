/**
 * pi-esr: Pi Command Registrations
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ESRMemoryProvider } from "@pi-esr/memory-bridge";
import { ESRGraph, buildESRContext } from "../core";
import { persistGraph } from "../persistence/snapshot";
import { clearGraphState } from "../persistence/graph-persist";

let _memoryStore: ESRMemoryProvider | null = null;

export function setMemoryStoreForCommands(store: ESRMemoryProvider | null): void {
  _memoryStore = store;
}

export function registerCommands(pi: ExtensionAPI, graph: ESRGraph): void {
  pi.registerCommand("esr", {
    description: "Show the ESR (Engineering State Runtime) graph",
    handler: async (_args, ctx) => {
      const lines = buildESRContext(graph).split("\n");
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
        "Are you sure you want to clear all ESR entities, relations, and artifacts?",
      );
      if (confirmed) {
        graph.clear();
        persistGraph(pi, graph);
        clearGraphState(pi);
        ctx.ui.notify("ESR graph cleared", "info");
      }
    },
  });

  // ── Memory commands ──────────────────────────────────

  pi.registerCommand("esr-mem", {
    description: "Show ESR memory: observations, journal, or search",
    handler: async (args, ctx) => {
      const mem = _memoryStore;
      if (!mem || !await mem.isAvailable()) {
        ctx.ui.notify("Memory store not available (better-sqlite3 not installed)", "error");
        return;
      }

      const query = args.trim();
      let lines: string[] = [];

      if (query) {
        // Search
        const refs = await mem.search({ query, limit: 30 });
        const records = await mem.fetch(refs);
        lines.push(`Search: "${query}" — ${records.length} results`);
        lines.push("");
        for (const obs of records) {
          const tags = Array.isArray(obs.ref.metadata?.tags)
            ? ` [${obs.ref.metadata.tags.filter((tag): tag is string => typeof tag === "string").join(", ")}]`
            : "";
          lines.push(`  ▸ ${obs.ref.entity_id}${tags}`);
          lines.push(`    ${obs.content.slice(0, 120)}`);
          lines.push(`    ${obs.ref.created_at}`);
          lines.push("");
        }
      } else {
        // Overview
        const total = await mem.count();
        const journalEntries = await mem.getAllJournal(20);
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
