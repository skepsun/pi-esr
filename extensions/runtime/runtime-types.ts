export type ExecutionNodeKind = "tool";

export type ExecutionStatus =
  | "pending"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cached";

export interface ExecutionNode {
  node_id: string;
  task_entity_id: string;
  kind: ExecutionNodeKind;
  state: ExecutionStatus;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  dependencies: string[];
  retry_count: number;
  max_retries: number;
  cache_key?: string;
  driver_version?: string;
  last_error?: string;
  updated_at: string;
}

export type RuntimeEvent =
  | { type: "node_created"; node_id: string; at: string }
  | { type: "node_invalidated"; node_id: string; at: string; reason: string }
  | { type: "node_ready"; node_id: string; at: string }
  | { type: "node_started"; node_id: string; at: string }
  | { type: "node_succeeded"; node_id: string; at: string; outputs: Record<string, unknown> }
  | { type: "node_failed"; node_id: string; at: string; error: string }
  | { type: "node_blocked"; node_id: string; at: string; reason: string }
  | { type: "cache_hit"; node_id: string; at: string; cache_key: string }
  | { type: "cache_miss"; node_id: string; at: string; cache_key: string };

export interface RuntimeState {
  executionNodes: ExecutionNode[];
  events: RuntimeEvent[];
  version: number;
}

export interface RuntimePersistedState extends RuntimeState {}

export interface PlanResult {
  ready: ExecutionNode[];
  waiting: ExecutionNode[];
  blocked: ExecutionNode[];
}

export interface ExecutionResult {
  status: "succeeded" | "failed" | "blocked" | "cached";
  outputs?: Record<string, unknown>;
  error?: string;
}

export interface RuntimeTickResult {
  status: "idle" | "executed" | "cached" | "failed" | "blocked";
  selectedNodeId?: string;
}
