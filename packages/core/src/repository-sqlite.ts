/**
 * pi-esr: SQLite-backed ESR repository.
 *
 * better-sqlite3 is optional — when unavailable, constructor throws
 * instead of crashing the entire process at import time.
 */

import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ESREntity, ESRPersistedState } from "./types.js";
import type {
  ESREvent,
  ESRRepository,
  SaveEntityInput,
  SaveResult,
  VersionedEntity,
  VersionConflict,
} from "./repository.js";

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS esr_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO esr_meta (key, value) VALUES ('current_revision', '0');

  CREATE TABLE IF NOT EXISTS esr_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    graph_version INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS esr_entity_versions (
    entity_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    updated_by TEXT,
    session_id TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS esr_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    revision INTEGER NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    actor_id TEXT,
    session_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_esr_events_revision ON esr_events(revision);
`;

function getDbDir(): string {
  if (process.env.PI_ESR_MEMORY_DIR) return process.env.PI_ESR_MEMORY_DIR;
  return join(process.cwd(), ".pi-esr-memory");
}

const require = createRequire(import.meta.url);
let DatabaseModule: any = null;
try {
  DatabaseModule = require("better-sqlite3");
} catch {
  // better-sqlite3 not installed — SqliteESRRepository will report errors gracefully
}

function openDB(dbPath?: string): Database.Database {
  const Database = DatabaseModule?.default ?? DatabaseModule;
  if (!Database) {
    throw new Error("better-sqlite3 is required for SqliteESRRepository. Install it: npm install better-sqlite3");
  }
  if (dbPath) {
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    if (dbPath !== ":memory:") db.pragma("journal_mode = WAL");
    return db;
  }
  const dir = getDbDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "memory.db"));
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  return db;
}

function cloneEntity(entity: ESREntity, version: number, updatedBy?: string, sessionId?: string): VersionedEntity {
  return {
    ...entity,
    metrics: { ...entity.metrics },
    version,
    updated_by: updatedBy,
    session_id: sessionId,
  };
}

function emptyState(): ESRPersistedState {
  return { version: 0, entities: [], relations: [], artifacts: [], memory_refs: [] };
}

export class SqliteESRRepository implements ESRRepository {
  private readonly db: Database.Database;

  constructor(dbPath?: string, initialState?: ESRPersistedState) {
    this.db = openDB(dbPath);
    this.db.exec(MIGRATION_SQL);
    // Migration: add graph_version column for existing v0.3.x databases
    try { this.db.exec("ALTER TABLE esr_state ADD COLUMN graph_version INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }
    if (initialState) this.seedState(initialState);
  }

  loadGraph(): ESRPersistedState {
    const row = this.db.prepare("SELECT state_json FROM esr_state WHERE id = 1").get() as { state_json: string } | undefined;
    if (!row) return emptyState();
    return JSON.parse(row.state_json) as ESRPersistedState;
  }

  getEntity(entityId: string): VersionedEntity | null {
    const state = this.loadGraph();
    const entity = state.entities.find(e => e.entity_id === entityId);
    if (!entity) return null;
    const versionRow = this.db.prepare(
      "SELECT version, updated_by, session_id FROM esr_entity_versions WHERE entity_id = ?",
    ).get(entityId) as { version: number; updated_by?: string; session_id?: string } | undefined;
    return cloneEntity(entity, versionRow?.version ?? 1, versionRow?.updated_by, versionRow?.session_id);
  }

  saveEntity(input: SaveEntityInput): SaveResult<VersionedEntity> {
    // Existence check outside transaction — fast-fail for wrong entity_id
    const probe = this.getEntity(input.entity.entity_id);
    if (!probe) return { ok: false, error: `Entity not found: ${input.entity.entity_id}` };

    const now = new Date().toISOString();
    const revision = this.nextRevision();

    let conflict = false;
    let versionConflict: VersionConflict | undefined;
    let nextEntity: VersionedEntity | null = null;

    this.db.transaction(() => {
      // Read the latest committed state INSIDE the transaction
      const row = this.db.prepare(
        "SELECT state_json, graph_version FROM esr_state WHERE id = 1",
      ).get() as { state_json: string; graph_version: number } | undefined;

      const currentState: ESRPersistedState = row
        ? JSON.parse(row.state_json)
        : { version: 0, entities: [], relations: [], artifacts: [], memory_refs: [] };
      const expectedGV = row?.graph_version ?? 0;

      // Read the target entity's current version from the LATEST state
      const currentEntity = currentState.entities.find(e => e.entity_id === input.entity.entity_id);
      const latestEntityVersion = currentEntity
        ? (this.db.prepare(
          "SELECT version FROM esr_entity_versions WHERE entity_id = ?",
        ).get(input.entity.entity_id) as { version: number } | undefined)?.version ?? 1
        : undefined;

      if (latestEntityVersion === undefined) {
        conflict = false; // entity disappeared between probe and transaction — let caller handle
        return;
      }

      // Validate per-entity expected_version against the LATEST committed version
      if (input.expected_version !== undefined && input.expected_version !== latestEntityVersion) {
        versionConflict = {
          code: "version_conflict",
          entity_id: input.entity.entity_id,
          expected_version: input.expected_version,
          current_version: latestEntityVersion,
        };
        return;
      }

      const nextVersion = latestEntityVersion + 1;

      // Merge the entity update into the LATEST state
      const idx = currentState.entities.findIndex(e => e.entity_id === input.entity.entity_id);
      const nextState: ESRPersistedState = {
        ...currentState,
        entities: idx >= 0
          ? currentState.entities.map((e, i) => (i === idx ? input.entity : e))
          : currentState.entities,
      };

      // CAS: only update if graph_version hasn't changed
      if (row) {
        const result = this.db.prepare(
          `UPDATE esr_state
           SET state_json = ?, updated_at = ?, graph_version = graph_version + 1
           WHERE id = 1 AND graph_version = ?`,
        ).run(JSON.stringify(nextState), now, expectedGV);
        if (result.changes === 0) {
          conflict = true;
          return;
        }
      } else {
        this.db.prepare(
          "INSERT OR REPLACE INTO esr_state (id, state_json, updated_at, graph_version) VALUES (1, ?, ?, ?)",
        ).run(JSON.stringify(nextState), now, 1);
      }

      nextEntity = cloneEntity(input.entity, nextVersion, input.actor_id, input.session_id);

      this.db.prepare(
        `INSERT OR REPLACE INTO esr_entity_versions (entity_id, version, updated_by, session_id, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(input.entity.entity_id, nextVersion, input.actor_id ?? null, input.session_id ?? null, now);
      this.db.prepare(
        `INSERT INTO esr_events (
          revision, event_type, entity_type, entity_key, payload_json,
          actor_id, session_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        revision,
        "entity_updated",
        "entity",
        input.entity.entity_id,
        JSON.stringify({ entity: input.entity, version: nextVersion }),
        input.actor_id ?? null,
        input.session_id ?? null,
        now,
      );
      this.db.prepare("UPDATE esr_meta SET value = ? WHERE key = 'current_revision'").run(String(revision));
    })();

    if (versionConflict) {
      return { ok: false, error: "version_conflict", conflict: versionConflict };
    }
    if (conflict) {
      return {
        ok: false,
        error: "global_version_conflict: another client modified the graph concurrently",
      };
    }
    if (!nextEntity) {
      return { ok: false, error: `Entity not found in latest state: ${input.entity.entity_id}` };
    }

    return { ok: true, value: nextEntity, revision };
  }

  getCurrentRevision(): number {
    const row = this.db.prepare("SELECT value FROM esr_meta WHERE key = 'current_revision'").get() as { value: string } | undefined;
    return Number(row?.value ?? "0");
  }

  getChanges(sinceRevision: number, limit = 100): ESREvent[] {
    const rows = this.db.prepare(
      `SELECT revision, event_type, entity_type, entity_key, payload_json, actor_id, session_id, created_at
       FROM esr_events
       WHERE revision > ?
       ORDER BY revision ASC
       LIMIT ?`,
    ).all(sinceRevision, limit) as Array<Record<string, unknown>>;

    return rows.map(row => ({
      revision: Number(row.revision),
      event_type: row.event_type as ESREvent["event_type"],
      entity_type: row.entity_type as ESREvent["entity_type"],
      entity_key: String(row.entity_key),
      payload: JSON.parse(String(row.payload_json)),
      actor_id: row.actor_id ? String(row.actor_id) : undefined,
      session_id: row.session_id ? String(row.session_id) : undefined,
      created_at: String(row.created_at),
    }));
  }

  private nextRevision(): number {
    return this.getCurrentRevision() + 1;
  }

  syncFromGraph(state: ESRPersistedState): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(
        "INSERT OR REPLACE INTO esr_state (id, state_json, updated_at, graph_version) VALUES (1, ?, ?, ?)",
      ).run(JSON.stringify(state), now, state.version);
      for (const entity of state.entities) {
        const existing = this.db.prepare(
          "SELECT version FROM esr_entity_versions WHERE entity_id = ?",
        ).get(entity.entity_id) as { version: number } | undefined;
        if (!existing) {
          this.db.prepare(
            `INSERT OR REPLACE INTO esr_entity_versions (entity_id, version, updated_by, session_id, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          ).run(entity.entity_id, 1, null, null, now);
        }
      }
    })();
  }

  private seedState(state: ESRPersistedState): void {
    const now = new Date().toISOString();
    const versionRows = state.entities.map(entity => [
      entity.entity_id,
      1,
      null,
      null,
      now,
    ]);
    this.db.transaction(() => {
      this.db.prepare(
        "INSERT OR REPLACE INTO esr_state (id, state_json, updated_at, graph_version) VALUES (1, ?, ?, ?)",
      ).run(JSON.stringify(state), now, state.version);
      for (const row of versionRows) {
        this.db.prepare(
          `INSERT OR REPLACE INTO esr_entity_versions (entity_id, version, updated_by, session_id, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(...row);
      }
      this.db.prepare("UPDATE esr_meta SET value = ? WHERE key = 'current_revision'").run(String(state.version));
    })();
  }
}
