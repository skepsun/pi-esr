/**
 * pi-esr: Engineering State Runtime Plugin for Pi Agent
 *
 * A constrained semantic graph state machine for engineering,
 * documentation, and decision intelligence tasks. Includes an optional
 * entity-anchored memory layer (esr_mem_* tools) for tracking per-entity
 * observations and state transitions.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ESRGraph } from "./core/graph";
import { registerCommands } from "./integration/commands";
import { registerTools } from "./integration/tools";
import { reconstructRuntimeCache } from "./persistence/runtime-cache";
import { reconstructGraph } from "./persistence/reconstruct";
import { persistRuntimeCache } from "./persistence/runtime-cache";
import { persistRuntimeState } from "./persistence/runtime-state";
import { reconstructRuntimeState } from "./persistence/runtime-state";
import { buildPromptContext } from "./prompt";
import { InMemoryCacheStore } from "./runtime/cache";
import { ToolDriverRegistry } from "./runtime/drivers/tool-driver";
import { ESRRuntime } from "./runtime/runtime";
import { ESRRuntimeStateStore } from "./runtime/state";
import type { MemoryStore } from "./memory/store";

/** Lazily initialised memory store — only loaded on first use via dynamic import. */
async function getMemoryStore(): Promise<MemoryStore | null> {
  try {
    const { MemoryStore: Store } = await import("./memory/store");
    return new Store();
  } catch {
    return null; // better-sqlite3 not installed — memory tools disabled
  }
}

let memoryStore: MemoryStore | null | undefined;

async function ensureMemory(): Promise<MemoryStore | null> {
  if (memoryStore === undefined) memoryStore = await getMemoryStore();
  return memoryStore;
}

export default function (pi: ExtensionAPI) {
  const graph = new ESRGraph();
  const runtimeStore = new ESRRuntimeStateStore();
  const toolDriverRegistry = new ToolDriverRegistry();
  const runtimeCache = new InMemoryCacheStore();
  const runtime = new ESRRuntime(graph, runtimeStore, toolDriverRegistry, runtimeCache, () => {
    persistRuntimeState(pi, runtimeStore);
    persistRuntimeCache(pi, runtimeCache);
  });

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    reconstructGraph(ctx, graph);
    reconstructRuntimeState(ctx, runtimeStore);
    reconstructRuntimeCache(ctx, runtimeCache);
  });
  pi.on("session_tree", async (_event, ctx: ExtensionContext) => {
    reconstructGraph(ctx, graph);
    reconstructRuntimeState(ctx, runtimeStore);
    reconstructRuntimeCache(ctx, runtimeCache);
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    const corePrompt = buildPromptContext(graph, runtimeStore);
    let fullPrompt = event.systemPrompt + corePrompt;

    // Inject entity memory block if the memory layer is available
    const mem = await ensureMemory();
    if (mem) {
      const { buildMemoryPromptContext } = await import("./memory/tools");
      fullPrompt += buildMemoryPromptContext(graph, mem);
    }

    return { systemPrompt: fullPrompt };
  });

  registerTools(pi, graph, runtimeStore, toolDriverRegistry, runtime);
  registerCommands(pi, graph, runtime, runtimeStore);

  // Auto-journal: wire state change hook so every entity state transition
  // is recorded in the journal and as a memory observation — no manual
  // esr_mem_journal calls needed for standard state changes.
  void (async () => {
    const mem = await ensureMemory();
    if (mem) {
      graph.setStateChangeHook((entityId, oldState, newState, label) => {
        const transition = `${oldState} → ${newState}`;
        mem.journal(entityId, transition);
        const desc = label ? ` ${label}` : "";
        mem.store(entityId, `${transition}${desc}`, {
          tags: ["state-transition", `from:${oldState}`, `to:${newState}`],
        });
        // When a task reaches stable, also store a completion observation
        if (newState === "stable") {
          const entity = graph.getEntity(entityId);
          if (entity?.role === "Task") {
            const metrics = Object.entries(entity.metrics)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ");
            mem.store(entityId, `Task completed: ${entity.label ?? entityId}${metrics ? ` (${metrics})` : ""}`, {
              tags: ["task-completed", "stable"],
            });
          }
        }
      });

      const { registerMemoryTools } = await import("./memory/tools");
      registerMemoryTools(pi, mem);
    }
  })();
}
