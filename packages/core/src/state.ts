import type { ExecutionNode, ExecutionStatus, RuntimeEvent, RuntimePersistedState, RuntimeState } from "./runtime-types.js";

function cloneNode(node: ExecutionNode): ExecutionNode {
  return {
    ...node,
    inputs: { ...node.inputs },
    outputs: { ...node.outputs },
    dependencies: [...node.dependencies],
  };
}

/**
 * Runtime state store for execution nodes and events.
 *
 * Manages the lifecycle of ExecutionNode records:
 * - createNode → pending
 * - setNodeState → transitions between execution states
 * - invalidateDependentNodes → resets completed dependent nodes on graph mutation
 *
 * All reads return defensive copies.
 */
export class ESRRuntimeStateStore {
  private nodes = new Map<string, ExecutionNode>();
  private events: RuntimeEvent[] = [];
  private version = 0;

  /** Create a new execution node. Returns a defensive copy. */
  createNode(node: Omit<ExecutionNode, "updated_at"> & { updated_at?: string }): ExecutionNode {
    const created: ExecutionNode = {
      ...node,
      updated_at: node.updated_at ?? new Date().toISOString(),
      inputs: { ...node.inputs },
      outputs: { ...node.outputs },
      dependencies: [...node.dependencies],
    };
    this.nodes.set(created.node_id, created);
    this.version++;
    this.appendEvent({ type: "node_created", node_id: created.node_id, at: created.updated_at });
    return cloneNode(created);
  }

  /** Return a defensive copy of the node, or undefined. */
  getNode(nodeId: string): ExecutionNode | undefined {
    const node = this.nodes.get(nodeId);
    return node ? cloneNode(node) : undefined;
  }

  /** Return defensive copies of all nodes. */
  getNodes(): ExecutionNode[] {
    return Array.from(this.nodes.values()).map(cloneNode);
  }

  /** Patch a node's properties and bump its updated_at timestamp. */
  updateNode(nodeId: string, patch: Partial<Omit<ExecutionNode, "node_id">>): ExecutionNode | undefined {
    const current = this.nodes.get(nodeId);
    if (!current) return undefined;
    const next: ExecutionNode = {
      ...current,
      ...patch,
      inputs: patch.inputs ? { ...patch.inputs } : current.inputs,
      outputs: patch.outputs ? { ...patch.outputs } : current.outputs,
      dependencies: patch.dependencies ? [...patch.dependencies] : current.dependencies,
      updated_at: new Date().toISOString(),
    };
    this.nodes.set(nodeId, next);
    this.version++;
    return cloneNode(next);
  }

  /** Transition a node to a new execution state with optional extra fields. */
  setNodeState(nodeId: string, state: ExecutionStatus, extra: Partial<ExecutionNode> = {}): ExecutionNode | undefined {
    return this.updateNode(nodeId, { ...extra, state });
  }

  /** Mark all completed dependent nodes as stale and reset to pending.
   *  This is deliberately broad (invalidates ALL nodes with dependencies)
   *  rather than targeting only transitively-affected nodes. The cache
   *  layer in executor.ts compensates: unchanged inputs will produce the
   *  same SHA256 cache key, so re-execution is skipped and the node
   *  transitions directly to `cached` state. */
  invalidateDependentNodes(reason: string): ExecutionNode[] {
    const invalidated: ExecutionNode[] = [];
    const activeStates: ExecutionStatus[] = ["succeeded", "cached", "failed", "blocked", "running"];
    for (const node of this.nodes.values()) {
      if (node.dependencies.length === 0) continue;
      if (!activeStates.includes(node.state)) continue;
      const next = this.updateNode(node.node_id, {
        state: "pending",
        outputs: {},
        last_error: undefined,
        cache_key: undefined,
        retry_count: 0,
      });
      if (next) {
        const event = {
          type: "node_invalidated" as const,
          node_id: next.node_id,
          at: next.updated_at,
          reason,
        };
        this.appendEvent(event);
        invalidated.push(next);
      }
    }
    return invalidated;
  }

  appendEvent(event: RuntimeEvent): void {
    this.events.push(event);
    this.version++;
  }

  /** Return all recorded runtime events. */
  getEvents(): RuntimeEvent[] {
    return [...this.events];
  }

  /** Return the current full runtime state snapshot. */
  getState(): RuntimeState {
    return {
      executionNodes: this.getNodes(),
      events: this.getEvents(),
      version: this.version,
    };
  }

  /** Serialize for persistence. */
  toPersistedState(): RuntimePersistedState {
    return this.getState();
  }

  /** Load state from a previously persisted snapshot. Replaces all current state. */
  loadFromState(state: RuntimePersistedState): void {
    this.nodes.clear();
    this.events = [];
    for (const node of state.executionNodes) {
      this.nodes.set(node.node_id, cloneNode(node));
    }
    this.events = [...state.events];
    this.version = state.version;
  }

  /** Reset the store to an empty state. */
  clear(): void {
    this.nodes.clear();
    this.events = [];
    this.version = 0;
  }
}
