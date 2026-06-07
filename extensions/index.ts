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

/** Lazily initialised memory store — only loaded on first use. */
function getMemoryStore(): MemoryStore | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MemoryStore: Store } = require("./memory/store");
    return new Store();
  } catch {
    return null; // better-sqlite3 not installed — memory tools disabled
  }
}

let memoryStore: MemoryStore | null | undefined;

function ensureMemory(): MemoryStore | null {
  if (memoryStore === undefined) memoryStore = getMemoryStore();
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
    const mem = ensureMemory();
    if (mem) {
      const { buildMemoryPromptContext } = require("./memory/tools");
      fullPrompt += buildMemoryPromptContext(graph, mem);
    }

    return { systemPrompt: fullPrompt };
  });

  registerTools(pi, graph, runtimeStore, toolDriverRegistry, runtime);
  registerCommands(pi, graph, runtime, runtimeStore);

  // Register memory tools if better-sqlite3 is available
  const mem = ensureMemory();
  if (mem) {
    const { registerMemoryTools } = require("./memory/tools");
    registerMemoryTools(pi, mem);
  }
}
