import { ESRGraph } from "./graph.js";
import type { EntityState } from "./types.js";

export interface ESRClosurePolicy {
  require_artifact_for_stable: boolean;
  require_evaluation_for_stable: boolean;
  require_memory_ref_for_stable: boolean;
  require_constraints_satisfied_for_stable: boolean;
}

export interface ESRClosureStatus {
  task_id: string;
  task_exists: boolean;
  task_state?: EntityState;
  has_artifact: boolean;
  artifact_ids: string[];
  has_evaluation: boolean;
  evaluation_sources: string[];
  has_memory_ref: boolean;
  memory_ref_ids: string[];
  has_constraint: boolean;
  satisfied_constraints: string[];
  unsatisfied_constraints: string[];
  ready_for_stable: boolean;
  missing: string[];
}

export interface ESRClosureGapItem extends ESRClosureStatus {
  label?: string;
}

export interface ESRTaskListItem extends ESRClosureStatus {
  label?: string;
  confidence: number;
  updated_at: string;
}

const DEFAULT_POLICY: ESRClosurePolicy = {
  require_artifact_for_stable: true,
  require_evaluation_for_stable: true,
  require_memory_ref_for_stable: false,
  require_constraints_satisfied_for_stable: true,
};

export function getClosureStatus(
  graph: ESRGraph,
  taskId: string,
  opts?: {
    policy?: Partial<ESRClosurePolicy>;
  },
): ESRClosureStatus {
  const policy = { ...DEFAULT_POLICY, ...(opts?.policy ?? {}) };
  const task = graph.getEntity(taskId);
  const memoryRefs = graph.getMemoryRefs(taskId);

  if (!task) {
    return {
      task_id: taskId,
      task_exists: false,
      has_artifact: false,
      artifact_ids: [],
      has_evaluation: false,
      evaluation_sources: [],
      has_memory_ref: false,
      memory_ref_ids: [],
      has_constraint: false,
      satisfied_constraints: [],
      unsatisfied_constraints: [],
      ready_for_stable: false,
      missing: ["task"],
    };
  }

  const relations = graph.getRelationsFor(taskId);
  const artifacts = relations
    .filter((relation) => relation.from === taskId && relation.type === "produces")
    .map((relation) => relation.to)
    .filter((artifactId, index, list) => list.indexOf(artifactId) === index);
  const evaluators = relations
    .filter((relation) => relation.to === taskId && relation.type === "evaluates")
    .map((relation) => relation.from)
    .filter((source, index, list) => list.indexOf(source) === index);
  const constraints = relations
    .filter((relation) => relation.to === taskId && relation.type === "validates")
    .map((relation) => relation.from)
    .filter((constraintId, index, list) => list.indexOf(constraintId) === index);

  const satisfiedConstraints: string[] = [];
  const unsatisfiedConstraints: string[] = [];
  for (const constraintId of constraints) {
    const constraint = graph.getEntity(constraintId);
    if (constraint?.state === "stable") {
      satisfiedConstraints.push(constraintId);
    } else {
      unsatisfiedConstraints.push(constraintId);
    }
  }

  const memoryRefIds = memoryRefs.map((ref) => ref.ref_id);
  const missing: string[] = [];

  if (policy.require_artifact_for_stable && artifacts.length === 0) {
    missing.push("artifact");
  }
  if (policy.require_evaluation_for_stable && evaluators.length === 0) {
    missing.push("evaluation");
  }
  if (policy.require_memory_ref_for_stable && memoryRefIds.length === 0) {
    missing.push("memory_ref");
  }
  if (policy.require_constraints_satisfied_for_stable && unsatisfiedConstraints.length > 0) {
    missing.push("constraint");
  }

  return {
    task_id: taskId,
    task_exists: true,
    task_state: task.state,
    has_artifact: artifacts.length > 0,
    artifact_ids: artifacts,
    has_evaluation: evaluators.length > 0,
    evaluation_sources: evaluators,
    has_memory_ref: memoryRefIds.length > 0,
    memory_ref_ids: memoryRefIds,
    has_constraint: constraints.length > 0,
    satisfied_constraints: satisfiedConstraints,
    unsatisfied_constraints: unsatisfiedConstraints,
    ready_for_stable: missing.length === 0,
    missing,
  };
}

export function listClosureGaps(
  graph: ESRGraph,
  opts?: {
    policy?: Partial<ESRClosurePolicy>;
    includeReady?: boolean;
  },
): ESRClosureGapItem[] {
  const includeReady = opts?.includeReady ?? false;

  return graph.getAllEntities()
    .filter((entity) => entity.role === "Task")
    .map((entity) => {
      const status = getClosureStatus(graph, entity.entity_id, {
        policy: opts?.policy,
      });
      return {
        ...status,
        label: entity.label,
      };
    })
    .filter((status) => includeReady || !status.ready_for_stable)
    .sort((left, right) => {
      if (left.missing.length !== right.missing.length) {
        return right.missing.length - left.missing.length;
      }
      return left.task_id.localeCompare(right.task_id);
    });
}

export function listTasks(
  graph: ESRGraph,
  opts?: {
    state?: EntityState;
    includeReady?: boolean;
    policy?: Partial<ESRClosurePolicy>;
  },
): ESRTaskListItem[] {
  const includeReady = opts?.includeReady ?? true;

  return graph.getAllEntities()
    .filter((entity) => entity.role === "Task")
    .filter((entity) => !opts?.state || entity.state === opts.state)
    .map((entity) => {
      const status = getClosureStatus(graph, entity.entity_id, {
        policy: opts?.policy,
      });
      return {
        ...status,
        label: entity.label,
        confidence: entity.confidence,
        updated_at: entity.updated_at,
      };
    })
    .filter((item) => includeReady || !item.ready_for_stable)
    .sort((left, right) => {
      const stateRank = compareTaskState(left.task_state, right.task_state);
      if (stateRank !== 0) return stateRank;
      if (left.ready_for_stable !== right.ready_for_stable) {
        return left.ready_for_stable ? 1 : -1;
      }
      return left.task_id.localeCompare(right.task_id);
    });
}

function compareTaskState(left?: EntityState, right?: EntityState): number {
  const order: EntityState[] = ["active", "blocked", "draft", "stable", "deprecated"];
  return order.indexOf(left ?? "draft") - order.indexOf(right ?? "draft");
}
