import { ESRGraph } from "../core/graph";
import { InMemoryCacheStore } from "./cache";
import { ToolDriverRegistry } from "./drivers/tool-driver";
import { executeNode } from "./executor";
import { computeRunnableNodes } from "./planner";
import { selectNextNode } from "./scheduler";
import { ESRRuntimeStateStore } from "./state";
import type { RuntimeTickResult, ExecutionResult } from "./runtime-types";

/**
 * ESR runtime engine — orchestrates multi-step DAG execution.
 *
 * Each tick:
 * 1. Computes runnable nodes via {@link computeRunnableNodes}
 * 2. Marks blocked nodes
 * 3. Selects and executes the next node via {@link selectNextNode}
 * 4. Records the result and flushes persistence
 */
export class ESRRuntime {
  constructor(
    private readonly graph: ESRGraph,
    private readonly store: ESRRuntimeStateStore,
    private readonly toolDriverRegistry: ToolDriverRegistry,
    private readonly cacheStore = new InMemoryCacheStore(),
    private readonly onMutation?: () => void,
  ) {}

  private flush(): void {
    this.onMutation?.();
  }

  getStateStore(): ESRRuntimeStateStore {
    return this.store;
  }

  getCacheStore(): InMemoryCacheStore {
    return this.cacheStore;
  }

  /** Run a single execution tick. Returns idle if no ready nodes exist. */
  async tick(): Promise<RuntimeTickResult> {
    const plan = computeRunnableNodes(this.store);
    for (const node of plan.blocked) {
      if (node.state !== "blocked") {
        this.store.setNodeState(node.node_id, "blocked", {
          last_error: "Blocked by failed or blocked dependency",
        });
        this.store.appendEvent({
          type: "node_blocked",
          node_id: node.node_id,
          at: new Date().toISOString(),
          reason: "Blocked by failed or blocked dependency",
        });
        this.flush();
      }
    }

    const nextNode = selectNextNode(plan);
    if (!nextNode) return { status: "idle" };

    this.store.setNodeState(nextNode.node_id, "running");
    this.store.appendEvent({ type: "node_started", node_id: nextNode.node_id, at: new Date().toISOString() });
    this.flush();

    const result = await executeNode(nextNode, {
      graph: this.graph,
      store: this.store,
      toolDriverRegistry: this.toolDriverRegistry,
      cacheStore: this.cacheStore,
    }).catch((err): ExecutionResult => {
      const message = err instanceof Error ? err.message : String(err);
      this.store.appendEvent({
        type: "node_failed", node_id: nextNode.node_id,
        at: new Date().toISOString(), error: message,
      });
      return { status: "failed", error: message };
    });

    if (result.status === "cached") {
      const node = this.store.setNodeState(nextNode.node_id, "cached", {
        outputs: result.outputs ?? {},
      });
      this.store.appendEvent({
        type: "cache_hit",
        node_id: nextNode.node_id,
        at: new Date().toISOString(),
        cache_key: node?.cache_key ?? "runtime-cache-hit",
      });
      this.flush();
      return { status: "cached", selectedNodeId: nextNode.node_id };
    }

    if (result.status === "succeeded") {
      this.store.setNodeState(nextNode.node_id, "succeeded", {
        outputs: result.outputs ?? {},
        last_error: undefined,
      });
      this.store.appendEvent({
        type: "node_succeeded",
        node_id: nextNode.node_id,
        at: new Date().toISOString(),
        outputs: result.outputs ?? {},
      });
      this.flush();
      return { status: "executed", selectedNodeId: nextNode.node_id };
    }

    if (result.status === "blocked") {
      this.store.setNodeState(nextNode.node_id, "blocked", {
        last_error: result.error,
      });
      this.store.appendEvent({
        type: "node_blocked",
        node_id: nextNode.node_id,
        at: new Date().toISOString(),
        reason: result.error ?? "Unknown blocking reason",
      });
      this.flush();
      return { status: "blocked", selectedNodeId: nextNode.node_id };
    }

    this.store.setNodeState(nextNode.node_id, "failed", {
      last_error: result.error,
    });
    this.store.appendEvent({
      type: "node_failed",
      node_id: nextNode.node_id,
      at: new Date().toISOString(),
      error: result.error ?? "Unknown error",
    });
    this.flush();
    return { status: "failed", selectedNodeId: nextNode.node_id };
  }

  /**
   * Run ticks until idle, or until maxSteps is reached.
   * Stops early on idle or when the last tick resulted in failure/blocked.
   */
  async runUntilIdle(maxSteps = 100): Promise<RuntimeTickResult[]> {
    const results: RuntimeTickResult[] = [];
    for (let i = 0; i < maxSteps; i++) {
      const result = await this.tick();
      results.push(result);
      if (result.status === "idle" || result.status === "failed" || result.status === "blocked") break;
    }
    return results;
  }
}

/** Build a compact, cache-stable runtime node summary for LLM context injection. */
/**
 * Build a compact, cache-stable runtime node summary for LLM context injection.
 * Nodes are sorted by node_id for deterministic output.
 */
export function buildRuntimeContext(store: ESRRuntimeStateStore): string {
  const nodes = store.getNodes().sort((a, b) => a.node_id.localeCompare(b.node_id));
  if (nodes.length === 0) return "";

  const lines: string[] = ["RUNTIME NODES:"];
  for (const n of nodes) {
    const deps = n.dependencies.length > 0 ? n.dependencies.join(", ") : "none";
    const err = n.last_error ? ` err=${n.last_error.slice(0, 40)}` : "";
    lines.push(`  ${n.node_id} [${n.kind}] task=${n.task_entity_id} state=${n.state} deps=${deps}${err}`);
  }
  return lines.join("\n");
}
