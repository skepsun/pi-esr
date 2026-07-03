/**
 * esr-overlay selectors — pure functions that project ESRGraph state
 * into overlay-compatible data shapes, preserving graph structure.
 *
 * Design:
 * - Each Task is a root node
 * - Its immediate neighbors (constraints, artifacts, blocked-by deps, evaluators)
 *   are shown as children indented under it
 * - Non-Task entities with no Task parent are shown as orphan row at the bottom
 * - Smart truncation: active tasks first, then blocked, then draft, stable drops first
 *
 * Pattern borrowed from rpiv-todo's state/selectors.ts:
 * - selectOverlayLayout: budget-aware collapse with summary row
 * - selectCounts: heading counts
 */

import type { ESRGraph } from "../../packages/core/src/graph.js";
import { getClosureStatus } from "../../packages/core/src/closure.js";
import type { ESRRelation, ESREntity, EntityState, EntityRole } from "../../packages/core/src/types.js";

// ═══════════════════════════════════════════════════════════
// Projected overlay node types
// ═══════════════════════════════════════════════════════════

/** A node in the overlay tree — either a task root or a child relation row */
export interface OverlayNode {
  /** Unique key for stable identity across renders */
  key: string;
  /** Display label */
  label: string;
  /** Entity state (or empty for relation-only rows) */
  state: EntityState;
  /** Entity role (or 'relation' for pure relation rows) */
  role: EntityRole | "relation";
  /** Confidence 0-1 */
  confidence: number;
  /** Indent level: 0 = root task, 1 = direct child */
  indent: number;
  /** Relation type label when indent > 0 (e.g. "validates", "produces", "blocks") */
  relationLabel?: string;
  /** Target entity ID for relation child rows */
  entityId?: string;
  /** For tasks: is closure-ready */
  isReadyForStable?: boolean;
  /** For tasks: what's missing for closure */
  missingClosure?: string[];
}

export interface OverlayState {
  /** All overlay nodes in display order, with indentation */
  nodes: OverlayNode[];
  /** Entity counts by role */
  roleCounts: Map<EntityRole, number>;
  /** Raw entity count */
  totalEntities: number;
}

// ═══════════════════════════════════════════════════════════
// Priority ordering
// ═══════════════════════════════════════════════════════════

const DISPLAY_ORDER: EntityState[] = ["active", "blocked", "draft", "stable", "deprecated"];

function stateRank(state: EntityState): number {
  const idx = DISPLAY_ORDER.indexOf(state);
  return idx === -1 ? 99 : idx;
}

// ═══════════════════════════════════════════════════════════
// Relation → compact label
// ═══════════════════════════════════════════════════════════

const REL_LABEL: Record<string, { prefix: string; icon: string }> = {
  validates:   { prefix: "val", icon: "⚡" },
  produces:    { prefix: "→",  icon: "📄" },
  depends_on:  { prefix: "⛓", icon: "⛓" },
  evaluates:   { prefix: "ev", icon: "◆" },
  refines:     { prefix: "rf", icon: "↳" },
  implements:  { prefix: "im", icon: "⌂" },
  blocks:      { prefix: "bl", icon: "⊘" },
  supports:    { prefix: "sp", icon: "✓" },
  part_of:     { prefix: "⊂",  icon: "⊂" },
  triggers:    { prefix: "tr", icon: "▶" },
  updates:     { prefix: "up", icon: "⇡" },
  contradicts: { prefix: "ct", icon: "✗" },
  scores:      { prefix: "sc", icon: "#" },
};

function relLabel(type: string): { prefix: string; icon: string } {
  return REL_LABEL[type] ?? { prefix: type.slice(0, 3), icon: "·" };
}

// ═══════════════════════════════════════════════════════════
// Main selector: build the overlay tree from the graph
// ═══════════════════════════════════════════════════════════

/**
 * Project the graph into an overlay tree.
 *
 * Algorithm:
 * 1. Each Task is a root node
 * 2. Children = non-Task entities linked via validates/produces/evaluates/refines/blocks
 * 3. Task-to-task relations (depends_on, refines, blocks) shown as inline annotations
 * 4. Sort tasks by state priority
 * 5. Orphan non-Task entities at the bottom
 */
export function selectOverlayState(graph: ESRGraph): OverlayState {
  const allEntities = graph.getAllEntities();
  const relations = graph.getAllRelations();

  // Index entities by id
  const entityMap = new Map<string, ESREntity>();
  for (const e of allEntities) entityMap.set(e.entity_id, e);

  // Role counts
  const roleCounts = new Map<EntityRole, number>();
  for (const e of allEntities) {
    roleCounts.set(e.role, (roleCounts.get(e.role) ?? 0) + 1);
  }

  // Separate tasks from non-tasks
  const tasks = allEntities.filter(e => e.role === "Task");
  const nonTasks = allEntities.filter(e => e.role !== "Task");

  // Build relation index by task; task-to-task relations collected for inline annotations
  const taskChildren = new Map<string, ESRRelation[]>();
  const taskToTaskEdges = new Map<string, { type: string; targetId: string; direction: 'out' | 'in' }[]>();
  const linkedNonTaskIds = new Set<string>();

  for (const r of relations) {
    const fromRole = entityMap.get(r.from)?.role;
    const toRole = entityMap.get(r.to)?.role;

    // Task-to-task: collect for inline annotation
    if (fromRole === "Task" && toRole === "Task") {
      const edge = { type: r.type, targetId: r.to, direction: 'out' as const };
      const list = taskToTaskEdges.get(r.from) ?? [];
      list.push(edge);
      taskToTaskEdges.set(r.from, list);
      if (r.type === "depends_on" || r.type === "blocks") {
        const rev = { type: r.type, targetId: r.from, direction: 'in' as const };
        const revList = taskToTaskEdges.get(r.to) ?? [];
        revList.push(rev);
        taskToTaskEdges.set(r.to, revList);
      }
      continue;
    }

    // Task → non-Task (child) or non-Task → Task (incoming child)
    if (fromRole === "Task" && toRole !== "Task") {
      const list = taskChildren.get(r.from) ?? [];
      list.push(r);
      taskChildren.set(r.from, list);
      linkedNonTaskIds.add(r.to);
    }
    if (toRole === "Task" && fromRole !== "Task") {
      const list = taskChildren.get(r.to) ?? [];
      list.push(r);
      taskChildren.set(r.to, list);
      linkedNonTaskIds.add(r.from);
    }
  }

  const nodes: OverlayNode[] = [];

  // Helper: create a relation child node
  function makeRelChild(
    taskId: string,
    rel: ESRRelation,
    direction: "out" | "in",
  ): OverlayNode {
    const targetId = direction === "out" ? rel.to : rel.from;
    const target = entityMap.get(targetId);
    const rl = relLabel(rel.type);
    const targetLabel = target?.label ?? targetId;

    return {
      key: `${taskId}:${rel.type}:${targetId}:${direction}`,
      label: targetLabel,
      state: target?.state ?? "draft",
      role: target?.role ?? "Concept",
      confidence: target?.confidence ?? 0,
      indent: 1,
      relationLabel: direction === "out" ? rl.prefix : `←${rl.prefix}`,
      entityId: targetId,
    };
  }

  // Build nodes for each task, sorted by state priority
  for (const task of tasks.sort((a, b) => {
    const r = stateRank(a.state) - stateRank(b.state);
    return r !== 0 ? r : a.entity_id.localeCompare(b.entity_id);
  })) {
    const closure = getClosureStatus(graph, task.entity_id);

    // Task root node
    nodes.push({
      key: task.entity_id,
      label: task.label ?? task.entity_id,
      state: task.state,
      role: "Task",
      confidence: task.confidence,
      indent: 0,
      entityId: task.entity_id,
      isReadyForStable: closure.ready_for_stable,
      missingClosure: closure.missing,
    });

    // Children: non-Task relations sorted by type priority
    const children = taskChildren.get(task.entity_id) ?? [];
    const relPriority: Record<string, number> = {
      validates: 1, produces: 2, depends_on: 3, blocks: 4,
      evaluates: 5, refines: 6, implements: 7, part_of: 8,
      supports: 9, contradicts: 10, triggers: 11, updates: 12, scores: 13,
    };

    const sortedChildren = children.sort((a, b) => {
      const pa = a.from === task.entity_id
        ? (relPriority[a.type] ?? 99)
        : (relPriority[a.type] ?? 99) + 100;
      const pb = b.from === task.entity_id
        ? (relPriority[b.type] ?? 99)
        : (relPriority[b.type] ?? 99) + 100;
      return pa - pb;
    });

    for (const rel of sortedChildren) {
      if (rel.from === task.entity_id) {
        nodes.push(makeRelChild(task.entity_id, rel, "out"));
      } else if (rel.to === task.entity_id) {
        nodes.push(makeRelChild(task.entity_id, rel, "in"));
      }
    }
  }

  // Orphan non-task entities (not linked to any task)
  for (const entity of nonTasks) {
    if (!linkedNonTaskIds.has(entity.entity_id)) {
      nodes.push({
        key: `orphan:${entity.entity_id}`,
        label: entity.label ?? entity.entity_id,
        state: entity.state,
        role: entity.role,
        confidence: entity.confidence,
        indent: 0,
        entityId: entity.entity_id,
      });
    }
  }

  return { nodes, roleCounts, totalEntities: allEntities.length };
}

// ═══════════════════════════════════════════════════════════
// Counts for heading
// ═══════════════════════════════════════════════════════════

export interface ESRCounts {
  task: number;
  active: number;   // active tasks
  blocked: number;  // blocked tasks
  artifact: number;
  constraint: number;
  concept: number;
  total: number;    // total entities
}

export function selectCounts(graph: ESRGraph): ESRCounts {
  const entities = graph.getAllEntities();
  let task = 0, active = 0, blocked = 0, artifact = 0, constraint = 0, concept = 0;
  for (const e of entities) {
    switch (e.role) {
      case "Task": task++; if (e.state === "active") active++; if (e.state === "blocked") blocked++; break;
      case "Artifact": artifact++; break;
      case "Constraint": constraint++; break;
      case "Concept": concept++; break;
    }
  }
  return { task, active, blocked, artifact, constraint, concept, total: entities.length };
}

/**
 * Whether any visible node is non-stable (for heading icon).
 */
export function selectHasActive(state: OverlayState): boolean {
  return state.nodes.some(
    n => n.indent === 0 && (n.state === "active" || n.state === "blocked" || n.state === "draft"),
  );
}

// ═══════════════════════════════════════════════════════════
// Layout selector — smart truncation with tree awareness
// ═══════════════════════════════════════════════════════════

export interface OverlayLayout {
  /** Visible nodes to render */
  visible: OverlayNode[];
  /** Count of stable-task subtrees hidden */
  hiddenStableTasks: number;
  /** Count of draft task subtrees truncated */
  truncatedDraftTasks: number;
  /** Count of child nodes truncated */
  truncatedChildren: number;
  /** Total nodes hidden */
  totalHidden: number;
}

/**
 * Compute which nodes to show within a line budget.
 *
 * Rules:
 * 1. Never break a task's subtree mid-way — either show it fully or collapse to summary
 * 2. Active tasks have highest priority (show full subtree)
 * 3. Blocked tasks next priority
 * 4. Draft tasks can be trimmed
 * 5. Stable tasks collapse first on overflow
 * 6. Reserve 1 slot for summary row when over budget
 */
export function selectOverlayLayout(state: OverlayState, budget: number): OverlayLayout {
  // Group nodes into task-subtrees
  interface Subtree {
    taskKey: string;
    taskState: EntityState;
    nodes: OverlayNode[];   // task node + all its children
    size: number;
  }

  const subtrees: Subtree[] = [];
  let current: Subtree | null = null;

  for (const node of state.nodes) {
    if (node.indent === 0) {
      if (current) subtrees.push(current);
      current = { taskKey: node.key, taskState: node.state, nodes: [node], size: 1 };
    } else if (current) {
      current.nodes.push(node);
      current.size++;
    }
  }
  if (current) subtrees.push(current);

  if (subtrees.length === 0) return { visible: [], hiddenStableTasks: 0, truncatedDraftTasks: 0, truncatedChildren: 0, totalHidden: 0 };

  // Total visible nodes = sum of subtree sizes
  const totalNodes = subtrees.reduce((sum, s) => sum + s.size, 0);

  if (totalNodes <= budget) {
    return {
      visible: state.nodes,
      hiddenStableTasks: 0,
      truncatedDraftTasks: 0,
      truncatedChildren: 0,
      totalHidden: 0,
    };
  }

  const innerBudget = budget - 1; // reserve 1 for summary

  // Separate by priority
  const activeSubtrees = subtrees.filter(s => s.taskState === "active");
  const blockedSubtrees = subtrees.filter(s => s.taskState === "blocked");
  const draftSubtrees = subtrees.filter(s => s.taskState === "draft");
  const stableSubtrees = subtrees.filter(s => s.taskState === "stable");

  const visible: OverlayNode[] = [];
  let hiddenStable = 0;
  let truncatedDraft = 0;
  let truncatedChildren = 0;

  // Greedy fit: try to add whole subtrees in priority order
  function tryAddAll(subs: Subtree[]): Subtree[] {
    const remaining: Subtree[] = [];
    for (const s of subs) {
      if (visible.length + s.size <= innerBudget) {
        visible.push(...s.nodes);
      } else {
        remaining.push(s);
      }
    }
    return remaining;
  }

  // Active → always try to fit
  tryAddAll(activeSubtrees.concat(blockedSubtrees));
  const remainingDraft = tryAddAll(draftSubtrees);

  // Count hidden: drafts that didn't fit become truncatedDraft
  truncatedDraft = remainingDraft.filter(s => s.taskState === "draft").length;
  hiddenStable = stableSubtrees.length;

  // If even active doesn't fit, show as many as possible
  if (visible.length === 0 && subtrees.length > 0) {
    for (const s of subtrees) {
      if (visible.length + s.size <= innerBudget) {
        visible.push(...s.nodes);
      } else {
        if (s.taskState === "stable") hiddenStable++;
        else if (s.taskState === "draft") truncatedDraft++;
        else truncatedChildren += s.size;
      }
    }
  }

  const totalHidden = hiddenStable + truncatedDraft + truncatedChildren;

  return { visible, hiddenStableTasks: hiddenStable, truncatedDraftTasks: truncatedDraft, truncatedChildren, totalHidden };
}