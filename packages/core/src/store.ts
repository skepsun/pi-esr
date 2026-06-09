/**
 * pi-esr-memory: Store — SQLite-backed observation storage
 *
 * Every observation is anchored to an ESR entity_id.
 * Supports: insert, recall by entity, timeline, FTS5 text search, journal.
 *
 * better-sqlite3 is optional — when unavailable, MemoryStore constructor throws
 * a descriptive error instead of crashing the entire process at import time.
 */

import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
let DatabaseModule: any = null;
try {
  DatabaseModule = require("better-sqlite3");
} catch {
  // better-sqlite3 not installed — MemoryStore will report errors gracefully
}

export interface Observation {
  id: number;
  entity_id: string;
  session_id: string | null;
  content: string;
  tags: string[];
  fingerprint: string | null;
  created_at: string;
}

export interface JournalEntry {
  id: number;
  entity_id: string;
  transition: string;
  fingerprint: string | null;
  created_at: string;
}

/** Get the project root directory. Reads $PI_ESR_MEMORY_DIR if set;
 * otherwise defaults to $CWD/.pi-esr-memory so different projects
 * (different working directories) use separate databases.
 *
 * To restore the old user-global behaviour set
 *   PI_ESR_MEMORY_DIR=~/.pi-esr-memory
 */
function getDbDir(): string {
  if (process.env.PI_ESR_MEMORY_DIR) return process.env.PI_ESR_MEMORY_DIR;
  // Project-level: one DB per working directory
  return join(process.cwd(), ".pi-esr-memory");
}

const DB_DIR = getDbDir();
const DB_PATH = join(DB_DIR, "memory.db");

function ensureDir(): void {
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
}

function openDB(dbPath?: string): Database.Database {
  const Database = DatabaseModule?.default ?? DatabaseModule;
  if (!Database) {
    throw new Error("better-sqlite3 is required for MemoryStore. Install it: npm install better-sqlite3");
  }
  if (dbPath) {
    // In-memory or custom path — skip directory creation
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    return db;
  }
  ensureDir();
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL,
      session_id TEXT,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      fingerprint TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_obs_entity ON observations(entity_id);
    CREATE INDEX IF NOT EXISTS idx_obs_created ON observations(created_at);
    CREATE TABLE IF NOT EXISTS journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL,
      transition TEXT NOT NULL,
      fingerprint TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_journal_entity ON journal(entity_id);
    CREATE TABLE IF NOT EXISTS graph_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL,
      session_id TEXT,
      updated_at TEXT
    );
  `);
}

export class MemoryStore {
  private db: Database.Database;

  /** Create a memory store.
   *  @param dbPath  Optional custom path. Use `":memory:"` for tests.
   *                  If omitted, reads `PI_ESR_MEMORY_DIR` or defaults
   *                  to `$CWD/.pi-esr-memory/memory.db`. */
  constructor(dbPath?: string) {
    this.db = openDB(dbPath);
    createSchema(this.db);
  }

  /** Store an observation anchored to an entity. Returns the new row id. */
  store(entityId: string, content: string, opts?: { tags?: string[]; fingerprint?: string; sessionId?: string }): number {
    if (!entityId || !content) throw new Error("entity_id and content are required");
    const stmt = this.db.prepare(
      "INSERT INTO observations (entity_id, content, tags, fingerprint, session_id) VALUES (?, ?, ?, ?, ?)",
    );
    const result = stmt.run(
      entityId,
      content,
      JSON.stringify(opts?.tags ?? []),
      opts?.fingerprint ?? null,
      opts?.sessionId ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  /** Recall all observations for a given entity, newest first. */
  recall(entityId: string, limit = 20): Observation[] {
    const rows = this.db.prepare(
      "SELECT * FROM observations WHERE entity_id = ? ORDER BY created_at DESC LIMIT ?",
    ).all(entityId, limit) as Array<Record<string, unknown>>;
    return rows.map(this.hydrate);
  }

  /** Full-text search across all observations. Returns with entity anchor. */
  search(query: string, limit = 20): Observation[] {
    const rows = this.db.prepare(
      `SELECT * FROM observations
       WHERE content LIKE ? OR entity_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    ).all(`%${query}%`, query, limit) as Array<Record<string, unknown>>;
    return rows.map(this.hydrate);
  }

  /** Chronological timeline for a single entity. */
  timeline(entityId: string, limit = 50): Observation[] {
    const rows = this.db.prepare(
      "SELECT * FROM observations WHERE entity_id = ? ORDER BY created_at ASC LIMIT ?",
    ).all(entityId, limit) as Array<Record<string, unknown>>;
    return rows.map(this.hydrate);
  }

  /** Recall observations for multiple entities at once, grouped by entity. */
  recallAll(entityIds: string[], limitPerEntity = 5): Map<string, Observation[]> {
    const result = new Map<string, Observation[]>();
    for (const id of entityIds) {
      result.set(id, this.recall(id, limitPerEntity));
    }
    return result;
  }

  /** Record a state transition in the journal. */
  journal(entityId: string, transition: string, fingerprint?: string): number {
    const stmt = this.db.prepare(
      "INSERT INTO journal (entity_id, transition, fingerprint) VALUES (?, ?, ?)",
    );
    const result = stmt.run(entityId, transition, fingerprint ?? null);
    return Number(result.lastInsertRowid);
  }

  /** Get journal entries for an entity. */
  getJournal(entityId: string, limit = 20): JournalEntry[] {
    return this.db.prepare(
      "SELECT * FROM journal WHERE entity_id = ? ORDER BY created_at DESC LIMIT ?",
    ).all(entityId, limit) as JournalEntry[];
  }

  /** Get all journal entries across entities, newest first. */
  getAllJournal(limit = 100): JournalEntry[] {
    return this.db.prepare(
      "SELECT * FROM journal ORDER BY created_at DESC LIMIT ?",
    ).all(limit) as JournalEntry[];
  }

  /** Count total observations. */
  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM observations").get() as { cnt: number };
    return row.cnt;
  }

  /** Count observations for a specific entity. */
  countFor(entityId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM observations WHERE entity_id = ?",
    ).get(entityId) as { cnt: number };
    return row.cnt;
  }

  /** Delete observations older than N days. */
  prune(daysAgo: number): number {
    const result = this.db.prepare(
      `DELETE FROM observations WHERE created_at < datetime('now', '-' || ? || ' days')`,
    ).run(daysAgo);
    return result.changes;
  }

  /** Completely clear all data. */
  clear(): void {
    this.db.exec("DELETE FROM observations");
    this.db.exec("DELETE FROM journal");
    this.db.exec("DELETE FROM graph_state");
  }

  // ── Graph state persistence ────────────────────────

  /**
   * Save the serialized ESR graph state to the database.
   * Uses INSERT OR REPLACE so there's always exactly one row (id=1).
   */
  saveGraphState(stateJson: string, sessionId?: string): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO graph_state (id, state_json, session_id, updated_at)
       VALUES (1, ?, ?, datetime('now'))`,
    ).run(stateJson, sessionId ?? null);
  }

  /**
   * Load the most recent ESR graph state from the database.
   * Returns the serialized JSON string, or null if no state exists.
   */
  loadGraphState(): string | null {
    const row = this.db.prepare(
      "SELECT state_json FROM graph_state WHERE id = 1",
    ).get() as { state_json: string } | undefined;
    return row?.state_json ?? null;
  }

  /** Clear only the graph state (not observations or journal). */
  clearGraphState(): void {
    this.db.exec("DELETE FROM graph_state");
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  private hydrate(row: Record<string, unknown>): Observation {
    let tags: string[] = [];
    try {
      tags = JSON.parse(String(row.tags ?? "[]"));
    } catch { /* keep default */ }
    return {
      id: Number(row.id),
      entity_id: String(row.entity_id),
      session_id: row.session_id ? String(row.session_id) : null,
      content: String(row.content),
      tags,
      fingerprint: row.fingerprint ? String(row.fingerprint) : null,
      created_at: String(row.created_at),
    };
  }
}
