/**
 * pi-esr: Engineering State Runtime Plugin for Pi Agent
 *
 * Pi adapter — imports the framework-agnostic @pi-esr/core engine
 * and wires it to pi's extension API (tools, commands, persistence, prompts).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ESRGraph,
  ESRRuntime,
  ESRRuntimeStateStore,
  ToolDriverRegistry,
  InMemoryCacheStore,
  setCurrentSessionId,
  getCurrentSessionId,
} from "@pi-esr/core";
import type { MemoryStore } from "@pi-esr/core";
import { registerCommands, setMemoryStoreForCommands } from "./integration/commands";
import { registerTools } from "./integration/tools";
import { reconstructGraph } from "./persistence/reconstruct";
import { persistRuntimeCache } from "./persistence/runtime-cache";
import { persistRuntimeState } from "./persistence/runtime-state";
import { reconstructRuntimeState } from "./persistence/runtime-state";
import { reconstructRuntimeCache } from "./persistence/runtime-cache";
import { buildStaticPrompt } from "./prompt";

async function getMemoryStore(): Promise<MemoryStore | null> {
  try {
    const { MemoryStore: Store } = await import("@pi-esr/core");
    return new Store();
  } catch {
    return null;
  }
}

function captureSessionId(ctx: ExtensionContext): void {
  try {
    setCurrentSessionId(ctx.sessionManager.getSessionId());
  } catch {
    setCurrentSessionId(null);
  }
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

  // ── Event handlers ────────────────────────────────────

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    captureSessionId(ctx);
    await reconstructGraph(ctx, graph);
    reconstructRuntimeState(ctx, runtimeStore);
    reconstructRuntimeCache(ctx, runtimeCache);
  });

  pi.on("session_tree", async (_event, ctx: ExtensionContext) => {
    captureSessionId(ctx);
    await reconstructGraph(ctx, graph);
    reconstructRuntimeState(ctx, runtimeStore);
    reconstructRuntimeCache(ctx, runtimeCache);
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    // Only inject STATIC methodology (ontology, rules, protocol).
    // Dynamic state (entities, relations, tasks, memories) is fetched
    // on-demand via esr_get_context to preserve prompt-cache stability.
    const staticPrompt = buildStaticPrompt();
    return { systemPrompt: event.systemPrompt + staticPrompt };
  });

  // ── Tools & commands ──────────────────────────────────

  registerTools(pi, graph, runtimeStore, toolDriverRegistry, runtime);
  registerCommands(pi, graph, runtime, runtimeStore);

  // ── Auto-journal (memory) ─────────────────────────────

  getMemoryStore().then(async (mem) => {
    setMemoryStoreForCommands(mem);
    if (!mem) return;
    try {
      graph.setStateChangeHook((entityId, oldState, newState, label) => {
        const transition = `${oldState} → ${newState}`;
        const sessionId = getCurrentSessionId();
        const sessionTag = sessionId ? `session:${sessionId}` : null;
        const baseTags = sessionTag
          ? ["state-transition", `from:${oldState}`, `to:${newState}`, sessionTag]
          : ["state-transition", `from:${oldState}`, `to:${newState}`];

        mem.journal(entityId, transition);
        const desc = label ? ` ${label}` : "";
        mem.store(entityId, `${transition}${desc}`, { tags: baseTags });
        if (newState === "stable") {
          const entity = graph.getEntity(entityId);
          if (entity?.role === "Task") {
            const metrics = Object.entries(entity.metrics)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ");
            const completeTags = sessionTag
              ? ["task-completed", "stable", sessionTag]
              : ["task-completed", "stable"];
            mem.store(entityId, `Task completed: ${entity.label ?? entityId}${metrics ? ` (${metrics})` : ""}`, {
              tags: completeTags,
            });
          }
        }
      });

      const { registerMemoryTools } = await import("./memory/tools");
      registerMemoryTools(pi, mem);
    } catch (err) {
      console.error("[pi-esr] Memory layer init failed:", err);
    }
  });
}
