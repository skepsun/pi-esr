import type { ExecutionNode, PlanResult } from "./runtime-types.js";

/**
 * Select the next node to execute from a plan.
 * Prefers nodes with fewer dependencies (closer to leaf in the DAG),
 * breaking ties by node_id alphabetical order.
 */
export function selectNextNode(plan: PlanResult): ExecutionNode | null {
  if (plan.ready.length === 0) return null;
  return [...plan.ready].sort((a, b) => {
    if (a.dependencies.length !== b.dependencies.length) {
      return a.dependencies.length - b.dependencies.length;
    }
    return a.node_id.localeCompare(b.node_id);
  })[0];
}
