import { ESRRuntimeStateStore } from "./state";
import type { ExecutionNode, PlanResult } from "./runtime-types";

function hasFailedDependency(node: ExecutionNode, nodes: Map<string, ExecutionNode>): boolean {
  return node.dependencies.some(depId => {
    const dep = nodes.get(depId);
    return dep !== undefined && (dep.state === "failed" || dep.state === "blocked");
  });
}

function hasSatisfiedDependencies(node: ExecutionNode, nodes: Map<string, ExecutionNode>): boolean {
  return node.dependencies.every(depId => {
    const dep = nodes.get(depId);
    return dep !== undefined && (dep.state === "succeeded" || dep.state === "cached");
  });
}

/**
 * Compute the DAG execution plan: which nodes are ready, waiting, or blocked.
 *
 * - `ready`: pending/ready nodes with all dependencies satisfied (succeeded/cached)
 * - `waiting`: pending/ready nodes with incomplete dependencies
 * - `blocked`: pending/ready nodes with at least one failed/blocked dependency
 */
export function computeRunnableNodes(store: ESRRuntimeStateStore): PlanResult {
  const allNodes = store.getNodes().sort((a, b) => a.node_id.localeCompare(b.node_id));
  const nodeMap = new Map(allNodes.map(node => [node.node_id, node]));
  const ready: ExecutionNode[] = [];
  const waiting: ExecutionNode[] = [];
  const blocked: ExecutionNode[] = [];

  for (const node of allNodes) {
    if (node.state !== "pending" && node.state !== "ready") continue;
    if (hasFailedDependency(node, nodeMap)) {
      blocked.push(node);
      continue;
    }
    if (node.dependencies.length === 0 || hasSatisfiedDependencies(node, nodeMap)) {
      ready.push(node);
      continue;
    }
    waiting.push(node);
  }

  return { ready, waiting, blocked };
}
