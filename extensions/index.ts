/**
 * pi-esr: Engineering State Runtime Plugin for Pi Agent
 *
 * A constrained semantic graph state machine for engineering,
 * documentation, and decision intelligence tasks.
 *
 * NOT a memory system. NOT a chat history system. NOT a retrieval-only system.
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
    return {
      systemPrompt: event.systemPrompt + buildPromptContext(graph, runtimeStore),
    };
  });

  registerTools(pi, graph, runtimeStore, toolDriverRegistry, runtime);
  registerCommands(pi, graph, runtime, runtimeStore);
}
