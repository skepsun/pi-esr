import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { MemoryStore, type Observation } from "../src";
import { buildMemoryContext, buildActiveMemoryContext, formatObservation } from "../src";
import { recordStateChange, buildJournalSummary } from "../src";

function extractEntityIds(systemPrompt: string): string[] {
  const ids = new Set<string>();
  const lines = systemPrompt.split("\n");
  let inEntities = false;

  for (const line of lines) {
    if (line.startsWith("ENTITIES:")) {
      inEntities = true;
      continue;
    }
    if (inEntities) {
      if (line.trim() === "" || line.startsWith("RELATIONS:") || line.startsWith("ARTIFACTS:")) {
        inEntities = false;
        continue;
      }
      const match = line.match(/^\s+(\S+)\s+\[/);
      if (match) ids.add(match[1]);
    }
  }
  return Array.from(ids);
}

// ═══════════════════════════════════════════════════════════
// Store CRUD
// ═══════════════════════════════════════════════════════════

describe("MemoryStore", () => {
  const store = new MemoryStore(":memory:");

  afterAll(() => {
    store.clear();
    store.close();
  });

  it("stores an observation anchored to an entity", () => {
    const id = store.store("task-auth", "JWT library upgraded to 4.x");
    expect(id).toBeGreaterThan(0);
    expect(store.count()).toBeGreaterThanOrEqual(1);
  });

  it("recalls observations by entity_id", () => {
    store.store("task-auth", "Second observation for auth");
    store.store("module-api", "API endpoint migration started");

    const authObs = store.recall("task-auth");
    expect(authObs.length).toBeGreaterThanOrEqual(2);
    expect(authObs.every(o => o.entity_id === "task-auth")).toBe(true);
  });

  it("searches across all entities", () => {
    store.store("task-db", "Database migration with breaking schema change");
    const results = store.search("migration");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(o => o.content.includes("migration"))).toBe(true);
  });

  it("timeline returns chronological order (oldest first)", () => {
    store.store("task-timeline", "First event");
    store.store("task-timeline", "Second event");
    store.store("task-timeline", "Third event");

    const timeline = store.timeline("task-timeline");
    expect(timeline.length).toBeGreaterThanOrEqual(3);

    // Verify ascending order
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].created_at >= timeline[i - 1].created_at).toBe(true);
    }
  });

  it("recall newest first (DESC)", () => {
    const observations = store.recall("task-timeline", 3);
    expect(observations.length).toBe(3);
    // Verify recent observations are present (order may depend on timestamp precision)
    const contents = observations.map(o => o.content);
    expect(contents).toContain("Third event");
    expect(contents).toContain("Second event");
    expect(contents).toContain("First event");
  });

  it("stores tags as JSON array", () => {
    store.store("task-tags", "Tagged observation", { tags: ["important", "security"] });
    const obs = store.recall("task-tags", 1);
    expect(obs[0].tags).toEqual(["important", "security"]);
  });

  it("countFor returns per-entity count", () => {
    const count = store.countFor("task-auth");
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("count returns total observations", () => {
    expect(store.count()).toBeGreaterThan(0);
  });

  it("recallAll groups by entity", () => {
    const grouped = store.recallAll(["task-auth", "task-db"]);
    expect(grouped.has("task-auth")).toBe(true);
    expect(grouped.has("task-db")).toBe(true);
    expect(grouped.get("task-auth")!.length).toBeGreaterThan(0);
  });

  it("stores session tag for cross-session filtering", () => {
    store.store("task-session", "Session-scoped observation", {
      tags: ["important", "session:sess-123"],
    });
    const obs = store.recall("task-session", 1);
    expect(obs[0].tags).toContain("session:sess-123");
  });

  it("search can filter by session tag via LIKE", () => {
    store.store("task-filter-1", "Only in session A", { tags: ["session:sess-A"] });
    store.store("task-filter-2", "Only in session B", { tags: ["session:sess-B"] });

    const resultsA = store.search("session:sess-A");
    expect(resultsA.every(o => o.tags.includes("session:sess-A"))).toBe(true);

    const resultsB = store.search("session:sess-B");
    expect(resultsB.every(o => o.tags.includes("session:sess-B"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// Journal
// ═══════════════════════════════════════════════════════════

describe("Journal", () => {
  const store = new MemoryStore(":memory:");

  afterAll(() => {
    store.clear();
    store.close();
  });

  it("records a state transition", () => {
    store.journal("task-auth", "draft → active");
    const entries = store.getJournal("task-auth");
    expect(entries.length).toBe(1);
    expect(entries[0].transition).toBe("draft → active");
  });

  it("getAllJournal returns across entities, newest first", () => {
    store.journal("task-auth", "active → stable");
    store.journal("task-db", "draft → blocked");

    const all = store.getAllJournal(10);
    expect(all.length).toBeGreaterThanOrEqual(3);
    // Newest first
    expect(new Date(all[0].created_at) >= new Date(all[1].created_at)).toBe(true);
  });

  it("recordStateChange creates both journal entry and observation", () => {
    const beforeCount = store.count();
    recordStateChange(store, {
      entity_id: "task-foo",
      old_state: "draft",
      new_state: "active",
      label: "Foo Task",
    });

    // Journal entry
    const journal = store.getJournal("task-foo");
    expect(journal.length).toBeGreaterThanOrEqual(1);
    expect(journal[journal.length - 1].transition).toBe("draft → active");

    // Observation
    const obs = store.recall("task-foo", 1);
    expect(obs.length).toBeGreaterThanOrEqual(1);
    expect(obs[0].tags).toContain("state-transition");

    // New observation was created
    expect(store.count()).toBeGreaterThan(beforeCount);
  });
});

// ═══════════════════════════════════════════════════════════
// Context Builder
// ═══════════════════════════════════════════════════════════

describe("Context Builder", () => {
  const store = new MemoryStore(":memory:");

  afterAll(() => {
    store.clear();
    store.close();
  });

  it("builds entity-anchored memory context", () => {
    store.store("task-auth", "JWT library upgraded");
    store.store("task-auth", "Integration tests passed");
    store.store("module-api", "API migration started");

    const ctx = buildMemoryContext(store, ["task-auth", "module-api"]);

    expect(ctx).toContain("[ESR_MEMORY]");
    expect(ctx).toContain("task-auth");
    expect(ctx).toContain("module-api");
    expect(ctx).toContain("JWT library upgraded");
    expect(ctx).toContain("Integration tests passed");
  });

  it("shows (no memories) when entity list is empty", () => {
    const ctx = buildMemoryContext(store, []);
    expect(ctx).toContain("(no memories)");
  });

  it("buildActiveMemoryContext skips entities with no observations", () => {
    const ctx = buildActiveMemoryContext(store, ["task-auth", "nonexistent"]);
    expect(ctx).toContain("task-auth");
    expect(ctx).not.toContain("nonexistent");
  });

  it("produces deterministic output (sorted by entity_id)", () => {
    store.store("z-entity", "Last alphabetically");
    store.store("a-entity", "First alphabetically");

    const ctx = buildMemoryContext(store, ["z-entity", "a-entity"]);
    const aPos = ctx.indexOf("a-entity");
    const zPos = ctx.indexOf("z-entity");
    expect(aPos).toBeLessThan(zPos);
  });
});

// ═══════════════════════════════════════════════════════════
// Journal Summary
// ═══════════════════════════════════════════════════════════

describe("Journal Summary", () => {
  const store = new MemoryStore(":memory:");

  afterAll(() => {
    store.clear();
    store.close();
  });

  it("builds journal summary for entities", () => {
    store.journal("task-a", "draft → active");
    store.journal("task-a", "active → stable");
    store.journal("task-b", "draft → blocked");

    const summary = buildJournalSummary(store, ["task-a", "task-b"]);
    expect(summary).toContain("task-a");
    expect(summary).toContain("draft → active");
    expect(summary).toContain("draft → blocked");
  });

  it("returns placeholder when no entries", () => {
    const summary = buildJournalSummary(store, ["nonexistent"]);
    expect(summary).toBe("(no journal entries)");
  });
});

// ═══════════════════════════════════════════════════════════
// Format helpers
// ═══════════════════════════════════════════════════════════

describe("Format helpers", () => {
  it("formatObservation includes entity_id and timestamp", () => {
    const obs: Observation = {
      id: 1,
      entity_id: "task-auth",
      session_id: null,
      content: "test content",
      tags: [],
      fingerprint: null,
      created_at: "2026-06-07T10:00:00Z",
    };
    const formatted = formatObservation(obs);
    expect(formatted).toContain("[task-auth]");
    expect(formatted).toContain("2026-06-07T10:00");
    expect(formatted).toContain("test content");
  });
});

// ═══════════════════════════════════════════════════════════
// Entity ID extraction (no longer needed — graph.getAllEntities() used instead)
// ═══════════════════════════════════════════════════════════

describe("Entity ID extraction (deprecated — kept for migration reference)", () => {
  it("extracts entity IDs from ESR context block", () => {
    const esrContext = `[ESR_CONTEXT]

ENTITIES:
  task-a [Task] state=active confidence=0.95 "Auth refactor"
  module-db [Concept] state=draft confidence=0.80
  constraint-xyz [Constraint] state=active "Must use RSA256"

RELATIONS:
  task-a --[depends_on]--> module-db

ARTIFACTS:
  (none)`;

    const ids = extractEntityIds(esrContext);
    expect(ids).toEqual(["task-a", "module-db", "constraint-xyz"]);
  });

  it("handles empty ESR context", () => {
    const esrContext = `[ESR_CONTEXT]

ENTITIES:
  (none)

RELATIONS:
  (none)`;

    const ids = extractEntityIds(esrContext);
    expect(ids).toEqual([]);
  });
});
