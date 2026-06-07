/**
 * pi-esr-memory: Store — SQLite-backed observation storage
 *
 * Every observation is anchored to an ESR entity_id.
 * Supports: insert, recall by entity, timeline, FTS5 text search, journal.
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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

const DB_DIR = join(homedir(), ".pi-esr-memory");
const DB_PATH = join(DB_DIR, "memory.db");

function ensureDir(): void {
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
}

function openDB(): Database.Database {
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
  `);
}

export class MemoryStore {
  private db: Database.Database;

  constructor() {
    this.db = openDB();
    createSchema(this.db);
  }

  /** Store an observation anchored to an entity. Returns the new row id. */
  store(entityId: string, content: string, opts?: { tags?: string[]; fingerprint?: string; sessionId?: string }): number {
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
