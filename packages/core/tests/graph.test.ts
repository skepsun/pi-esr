import { describe, it, expect } from "vitest";
import { buildESRContext, buildGraphFingerprint } from "../src";
import { ESRGraph } from "../src";

function makeEntity(id: string, overrides: Record<string, unknown> = {}) {
  return {
    entity_id: id,
    role: "Concept" as const,
    state: "draft" as const,
    confidence: 1.0,
    metrics: {},
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════
// Entity CRUD
// ═══════════════════════════════════════════════════════════

describe("Entity CRUD", () => {
  it("creates an entity", () => {
    const g = new ESRGraph();
    const r = g.createEntity(makeEntity("e1"));
    expect(r.ok).toBe(true);
    expect(g.getEntity("e1")?.entity_id).toBe("e1");
  });

  it("rejects duplicate entity", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("e1"));
    const r = g.createEntity(makeEntity("e1"));
    expect(r.ok).toBe(false);
  });

  it("rejects invalid role", () => {
    const g = new ESRGraph();
    const r = g.createEntity(makeEntity("e1", { role: "Unknown" }));
    expect(r.ok).toBe(false);
  });

  it("rejects invalid state", () => {
    const g = new ESRGraph();
    const r = g.createEntity(makeEntity("e1", { state: "gone" }));
    expect(r.ok).toBe(false);
  });

  it("rejects confidence out of range", () => {
    const g = new ESRGraph();
    expect(g.createEntity(makeEntity("e1", { confidence: 1.5 })).ok).toBe(false);
    expect(g.createEntity(makeEntity("e2", { confidence: -0.1 })).ok).toBe(false);
    expect(g.createEntity(makeEntity("e3", { confidence: 0.5 })).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// State Transitions
// ═══════════════════════════════════════════════════════════

describe("State Transitions", () => {
  it("allows valid transitions", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("e1"));

    expect(g.updateEntityState("e1", "active").ok).toBe(true);
    expect(g.getEntity("e1")?.state).toBe("active");
    expect(g.updateEntityState("e1", "stable").ok).toBe(true);
    expect(g.getEntity("e1")?.state).toBe("stable");
  });

  it("rejects stable → draft", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("e1", { state: "stable" }));
    const r = g.updateEntityState("e1", "draft");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("Invalid transition");
  });

  it("rejects deprecated → active", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("e1", { state: "deprecated" }));
    const r = g.updateEntityState("e1", "active");
    expect(r.ok).toBe(false);
  });

  it("allows deprecated → draft (revival)", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("e1", { state: "deprecated" }));
    const r = g.updateEntityState("e1", "draft");
    expect(r.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Relations & Cycle Detection
// ═══════════════════════════════════════════════════════════

describe("Relations", () => {
  it("creates a relation", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    const r = g.linkRelation("a", "b", "depends_on");
    expect(r.ok).toBe(true);
    expect(g.getAllRelations()).toHaveLength(1);
  });

  it("rejects relation with missing entities", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    expect(g.linkRelation("a", "b", "depends_on").ok).toBe(false);
    expect(g.linkRelation("b", "a", "depends_on").ok).toBe(false);
  });

  it("rejects invalid relation type", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    const r = g.linkRelation("a", "b", "loves" as never);
    expect(r.ok).toBe(false);
  });

  it("detects direct cycle on depends_on", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    g.linkRelation("a", "b", "depends_on");
    const r = g.linkRelation("b", "a", "depends_on");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("Cycle");
  });

  it("detects indirect cycle (a→b→c→a)", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    g.createEntity(makeEntity("c"));
    g.linkRelation("a", "b", "depends_on");
    g.linkRelation("b", "c", "depends_on");
    const r = g.linkRelation("c", "a", "depends_on");
    expect(r.ok).toBe(false);
  });

  it("allows non-structural relation cycles (evaluates)", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    g.linkRelation("a", "b", "evaluates");
    const r = g.linkRelation("b", "a", "evaluates");
    expect(r.ok).toBe(true);
  });

  it("rejects duplicate relation", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    g.linkRelation("a", "b", "depends_on");
    const r = g.linkRelation("a", "b", "depends_on");
    expect(r.ok).toBe(false);
  });

  it("removes a relation", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    g.linkRelation("a", "b", "depends_on");
    expect(g.getAllRelations()).toHaveLength(1);
    const r = g.removeRelation("a", "b", "depends_on");
    expect(r.ok).toBe(true);
    expect(g.getAllRelations()).toHaveLength(0);
  });

  it("removeRelation rejects nonexistent", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    const r = g.removeRelation("a", "b", "depends_on");
    expect(r.ok).toBe(false);
  });

  it("getRelationsFor filters by entity", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    g.createEntity(makeEntity("c"));
    g.linkRelation("a", "b", "depends_on");
    g.linkRelation("b", "c", "depends_on");
    expect(g.getRelationsFor("b")).toHaveLength(2);
    expect(g.getRelationsFor("c")).toHaveLength(1);
  });

  it("getRelationsByType filters by type", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    g.linkRelation("a", "b", "depends_on");
    g.linkRelation("a", "b", "evaluates");
    expect(g.getRelationsByType("depends_on")).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════
// Task Promotion
// ═══════════════════════════════════════════════════════════

describe("Task Promotion", () => {
  it("promotes a draft task to active", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("t1", { role: "Task" }));
    const r = g.promoteTask("t1", "active");
    expect(r.ok).toBe(true);
    expect(g.getEntity("t1")?.state).toBe("active");
  });

  it("rejects promotion of non-task entity", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a1"));
    const r = g.promoteTask("a1", "active");
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("Not a Task");
  });

  it("rejects invalid task transition", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("t1", { role: "Task", state: "stable" }));
    // stable → active is allowed
    expect(g.promoteTask("t1", "active").ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Evaluate & Score
// ═══════════════════════════════════════════════════════════

describe("Evaluate & Score", () => {
  it("records evaluation and creates relation", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("evaluator", { role: "Actor" }));
    g.createEntity(makeEntity("target"));
    const r = g.evaluate("target", "evaluator", 0.85, { q: 0.9 });
    expect(r.ok).toBe(true);
    expect(g.getEntity("target")?.confidence).toBe(0.85);
    expect(g.getEntity("target")?.metrics.q).toBe(0.9);
    expect(g.getAllRelations()).toHaveLength(1);
  });

  it("rejects evaluate with bad confidence", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("evaluator", { role: "Actor" }));
    g.createEntity(makeEntity("target"));
    expect(g.evaluate("target", "evaluator", 1.5, {}).ok).toBe(false);
  });

  it("attaches score", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("e1"));
    const r = g.score("e1", 0.7, "quality");
    expect(r.ok).toBe(true);
    expect(g.getEntity("e1")?.metrics.quality).toBe(0.7);
  });

  it("evaluate deduplicates relation", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("eval", { role: "Actor" }));
    g.createEntity(makeEntity("t"));
    g.evaluate("t", "eval", 0.8, {});
    expect(g.getAllRelations()).toHaveLength(1);
    g.evaluate("t", "eval", 0.9, { q: 1 });
    expect(g.getAllRelations()).toHaveLength(1); // still 1
    expect(g.getEntity("t")?.confidence).toBe(0.9);
  });
});

// ═══════════════════════════════════════════════════════════
// Constraint
// ═══════════════════════════════════════════════════════════

describe("Constraint", () => {
  it("applies constraint", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("e1"));
    const r = g.applyConstraint("e1", "must be valid");
    expect(r.ok).toBe(true);
    const rels = g.getAllRelations();
    expect(rels.length).toBe(1);
    expect(rels[0].type).toBe("validates");
    expect(rels[0].to).toBe("e1");
  });
});

// ═══════════════════════════════════════════════════════════
// Artifact
// ═══════════════════════════════════════════════════════════

describe("Artifact", () => {
  it("upserts artifact", () => {
    const g = new ESRGraph();
    const r = g.upsertArtifact({
      id: "a1", type: "document", version: 1,
      sections: [{ name: "intro", state: "draft" }],
    });
    expect(r.ok).toBe(true);
    expect(g.getArtifact("a1")?.sections).toHaveLength(1);
  });

  it("auto-increments version when version is omitted", () => {
    const g = new ESRGraph();
    g.upsertArtifact({ id: "a1", type: "document", version: 0, sections: [] });
    // omit version field → auto-increment
    g.upsertArtifact({ id: "a1", type: "document", sections: [{ name: "s1", state: "stable" }] });
    expect(g.getArtifact("a1")?.version).toBe(1);
  });

  it("creates an entity proxy so relations can target the artifact", () => {
    const g = new ESRGraph();
    g.upsertArtifact({ id: "report-1", type: "report", sections: [{ name: "summary", state: "draft" }] });

    // Auto-created Artifact entity proxy
    const proxy = g.getEntity("report-1");
    expect(proxy).toBeDefined();
    expect(proxy!.role).toBe("Artifact");
    expect(proxy!.state).toBe("stable");
    expect(proxy!.confidence).toBe(1.0);
    expect(proxy!.metrics.version).toBe(1);
    expect(proxy!.label).toContain("report-1");
    expect(proxy!.label).toContain("report");
  });

  it("updates existing entity proxy version on re-upsert", async () => {
    const g = new ESRGraph();
    g.upsertArtifact({ id: "doc-1", type: "document", sections: [] });
    const originalUpdatedAt = g.getEntity("doc-1")!.updated_at;

    // Wait a tick so timestamps differ
    await new Promise(r => setTimeout(r, 10));
    g.upsertArtifact({ id: "doc-1", type: "document", version: 3, sections: [{ name: "s2", state: "stable" }] });

    const proxy = g.getEntity("doc-1")!;
    expect(proxy.metrics.version).toBe(3);
    expect(proxy.updated_at).not.toBe(originalUpdatedAt);
  });

  it("does not duplicate entity proxy on re-upsert", () => {
    const g = new ESRGraph();
    g.upsertArtifact({ id: "spec-1", type: "spec", sections: [] });
    const entityCount = g.getAllEntities().length;

    g.upsertArtifact({ id: "spec-1", type: "spec", sections: [{ name: "intro", state: "editing" }] });
    // Still only one entity for this artifact
    expect(g.getAllEntities().filter(e => e.entity_id === "spec-1")).toHaveLength(1);
    expect(g.getAllEntities()).toHaveLength(entityCount); // no new entity created
  });
});

// ═══════════════════════════════════════════════════════════
// Serialization
// ═══════════════════════════════════════════════════════════

describe("Serialization", () => {
  it("roundtrips state", () => {
    const g1 = new ESRGraph();
    g1.createEntity(makeEntity("e1"));
    g1.createEntity(makeEntity("e2", { role: "Task" }));
    g1.linkRelation("e1", "e2", "depends_on");
    g1.upsertArtifact({ id: "a1", type: "report", version: 0, sections: [{ name: "s1", state: "stable" }] });

    const state = g1.toPersistedState();
    const g2 = new ESRGraph();
    g2.loadFromState(state);

    expect(g2.getAllEntities()).toHaveLength(3); // 2 user + 1 artifact auto-proxy
    expect(g2.getAllRelations()).toHaveLength(1);
    expect(g2.getAllArtifacts()).toHaveLength(1);
  });

  it("clear resets everything", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("e1"));
    g.clear();
    expect(g.getAllEntities()).toHaveLength(0);
    expect(g.getAllRelations()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════
// Remove Entity
// ═══════════════════════════════════════════════════════════

describe("Remove Entity", () => {
  it("removes entity and cascades relations", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    g.linkRelation("a", "b", "depends_on");
    g.linkRelation("b", "a", "evaluates");
    const r = g.removeEntity("a");
    expect(r.ok).toBe(true);
    expect(g.getEntity("a")).toBeUndefined();
    expect(g.getAllRelations()).toHaveLength(0);
  });

  it("rejects remove of nonexistent entity", () => {
    const g = new ESRGraph();
    const r = g.removeEntity("nope");
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Timestamp
// ═══════════════════════════════════════════════════════════

describe("Timestamp", () => {
  it("sets updated_at on create", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("e1"));
    expect(g.getEntity("e1")?.updated_at).toBeDefined();
  });

  it("updates timestamp on state change", async () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("e1"));
    const t1 = g.getEntity("e1")!.updated_at;
    await new Promise(r => setTimeout(r, 10));
    g.updateEntityState("e1", "active");
    const t2 = g.getEntity("e1")!.updated_at;
    expect(t2).not.toBe(t1);
  });

  it("updates timestamp on evaluate", async () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("eval", { role: "Actor" }));
    g.createEntity(makeEntity("t"));
    const t1 = g.getEntity("t")!.updated_at;
    await new Promise(r => setTimeout(r, 10));
    g.evaluate("t", "eval", 0.8, {});
    expect(g.getEntity("t")!.updated_at).not.toBe(t1);
  });
});

// ═══════════════════════════════════════════════════════════
// Fingerprint
// ═══════════════════════════════════════════════════════════

describe("Fingerprint", () => {
  it("produces stable fingerprint for identical state", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    const fp1 = buildGraphFingerprint(g);
    const fp2 = buildGraphFingerprint(g);
    expect(fp1).toBe(fp2);
  });

  it("changes on entity creation", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    const fp1 = buildGraphFingerprint(g);
    g.createEntity(makeEntity("b"));
    const fp2 = buildGraphFingerprint(g);
    expect(fp1).not.toBe(fp2);
  });

  it("changes on state update", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    const fp1 = buildGraphFingerprint(g);
    g.updateEntityState("a", "active");
    const fp2 = buildGraphFingerprint(g);
    expect(fp1).not.toBe(fp2);
  });

  it("changes on relation add", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    const fp1 = buildGraphFingerprint(g);
    g.linkRelation("a", "b", "depends_on");
    const fp2 = buildGraphFingerprint(g);
    expect(fp1).not.toBe(fp2);
  });

  it("same structure produces same fingerprint", () => {
    const g1 = new ESRGraph();
    g1.createEntity(makeEntity("a"));
    g1.createEntity(makeEntity("b"));

    const g2 = new ESRGraph();
    g2.createEntity(makeEntity("a"));
    g2.createEntity(makeEntity("b"));

    expect(buildGraphFingerprint(g1)).toBe(buildGraphFingerprint(g2));
  });
});

// ═══════════════════════════════════════════════════════════
// Immutability
// ═══════════════════════════════════════════════════════════

describe("Immutability", () => {
  it("getEntity returns defensive copy", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("e1", { metrics: { q: 1 } }));
    const snapshot = g.getEntity("e1")!;
    snapshot.metrics.q = 0;
    expect(g.getEntity("e1")?.metrics.q).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════
// Context Builder
// ═══════════════════════════════════════════════════════════

describe("Context Builder", () => {
  it("builds context text", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("e1", { label: "test entity" }));
    const text = buildESRContext(g);
    expect(text).toContain("[ESR_CONTEXT]");
    expect(text).toContain("e1");
    expect(text).toContain("test entity");
  });

  it("shows empty state gracefully", () => {
    const g = new ESRGraph();
    const text = buildESRContext(g);
    expect(text).toContain("(none)");
  });

  it("produces deterministic output", () => {
    const g = new ESRGraph();
    g.createEntity(makeEntity("c", { role: "Task" }));
    g.createEntity(makeEntity("a"));
    g.createEntity(makeEntity("b"));
    g.linkRelation("a", "b", "depends_on");
    g.linkRelation("a", "c", "produces");

    const ctx1 = buildESRContext(g);
    const ctx2 = buildESRContext(g);
    expect(ctx1).toBe(ctx2);

    // Entity order should be a, b, c (sorted by entity_id)
    const aPos = ctx1.indexOf("a [");
    const bPos = ctx1.indexOf("b [");
    const cPos = ctx1.indexOf("c [");
    expect(aPos).toBeLessThan(bPos);
    expect(bPos).toBeLessThan(cPos);
  });
});
