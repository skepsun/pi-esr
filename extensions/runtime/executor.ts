import { ESRGraph } from "../core/graph";
import { buildNodeCacheKey, InMemoryCacheStore } from "./cache";
import { ToolDriverRegistry } from "./drivers/tool-driver";
import { ESRRuntimeStateStore } from "./state";
import type { ExecutionNode, ExecutionResult } from "./runtime-types";

export interface ExecutorContext {
  graph: ESRGraph;
  store: ESRRuntimeStateStore;
  toolDriverRegistry: ToolDriverRegistry;
  cacheStore: InMemoryCacheStore;
}

/**
 * Execute a single node within its execution context.
 *
 * Flow:
 * 1. Build cache key — if cached, return immediately with cached status
 * 2. Dispatch to the registered tool driver
 * 3. On success, populate the cache with the node's outputs
 */
export async function executeNode(node: ExecutionNode, ctx: ExecutorContext): Promise<ExecutionResult> {
  const cacheKey = buildNodeCacheKey(node, ctx.graph, ctx.store);
  const cached = ctx.cacheStore.get(cacheKey);
  if (cached) {
    return {
      status: "cached",
      outputs: cached,
    };
  }

  if (node.kind !== "tool") {
    return { status: "blocked", error: `Unsupported node kind: ${node.kind}` };
  }

  const toolName = node.inputs.toolName;
  const params = node.inputs.params;
  if (typeof toolName !== "string" || !params || typeof params !== "object" || Array.isArray(params)) {
    return { status: "failed", error: "Tool execution node requires string toolName and object params" };
  }
  const result = await ctx.toolDriverRegistry.run(toolName, params as Record<string, unknown>, {
    graph: ctx.graph,
    store: ctx.store,
  });
  if (result.status === "succeeded" && result.outputs) {
    ctx.cacheStore.set(cacheKey, result.outputs);
  }
  return result;
}
