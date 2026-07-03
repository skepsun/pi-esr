/**
 * pi-esr: ESRGraph — Core State Machine
 */

import type {
  ESREntity, ESRRelation, ESRArtifact, ESRPersistedState,
  EntityState, RelationType, ESRMemoryRefSummary, SectionState, ESREvaluationRecord,
} from "./types.js";
import {
  validateRole, validateState, validateRelationType,
  validateArtifactType, validateSectionState,
  validateConfidence, canTransition,
} from "./validation.js";

/**
 * Core semantic graph state machine for ESR.
 *
 * Manages entities, typed relations, artifacts, and enforces:
 * - State transition validity (via {@link canTransition})
 * - Structural cycle detection (depends_on, part_of, implements, triggers)
 * - Duplicate relation prevention
 * - Confidence clamping [0, 1]
 * - Defensive copies on reads (getEntity returns a clone)
 */
export class ESRGraph {
  private entities = new Map<string, ESREntity>();
  private relations: ESRRelation[] = [];
  private artifacts = new Map<string, ESRArtifact>();
  private memoryRefs = new Map<string, ESRMemoryRefSummary[]>();
  private evaluations = new Map<string, ESREvaluationRecord[]>();
  private version = 0;

  /** Callback: (entityId, oldState, newState, label?) — set by index.ts for auto-journal. */
  private onStateChange?: (entityId: string, oldState: string, newState: string, label?: string) => void;

  setStateChangeHook(hook: (entityId: string, oldState: string, newState: string, label?: string) => void): void {
    this.onStateChange = hook;
  }

  getVersion(): number {
    return this.version;
  }

  /**
   * Create a new entity. Returns error if entity_id already exists,
   * or if role/state/confidence are invalid.
   */
  createEntity(e: ESREntity): { ok: true } | { ok: false; error: string } {
    if (!validateRole(e.role)) return { ok: false, error: `Invalid role: ${e.role}` };
    if (!validateState(e.state)) return { ok: false, error: `Invalid state: ${e.state}` };
    if (!validateConfidence(e.confidence)) return { ok: false, error: "Confidence must be in [0,1]" };
    if (this.entities.has(e.entity_id)) return { ok: false, error: `Entity already exists: ${e.entity_id}` };

    this.entities.set(e.entity_id, {
      ...e,
      confidence: e.confidence ?? 0,
      metrics: e.metrics ?? {},
      updated_at: e.updated_at ?? new Date().toISOString(),
    });
    this.version++;
    return { ok: true };
  }

  /** Return a defensive copy of the entity, or undefined. */
  getEntity(id: string): ESREntity | undefined {
    const e = this.entities.get(id);
    return e ? { ...e, metrics: { ...e.metrics } } : undefined;
  }

  private touch(entity: ESREntity): void {
    entity.updated_at = new Date().toISOString();
  }

  /**
   * Transition entity to a new state, optionally updating confidence and metrics.
   * Validates the transition against the state transition matrix.
   */
  updateEntityState(
    id: string,
    state: EntityState,
    confidence?: number,
    metrics?: Record<string, number>,
  ): { ok: true } | { ok: false; error: string } {
    const entity = this.entities.get(id);
    if (!entity) return { ok: false, error: `Entity not found: ${id}` };
    if (!validateState(state)) return { ok: false, error: `Invalid state: ${state}` };
    if (!canTransition(entity.state, state)) {
      return { ok: false, error: `Invalid transition: ${entity.state} → ${state}` };
    }

    if (confidence !== undefined) {
      if (!validateConfidence(confidence)) return { ok: false, error: "Confidence must be in [0,1]" };
      entity.confidence = confidence;
    }
    if (metrics !== undefined) entity.metrics = { ...entity.metrics, ...metrics };
    const oldState = entity.state;
    entity.state = state;
    this.touch(entity);
    this.version++;
    this.onStateChange?.(id, oldState, state, entity.label);
    return { ok: true };
  }

  /** Return all entities (not defensive copies — use for serialization). */
  getAllEntities(): ESREntity[] {
    return Array.from(this.entities.values());
  }

  attachMemoryRef(entityId: string, ref: ESRMemoryRefSummary): { ok: true } | { ok: false; error: string } {
    if (!this.entities.has(entityId)) return { ok: false, error: `Entity not found: ${entityId}` };
    if (ref.entity_id !== entityId) return { ok: false, error: `Memory ref entity mismatch: expected ${entityId}, got ${ref.entity_id}` };

    const current = this.memoryRefs.get(entityId) ?? [];
    if (current.some((item) => item.ref_id === ref.ref_id && item.provider === ref.provider)) {
      return { ok: false, error: `Memory ref already attached: ${ref.provider}:${ref.ref_id}` };
    }

    this.memoryRefs.set(entityId, [...current, cloneMemoryRef(ref)]);
    this.version++;
    return { ok: true };
  }

  getMemoryRefs(entityId: string): ESRMemoryRefSummary[] {
    return (this.memoryRefs.get(entityId) ?? []).map(cloneMemoryRef);
  }

  getAllMemoryRefs(): ESRMemoryRefSummary[] {
    return Array.from(this.memoryRefs.values()).flat().map(cloneMemoryRef);
  }

  /**
   * Create a typed relation between two entities.
   * Structural edges (depends_on, part_of, implements, triggers)
   * are checked for cycles via DFS.
   */
  linkRelation(from: string, to: string, type: RelationType, metadata?: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
    if (!validateRelationType(type)) return { ok: false, error: `Invalid relation type: ${type}` };
    if (!this.entities.has(from)) return { ok: false, error: `Source entity not found: ${from}` };
    if (!this.entities.has(to)) return { ok: false, error: `Target entity not found: ${to}` };
    if (this.wouldCreateCycle(from, to, type)) {
      return { ok: false, error: `Cycle detected: ${from} --[${type}]--> ${to}` };
    }
    if (this.relations.some(r => r.from === from && r.to === to && r.type === type)) {
      return { ok: false, error: `Relation already exists: ${from} --[${type}]--> ${to}` };
    }

    // Mutual-exclusion checks for contradictory semantic relations
    if (type === "contradicts" && this.relations.some(r => r.from === from && r.to === to && r.type === "supports")) {
      return { ok: false, error: `Mutual exclusion: ${from} already supports ${to}` };
    }
    if (type === "supports" && this.relations.some(r => r.from === from && r.to === to && r.type === "contradicts")) {
      return { ok: false, error: `Mutual exclusion: ${from} already contradicts ${to}` };
    }

    this.relations.push({ from, to, type, ...(metadata ? { metadata } : {}) });
    this.version++;
    return { ok: true };
  }

  /** Remove a specific relation. Returns error if not found. */
  removeRelation(from: string, to: string, type: RelationType): { ok: true } | { ok: false; error: string } {
    const idx = this.relations.findIndex(r => r.from === from && r.to === to && r.type === type);
    if (idx === -1) return { ok: false, error: `Relation not found: ${from} --[${type}]--> ${to}` };
    this.relations.splice(idx, 1);
    this.version++;
    return { ok: true };
  }

  private wouldCreateCycle(from: string, to: string, type: RelationType): boolean {
    const structural: Set<RelationType> = new Set(["depends_on", "part_of", "implements", "triggers"]);
    if (!structural.has(type)) return false;

    const visited = new Set<string>();
    const stack = [to];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === from) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const r of this.relations) {
        if (structural.has(r.type) && r.from === current && !visited.has(r.to)) {
          stack.push(r.to);
        }
      }
    }
    return false;
  }

  /** Return all relations (defensive copy). */
  getAllRelations(): ESRRelation[] {
    return [...this.relations];
  }

  /** Return all relations involving the given entity. */
  getRelationsFor(entityId: string): ESRRelation[] {
    return this.relations.filter(r => r.from === entityId || r.to === entityId);
  }

  /** Return all relations of a specific type. */
  getRelationsByType(type: RelationType): ESRRelation[] {
    return this.relations.filter(r => r.type === type);
  }

  /**
   * Return the neighborhood subgraph centered on entityId within `depth` hops.
   * BFS outward along all relation directions, collecting entities and relations.
   */
  getNeighborhood(entityId: string, depth: number): { entities: ESREntity[]; relations: ESRRelation[] } {
    const entitySet = new Set<string>();
    const relationSet: ESRRelation[] = [];
    const root = this.entities.get(entityId);
    if (!root) return { entities: [], relations: [] };

    entitySet.add(entityId);
    let frontier = new Set<string>([entityId]);

    for (let d = 0; d < depth; d++) {
      const next = new Set<string>();
      for (const eid of frontier) {
        for (const r of this.relations) {
          if (r.from === eid && !entitySet.has(r.to)) {
            entitySet.add(r.to); next.add(r.to); relationSet.push(r);
          }
          if (r.to === eid && !entitySet.has(r.from)) {
            entitySet.add(r.from); next.add(r.from); relationSet.push(r);
          }
        }
      }
      frontier = next;
      if (frontier.size === 0) break;
    }

    // Include relations between entities already in the neighborhood
    for (const r of this.relations) {
      if (entitySet.has(r.from) && entitySet.has(r.to) && !relationSet.includes(r)) {
        relationSet.push(r);
      }
    }

    const entities = Array.from(entitySet).map(id => this.entities.get(id)!);
    return { entities, relations: relationSet };
  }

  /** Upsert an artifact. Auto-increments version when omitted.
   *  Also auto-creates an Artifact entity proxy (id = artifact id) so relations
   *  like `produces` can target artifacts without workarounds.
   *  The entity proxy's state reflects the aggregate of its sections:
   *    all stable → stable | any invalid → blocked | any draft/editing → active */
  upsertArtifact(artifact: ESRArtifact): { ok: true } | { ok: false; error: string } {
    if (!validateArtifactType(artifact.type)) return { ok: false, error: `Invalid artifact type: ${artifact.type}` };
    for (const s of artifact.sections) {
      if (!validateSectionState(s.state)) return { ok: false, error: `Invalid section state: ${s.state}` };
    }

    const existing = this.artifacts.get(artifact.id);
    const nextVersion = existing?.version ?? 0;
    const version = artifact.version ?? (existing ? nextVersion + 1 : 1);

    this.artifacts.set(artifact.id, {
      id: artifact.id,
      type: artifact.type,
      version,
      sections: artifact.sections.map(s => ({ name: s.name, state: s.state })),
    });
    // Auto-create entity proxy so relations can target this artifact
    const proxyState = computeArtifactProxyState(artifact.sections);
    if (!this.entities.has(artifact.id)) {
      this.entities.set(artifact.id, {
        entity_id: artifact.id,
        role: "Artifact",
        state: proxyState,
        confidence: 1.0,
        metrics: { version },
        label: `${artifact.id} [${artifact.type}]`,
        updated_at: new Date().toISOString(),
      });
    } else {
      // Update existing entity proxy state + metrics
      const proxy = this.entities.get(artifact.id)!;
      const oldState = proxy.state;
      proxy.state = proxyState;
      proxy.metrics = { ...proxy.metrics, version };
      this.touch(proxy);
      if (oldState !== proxyState) {
        this.onStateChange?.(artifact.id, oldState, proxyState, proxy.label);
      }
    }
    this.version++;
    return { ok: true };
  }

  /** Return a defensive copy of the artifact, or undefined. */
  getArtifact(id: string): ESRArtifact | undefined {
    const a = this.artifacts.get(id);
    return a ? { ...a, sections: a.sections.map(s => ({ ...s })) } : undefined;
  }

  /** Return all artifacts (defensive copy). */
  getAllArtifacts(): ESRArtifact[] {
    return Array.from(this.artifacts.values());
  }

  /**
   * Record an evaluation against an entity.
   * Updates the entity's confidence and metrics, and creates an
   * `evaluates` relation between evaluator and target (idempotent).
   * Also appends an audit record so past evaluations are never lost.
   */
  evaluate(entityId: string, evaluator: string, confidence: number, metrics: Record<string, number>): { ok: true } | { ok: false; error: string } {
    if (!validateConfidence(confidence)) return { ok: false, error: "Confidence must be in [0,1]" };
    const entity = this.entities.get(entityId);
    if (!entity) return { ok: false, error: `Entity not found: ${entityId}` };
    if (!this.entities.has(evaluator)) return { ok: false, error: `Evaluator not found: ${evaluator}` };

    entity.confidence = confidence;
    entity.metrics = { ...entity.metrics, ...metrics };
    this.touch(entity);
    if (!this.relations.some(r => r.from === evaluator && r.to === entityId && r.type === "evaluates")) {
      this.relations.push({ from: evaluator, to: entityId, type: "evaluates" });
    }
    // Append audit record — preserves full evaluation history
    const audit = this.evaluations.get(entityId) ?? [];
    audit.push({
      at: new Date().toISOString(),
      evaluator,
      confidence,
      metrics: { ...metrics },
    });
    this.evaluations.set(entityId, audit);
    this.version++;
    return { ok: true };
  }

  /** Return the full evaluation history for an entity. */
  getEvaluationHistory(entityId: string): ESREvaluationRecord[] {
    return (this.evaluations.get(entityId) ?? []).map(r => ({ ...r, metrics: { ...r.metrics } }));
  }

  /** Attach a named numeric score to an entity's metrics. */
  score(entityId: string, scoreValue: number, scoreType: string): { ok: true } | { ok: false; error: string } {
    const entity = this.entities.get(entityId);
    if (!entity) return { ok: false, error: `Entity not found: ${entityId}` };
    entity.metrics = { ...entity.metrics, [scoreType]: scoreValue };
    this.touch(entity);
    this.version++;
    return { ok: true };
  }

  /**
   * Promote a Task entity to 'active' or 'stable'.
   * Rejects non-Task entities and invalid transitions.
   */
  promoteTask(entityId: string, newState: "active" | "stable"): { ok: true } | { ok: false; error: string } {
    const entity = this.entities.get(entityId);
    if (!entity) return { ok: false, error: `Entity not found: ${entityId}` };
    if (entity.role !== "Task") return { ok: false, error: `Not a Task: ${entityId}` };
    if (!canTransition(entity.state, newState)) {
      return { ok: false, error: `Invalid transition: ${entity.state} → ${newState}` };
    }
    const oldState = entity.state;
    entity.state = newState;
    this.touch(entity);
    this.version++;
    this.onStateChange?.(entityId, oldState, newState, entity.label);
    return { ok: true };
  }

  /**
   * Apply a constraint to an entity.
   * Creates a Constraint entity with a cryptographic id and links it
   * to the target via a `validates` relation.
   */
  applyConstraint(entityId: string, description: string): { ok: true } | { ok: false; error: string } {
    const entity = this.entities.get(entityId);
    if (!entity) return { ok: false, error: `Entity not found: ${entityId}` };

    const id = `constraint-${entityId}-${crypto.randomUUID().slice(0, 8)}`;
    this.entities.set(id, {
      entity_id: id,
      role: "Constraint",
      state: "active",
      confidence: 1.0,
      metrics: {},
      label: description,
      updated_at: new Date().toISOString(),
    });
    this.relations.push({ from: id, to: entityId, type: "validates" });
    this.version++;
    return { ok: true };
  }

  /** Serialize the full graph state for persistence. */
  toPersistedState(): ESRPersistedState {
    return {
      version: this.version,
      entities: this.getAllEntities(),
      relations: this.getAllRelations(),
      artifacts: this.getAllArtifacts(),
      memory_refs: this.getAllMemoryRefs(),
    };
  }

  /** Load graph state from a previously persisted snapshot. Replaces all current state.
   *  Validates every entity, relation, and artifact — rejects the entire load if any
   *  entry is invalid, to prevent corrupted state from entering the graph. */
  loadFromState(state: ESRPersistedState): { ok: true } | { ok: false; error: string } {
    // Validate every entity
    for (const e of state.entities) {
      if (!validateRole(e.role)) return { ok: false, error: `Invalid role "${e.role}" for entity ${e.entity_id}` };
      if (!validateState(e.state)) return { ok: false, error: `Invalid state "${e.state}" for entity ${e.entity_id}` };
      if (!validateConfidence(e.confidence)) return { ok: false, error: `Invalid confidence ${e.confidence} for entity ${e.entity_id}` };
    }

    // Validate every relation
    for (const r of state.relations) {
      if (!validateRelationType(r.type)) return { ok: false, error: `Invalid relation type "${r.type}" in ${r.from} --[${r.type}]--> ${r.to}` };
    }

    // Validate every artifact
    for (const a of state.artifacts) {
      if (!validateArtifactType(a.type)) return { ok: false, error: `Invalid artifact type "${a.type}" for ${a.id}` };
      for (const s of a.sections) {
        if (!validateSectionState(s.state)) return { ok: false, error: `Invalid section state "${s.state}" in artifact ${a.id}` };
      }
    }

    // Check structural cycles on the full graph
    const structural = new Set<RelationType>(["depends_on", "part_of", "implements", "triggers"]);
    const adj = new Map<string, string[]>();
    for (const r of state.relations) {
      if (!structural.has(r.type)) continue;
      const neighbors = adj.get(r.from) ?? [];
      neighbors.push(r.to);
      adj.set(r.from, neighbors);
    }
    // DFS-based topological cycle detection (3-color)
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const e of state.entities) color.set(e.entity_id, WHITE);
    const hasCycle = (node: string): boolean => {
      color.set(node, GRAY);
      for (const neighbor of adj.get(node) ?? []) {
        const c = color.get(neighbor) ?? WHITE;
        if (c === GRAY) return true;
        if (c === WHITE && hasCycle(neighbor)) return true;
      }
      color.set(node, BLACK);
      return false;
    };
    for (const e of state.entities) {
      if ((color.get(e.entity_id) ?? WHITE) === WHITE && hasCycle(e.entity_id)) {
        return { ok: false, error: `Structural cycle detected in graph` };
      }
    }

    // All valid — apply state
    this.entities.clear();
    this.relations = [];
    this.artifacts.clear();
    this.memoryRefs.clear();
    this.evaluations.clear();
    for (const e of state.entities) this.entities.set(e.entity_id, e);
    this.relations = [...state.relations];
    for (const a of state.artifacts) this.artifacts.set(a.id, a);
    for (const ref of state.memory_refs ?? []) {
      const current = this.memoryRefs.get(ref.entity_id) ?? [];
      current.push(cloneMemoryRef(ref));
      this.memoryRefs.set(ref.entity_id, current);
    }
    this.version = state.version;
    return { ok: true };
  }

  /** Remove an entity and cascade-delete all its relations.
   *  If the entity is an artifact proxy, also removes the artifact itself. */
  removeEntity(id: string): { ok: true } | { ok: false; error: string } {
    if (!this.entities.has(id)) return { ok: false, error: `Entity not found: ${id}` };
    this.entities.delete(id);
    this.relations = this.relations.filter(r => r.from !== id && r.to !== id);
    this.artifacts.delete(id);
    this.memoryRefs.delete(id);
    this.version++;
    return { ok: true };
  }

  /** Reset the graph to an empty state. */
  clear(): void {
    this.entities.clear();
    this.relations = [];
    this.artifacts.clear();
    this.memoryRefs.clear();
    this.evaluations.clear();
    this.version = 0;
  }
}

function cloneMemoryRef(ref: ESRMemoryRefSummary): ESRMemoryRefSummary {
  return {
    ...ref,
    metadata: ref.metadata ? { ...ref.metadata } : undefined,
  };
}

function computeArtifactProxyState(sections: { name: string; state: SectionState }[]): EntityState {
  if (sections.length === 0) return "stable";
  const states = new Set(sections.map(s => s.state));
  if (states.has("invalid")) return "blocked";
  if (states.has("draft") || states.has("editing")) return "active";
  return "stable";
}
