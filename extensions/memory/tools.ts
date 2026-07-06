/**
 * pi-esr: Memory tool registrations for Pi adapter
 *
 * Imports core engine and types from @pi-esr/core,
 * registers 4 memory tools with Pi's TypeBox tool system.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keyText } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ESRMemoryProvider } from "@pi-esr/memory-bridge";
import { SqliteMemoryProvider } from "@pi-esr/memory-bridge";
import { buildJournalSummary, recordStateChange } from "../../packages/core/src/journal.js";
import { buildActiveMemoryContext } from "../../packages/core/src/recall.js";
import {
  ESRGraph,
  getCurrentSessionId,
} from "../core";

function okText(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function errorText(error: string) {
  return {
    content: [{ type: "text" as const, text: `ERROR: ${error}` }],
    details: { error },
  };
}

export function buildMemoryPromptContext(graph: ESRGraph, store: SqliteMemoryProvider): string {
  const entityIds = graph.getAllEntities().map(e => e.entity_id);
  if (entityIds.length === 0) return "";
  return "\n\n" + buildActiveMemoryContext(store.getStore(), entityIds);
}

export function registerMemoryTools(pi: ExtensionAPI, store: ESRMemoryProvider): void {
  // ── esr_mem_store ──────────────────────────────────────────

  pi.registerTool({
    name: "esr_mem_store",
    label: "ESR Memory Store",
    description: "Store an observation anchored to an ESR entity.",
    promptSnippet: "Store an observation anchored to an ESR entity",
    parameters: Type.Object({
      entity_id: Type.String({ description: "ESR entity to anchor this memory to" }),
      content: Type.String({ description: "Free-text observation content" }),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags for filtering" })),
    }),
    async execute(_id, params) {
      if (typeof params.entity_id !== "string" || typeof params.content !== "string") {
        return errorText("entity_id and content are required");
      }
      const userTags = Array.isArray(params.tags) ? params.tags : undefined;
      const sessionId = getCurrentSessionId();
      const allTags = sessionId
        ? [...(userTags ?? []), `session:${sessionId}`]
        : userTags;
      const ref = await store.store({
        entityId: params.entity_id,
        kind: "note",
        content: params.content,
        metadata: { tags: allTags, sessionId: sessionId ?? undefined },
      });
      return okText(`Stored memory #${ref.ref_id} anchored to ${params.entity_id}`, {
        action: "esr_mem_store",
        id: ref.ref_id,
        entity_id: params.entity_id,
      });
    },
  });

  // ── esr_mem_recall ─────────────────────────────────────────

  pi.registerTool({
    name: "esr_mem_recall",
    label: "ESR Memory Recall",
    description: "Recall memories: by entity_id, by text search, or both.",
    promptSnippet: "Recall memories anchored to ESR entities",
    parameters: Type.Object({
      entity_id: Type.Optional(Type.String({ description: "Recall memories for this entity" })),
      query: Type.Optional(Type.String({ description: "Free-text search across all memories. Also matches entity_id." })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 20)" })),
    }),
    async execute(_id, params) {
      const limit = typeof params.limit === "number" ? params.limit : 20;

      let results;
      if (params.entity_id && params.query) {
        results = await store.fetch(await store.search({
          query: String(params.query),
          entityId: String(params.entity_id),
          limit,
        }));
      } else if (params.entity_id) {
        results = await store.fetch(await store.listByEntity({
          entityId: String(params.entity_id),
          limit,
        }));
      } else if (params.query) {
        results = await store.fetch(await store.search({ query: String(params.query), limit }));
      } else {
        return errorText("Provide entity_id, query, or both");
      }

      if (results.length === 0) {
        return okText("No memories found.", { action: "esr_mem_recall", count: 0, results: [] });
      }

      const text = results.map((record) => {
        if (store instanceof SqliteMemoryProvider) {
          return store.formatRecord(record);
        }
        return `[${record.ref.entity_id}] ${record.ref.created_at.slice(0, 16)}: ${record.content}`;
      }).join("\n");
      return okText(text, { action: "esr_mem_recall", count: results.length, results });
    },
    renderResult(result: any, { expanded }: { expanded: boolean }, theme: any) {
      const text = result.content?.[0]?.text || "";
      const count: number = result.details?.count ?? 0;
      if (count === 0 || text.startsWith("No memories")) {
        return new Text(theme.fg("dim", "No memories found."), 0, 0);
      }
      if (!expanded) {
        return new Text(
          theme.fg("accent", `${count} memories`) + theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`),
          0, 0,
        );
      }
      return new Text(text, 0, 0);
    },
  });

  // ── esr_mem_timeline ──────────────────────────────────────

  pi.registerTool({
    name: "esr_mem_timeline",
    label: "ESR Memory Timeline",
    description: "Chronological timeline of all observations about an entity.",
    promptSnippet: "Get chronological timeline for an ESR entity",
    parameters: Type.Object({
      entity_id: Type.String({ description: "Entity to get timeline for" }),
      limit: Type.Optional(Type.Number({ description: "Max entries (default 50)" })),
    }),
    async execute(_id, params) {
      const entityId = String(params.entity_id);
      const limit = typeof params.limit === "number" ? params.limit : 50;
      const entries = await store.timeline({ entityId, limit });

      if (entries.length === 0) {
        return okText(`No memories for ${entityId}`, { action: "esr_mem_timeline", entity_id: entityId, count: 0 });
      }

      const text = [
        `Timeline for ${entityId} (${await store.count(entityId)} total, showing ${entries.length}):`,
        ...entries.map((record) => {
          if (store instanceof SqliteMemoryProvider) {
            return store.formatRecord({ ref: record.ref, content: record.content });
          }
          return `[${record.ref.entity_id}] ${record.ref.created_at.slice(0, 16)}: ${record.content}`;
        }),
      ].join("\n");

      return okText(text, { action: "esr_mem_timeline", entity_id: entityId, count: entries.length });
    },
    renderResult(result: any, { expanded }: { expanded: boolean }, theme: any) {
      const text = result.content?.[0]?.text || "";
      const count: number = result.details?.count ?? 0;
      const entityId = result.details?.entity_id as string || "?";
      if (count === 0 || text.startsWith("No memories")) {
        return new Text(theme.fg("dim", `No timeline entries for ${entityId}.`), 0, 0);
      }
      if (!expanded) {
        return new Text(
          theme.fg("accent", `${count} entries`) + " for " + theme.fg("accent", entityId) +
            theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`),
          0, 0,
        );
      }
      return new Text(text, 0, 0);
    },
  });

  // ── esr_mem_journal ───────────────────────────────────────

  pi.registerTool({
    name: "esr_mem_journal",
    label: "ESR Memory Journal",
    description: "View state transition journal for entities, or record a manual journal entry.",
    promptSnippet: "View or record state transition journal",
    parameters: Type.Object({
      action: StringEnum(["view", "record"] as const),
      entity_id: Type.Optional(Type.String({ description: "Entity to view journal for or record entry about" })),
      transition: Type.Optional(Type.String({ description: "For record action: the state transition description" })),
    }),
    async execute(_id, params) {
      const action = String(params.action);

      if (action === "record") {
        const entityId = params.entity_id;
        const transition = params.transition;
        if (typeof entityId !== "string" || typeof transition !== "string") {
          return errorText("entity_id and transition required for record action");
        }
        await store.recordJournal(entityId, transition);
        return okText(`Recorded journal entry: ${entityId} ${transition}`, {
          action: "esr_mem_journal",
          entity_id: entityId,
          transition,
        });
      }

      if (params.entity_id) {
        const summary = store instanceof SqliteMemoryProvider
          ? buildJournalSummary(store.getStore(), [String(params.entity_id)])
          : (await store.getJournal({ entityId: String(params.entity_id), limit: 30 }))
            .map((entry) => `${entry.created_at.slice(0, 16)} ${entry.transition}`)
            .join("\n") || "(no journal entries)";
        return okText(summary, {
          action: "esr_mem_journal",
          entity_id: params.entity_id,
        });
      } else {
        const entries = await store.getAllJournal(30);
        const text = entries.length === 0
          ? "(no journal entries)"
          : entries.map(e => `[${e.entity_id}] ${e.created_at.slice(0, 16)}: ${e.transition}`).join("\n");
        return okText(text, { action: "esr_mem_journal", count: entries.length });
      }
    },
    renderResult(result: any, { expanded }: { expanded: boolean }, theme: any) {
      const text = result.content?.[0]?.text || "";
      // Record action: always short, show as-is
      if (result.details?.transition) {
        return new Text(text, 0, 0);
      }
      const count: number = result.details?.count ?? 0;
      if (count === 0 || text.includes("(no journal entries)")) {
        return new Text(theme.fg("dim", "No journal entries."), 0, 0);
      }
      if (!expanded) {
        const eid = result.details?.entity_id ? ` for ${result.details.entity_id}` : "";
        return new Text(
          theme.fg("accent", `${count} entries`) + eid +
            theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`),
          0, 0,
        );
      }
      return new Text(text, 0, 0);
    },
  });
}

export function onStateChange(store: SqliteMemoryProvider, entityId: string, oldState: string, newState: string, label?: string, fingerprint?: string): void {
  recordStateChange(store.getStore(), {
    entity_id: entityId,
    old_state: oldState,
    new_state: newState,
    label,
    fingerprint,
  });
}
