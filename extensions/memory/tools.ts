/**
 * pi-esr: Memory tool registrations for Pi adapter
 *
 * Imports core engine and types from @pi-esr/core,
 * registers 4 memory tools with Pi's TypeBox tool system.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  ESRGraph,
  MemoryStore,
  getCurrentSessionId,
  formatObservation,
  buildJournalSummary,
  buildActiveMemoryContext,
} from "@pi-esr/core";
import { recordStateChange } from "@pi-esr/core";

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

export function buildMemoryPromptContext(graph: ESRGraph, store: MemoryStore): string {
  const entityIds = graph.getAllEntities().map(e => e.entity_id);
  if (entityIds.length === 0) return "";
  return "\n\n" + buildActiveMemoryContext(store, entityIds);
}

export function registerMemoryTools(pi: ExtensionAPI, store: MemoryStore): void {
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
      const id = store.store(params.entity_id, params.content, { tags: allTags });
      return okText(`Stored memory #${id} anchored to ${params.entity_id}`, {
        action: "esr_mem_store",
        id,
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
        const searched = store.search(String(params.query), limit * 2);
        results = searched.filter(o => o.entity_id === params.entity_id).slice(0, limit);
      } else if (params.entity_id) {
        results = store.recall(String(params.entity_id), limit);
      } else if (params.query) {
        results = store.search(String(params.query), limit);
      } else {
        return errorText("Provide entity_id, query, or both");
      }

      if (results.length === 0) {
        return okText("No memories found.", { action: "esr_mem_recall", count: 0, results: [] });
      }

      const text = results.map(o => formatObservation(o)).join("\n");
      return okText(text, { action: "esr_mem_recall", count: results.length, results });
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
      const entries = store.timeline(entityId, limit);

      if (entries.length === 0) {
        return okText(`No memories for ${entityId}`, { action: "esr_mem_timeline", entity_id: entityId, count: 0 });
      }

      const text = [
        `Timeline for ${entityId} (${store.countFor(entityId)} total, showing ${entries.length}):`,
        ...entries.map(o => formatObservation(o)),
      ].join("\n");

      return okText(text, { action: "esr_mem_timeline", entity_id: entityId, count: entries.length });
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
        store.journal(entityId, transition);
        return okText(`Recorded journal entry: ${entityId} ${transition}`, {
          action: "esr_mem_journal",
          entity_id: entityId,
          transition,
        });
      }

      if (params.entity_id) {
        const summary = buildJournalSummary(store, [String(params.entity_id)]);
        return okText(summary, {
          action: "esr_mem_journal",
          entity_id: params.entity_id,
        });
      } else {
        const entries = store.getAllJournal(30);
        const text = entries.length === 0
          ? "(no journal entries)"
          : entries.map(e => `[${e.entity_id}] ${e.created_at.slice(0, 16)}: ${e.transition}`).join("\n");
        return okText(text, { action: "esr_mem_journal", count: entries.length });
      }
    },
  });
}

export function onStateChange(store: MemoryStore, entityId: string, oldState: string, newState: string, label?: string, fingerprint?: string): void {
  recordStateChange(store, {
    entity_id: entityId,
    old_state: oldState,
    new_state: newState,
    label,
    fingerprint,
  });
}
