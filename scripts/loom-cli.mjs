#!/usr/bin/env node
/**
 * pi-loom CLI for hook scripts
 *
 * Standalone Node script for reading/writing the loom.db without
 * importing @pi-loom classes. Accepts commands via argv + stdin.
 *
 * Commands:
 *   context  — emit [PI_LOOM] symbolic index JSON
 *   store    — store a memory (content on stdin as JSON)
 *   cleanup  — expire overdue memories + auto-consolidate
 *   unlock   — write protocol timestamp to state dir
 *   guard    — check if protocol satisfied, output block decision
 *
 * Usage:
 *   echo '{"content":"...","importance":0.7}' | node scripts/loom-cli.mjs store
 *   node scripts/loom-cli.mjs context
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── DB path resolution ──────────────────────────────────

function getDbPath() {
  if (process.env.PI_LOOM_DIR) return join(process.env.PI_LOOM_DIR, "loom.db");
  return join(process.cwd(), ".pi-loom", "loom.db");
}

let DatabaseModule = null;
try {
  DatabaseModule = (await import("better-sqlite3")).default;
} catch {
  process.stderr.write("[loom-cli] better-sqlite3 not available\n");
  process.exit(0);
}

function openDb() {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) return null;
  const db = new DatabaseModule(dbPath, { readonly: false });
  db.pragma("journal_mode = WAL");
  return db;
}

// ── Helpers ─────────────────────────────────────────────

function genId() {
  return randomBytes(12).toString("hex");
}

function fmtDate(iso) {
  return iso.slice(5, 10); // "06-15"
}

function parseTags(raw) {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function classify(tags) {
  for (const t of tags) {
    if (t === "decision" || t === "architecture" || t === "principle") return "D";
    if (t === "session-summary" && tags.includes("decisions")) return "D";
    if (t === "error" || t === "bug-fix") return "E";
    if (t === "insight" || t === "dream") return "I";
  }
  return "M";
}

// ── Command: context ────────────────────────────────────

function cmdContext() {
  const text = buildContext();
  if (text) process.stdout.write(text + "\n");
}

function cmdContextInject() {
  const text = buildContext();
  if (!text) { process.exit(0); }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: text,
    },
  }));
}

function buildContext() {
  const db = openDb();
  if (!db) return "";

  try {
    const lines = ["[PI_LOOM]"];
    lines.push("  Recent memories auto-injected below. Use loom_recall() to search deeper.");
    lines.push("");

    // Insights
    const insights = db.prepare(
      "SELECT id, content, confidence, entity_id FROM insights ORDER BY created_at DESC LIMIT 2"
    ).all();
    for (const i of insights) {
      const txt = i.content.replace(/\n/g, " ").slice(0, 64).trim();
      lines.push(`[I] ${txt} c${i.confidence.toFixed(1)} #${i.id.slice(0, 6)}`);
    }

    // Priority memories (decisions, errors)
    const priority = db.prepare(`
      SELECT id, content, fact_summary, entity_id, tags, importance, created_at
      FROM memories WHERE status = 'active' AND importance >= 0.6
      ORDER BY created_at DESC LIMIT 8
    `).all();

    for (const m of priority) {
      const tags = parseTags(m.tags);
      const pfx = classify(tags);
      const dt = fmtDate(m.created_at);
      const txt = (m.fact_summary || m.content).replace(/\n/g, " ").slice(0, 64).trim();
      const mid = `#${m.id.slice(0, 6)}`;
      lines.push(`[${pfx}] ${dt} ${txt} ${mid}`);
    }

    // Active count
    const stats = db.prepare(
      "SELECT COUNT(*) as cnt FROM memories WHERE status = 'active'"
    ).get();
    if (stats.cnt >= 8) {
      lines.push(`${stats.cnt} active · loom_search`);
    }

    if (lines.length <= 3) return "";
    return lines.join("\n");
  } finally {
    db.close();
  }
}

// ── Command: store ──────────────────────────────────────

function cmdStore() {
  const raw = readFileSync(0, "utf-8").trim();
  if (!raw) { process.exit(0); }

  let params;
  try {
    params = JSON.parse(raw);
  } catch {
    process.stderr.write("[loom-cli] invalid store JSON\n");
    process.exit(1);
  }

  if (!params.content) { process.exit(0); }

  const db = openDb();
  if (!db) { process.exit(0); }

  try {
    const content = params.content;
    const entityId = params.entity_id || null;
    const importance = params.importance || 0.5;
    const tags = params.tags || [];
    const expireAt = params.expire_at || null;

    // Content-hash dedup (same as LoomStore.store)
    const hash = createHash("sha256")
      .update(content + (entityId || ""))
      .digest("hex").slice(0, 12);

    const existing = db.prepare(
      `SELECT id FROM memories WHERE content_hash = ? AND status = 'active'
       AND created_at > datetime('now', '-1 day') LIMIT 1`
    ).get(hash);
    if (existing) {
      process.stderr.write(`[loom-cli] dedup: ${existing.id}\n`);
      process.exit(0);
    }

    const id = genId();
    db.prepare(`
      INSERT INTO memories (id, content, fact_summary, entity_id, valid_at, expire_at, importance, status, tags, content_hash)
      VALUES (?, ?, ?, ?, datetime('now'), ?, ?, 'active', ?, ?)
    `).run(id, content, null, entityId, expireAt, importance, JSON.stringify(tags), hash);

    // Sync FTS5
    const row = db.prepare("SELECT rowid FROM memories WHERE id = ?").get(id);
    db.prepare(
      "INSERT INTO memories_fts(rowid, content, fact_summary) VALUES (?, ?, ?)"
    ).run(row.rowid, content, "");

    process.stderr.write(`[loom-cli] stored: ${id.slice(0, 6)} importance=${importance.toFixed(2)}\n`);
  } finally {
    db.close();
  }
}

// ── Command: cleanup ────────────────────────────────────

function cmdCleanup() {
  const db = openDb();
  if (!db) { process.exit(0); }

  try {
    // Expire overdue
    const expired = db.prepare(`
      UPDATE memories SET status = 'expired'
      WHERE status = 'active' AND expire_at IS NOT NULL AND expire_at < datetime('now')
    `).run();
    if (expired.changes > 0) {
      process.stderr.write(`[loom-cli] expired ${expired.changes} memories\n`);
    }

    // Clean old raw events (>30 days)
    const ttlDays = parseInt(process.env.RAW_EVENT_TTL_DAYS || "30", 10);
    const cleaned = db.prepare(`
      DELETE FROM raw_events WHERE created_at < datetime('now', '-${ttlDays} days')
    `).run();
    if (cleaned.changes > 0) {
      process.stderr.write(`[loom-cli] cleaned ${cleaned.changes} raw events\n`);
    }
  } finally {
    db.close();
  }
}

// ── Command: protocol guard ─────────────────────────────

function getProtocolDir() {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA || process.env.PLUGIN_DATA;
  if (dataDir) return join(dataDir, "protocol-state");
  if (process.env.HOME) return join(process.env.HOME, ".pi-loom", "protocol-state");
  return join(process.cwd(), ".pi-loom", "protocol-state");
}

function cmdGuard() {
  const raw = readFileSync(0, "utf-8").trim();
  if (!raw) { process.exit(0); }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const tool = input.tool_name || "";

  // Allow loom and esr tools
  if (/^loom_/i.test(tool) || /^esr_/i.test(tool)) {
    process.exit(0);
  }

  // Whitelist: harmless read-only tools that don't mutate state
  const HARMLESS_TOOLS = [
    /^read$/i, /^ls$/i, /^cat$/i, /^echo$/i, /^pwd$/i, /^whoami$/i,
    /^find$/i, /^grep$/i, /^rg$/i, /^head$/i, /^tail$/i, /^wc$/i,
    /^git\s+status/i, /^git\s+log/i, /^git\s+diff/i, /^git\s+branch/i,
    /^git\s+show/i, /^git\s+blame/i, /^git\s+rev-/i,
    /^ctx_search/i, /^ctx_stats/i, /^ctx_doctor/i,
    /^file\s+/i, /^wc\s+/i, /^which\s+/i, /^type\s+/i,
  ];
  if (HARMLESS_TOOLS.some(pattern => pattern.test(tool))) {
    process.exit(0);
  }

  // Check protocol state
  const sessionId = input.session_id || "default";
  const stateDir = getProtocolDir();
  const stateFile = join(stateDir, sessionId);

  if (existsSync(stateFile)) {
    try {
      const last = parseInt(readFileSync(stateFile, "utf-8").trim(), 10);
      const now = Math.floor(Date.now() / 1000);
      if (now - last < 1800) process.exit(0); // within 30 min
    } catch { /* expired, block */ }
  }

  // Block: protocol not satisfied
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Session protocol: call loom_status() or loom_recall() to load memory first",
    },
  }));
}

// ── Command: unlock ─────────────────────────────────────

function cmdUnlock() {
  const raw = readFileSync(0, "utf-8").trim();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    input = { session_id: "default" };
  }

  const sessionId = input.session_id || "default";
  const stateDir = getProtocolDir();
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

  writeFileSync(join(stateDir, sessionId), String(Math.floor(Date.now() / 1000)));
  process.exit(0);
}

// ── Command: capture (auto-capture PostToolUse events) ──
// Mirrors auto-capture.sh logic but in pure Node.js — no jq dependency.

function cmdCapture() {
  const raw = readFileSync(0, "utf-8").trim();
  if (!raw) { process.exit(0); }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const tool = input.tool_name || "";
  const toolInput = input.tool_input || {};
  const error = input.error || input.tool_response || "";
  const isError = !!input.error || input.hook_event_name === "PostToolUseFailure";
  const durationMs = input.duration_ms || 0;

  const db = openDb();
  if (!db) { process.exit(0); }

  try {
    // ── Capture errors (highest priority) ──
    if (isError && error) {
      const errSnippet = (typeof error === "string" ? error : JSON.stringify(error)).slice(0, 200).replace(/\n/g, " | ");
      storeMem(db, `Error in ${tool}: ${errSnippet}`, 0.75, ["error", tool.toLowerCase(), "auto-captured"]);
      return;
    }

    // ── File edits ──
    if (/^(Write|Edit|MultiEdit|NotebookEdit)$/i.test(tool)) {
      const filePath = toolInput.file_path || toolInput.path || "";
      if (!filePath) { process.exit(0); }
      const dir = filePath.substring(0, filePath.lastIndexOf("/")) || ".";
      storeMem(db, `File edit: ${filePath}`, 0.3, ["file", "edit", `dir:${dir}`, "auto-captured"]);
      return;
    }

    // ── Bash commands ──
    if (/^Bash$/i.test(tool)) {
      const cmd = toolInput.command || "";
      if (!cmd) { process.exit(0); }

      if (/\bgit\s+commit\b/.test(cmd)) {
        const msgMatch = cmd.match(/git\s+commit[^|;&]*?-m\s+"([^"]+)"/);
        const msg = msgMatch ? `: ${msgMatch[1]}` : "";
        storeMem(db, `Git commit${msg}`, 0.8, ["git", "commit", "auto-captured"]);
      } else if (/\bgit\s+push\b/.test(cmd)) {
        storeMem(db, "Git push", 0.7, ["git", "push", "auto-captured"]);
      } else if (/\bgit\s+merge\b/.test(cmd)) {
        storeMem(db, "Git merge", 0.8, ["git", "merge", "auto-captured"]);
      } else if (/\bgit\s+rebase\b/.test(cmd)) {
        storeMem(db, "Git rebase", 0.7, ["git", "rebase", "auto-captured"]);
      } else if (/\bgit\s+checkout\s+-b\s+(\S+)/.test(cmd)) {
        const branch = cmd.match(/git\s+checkout\s+-b\s+(\S+)/)[1];
        storeMem(db, `Git checkout -b ${branch}`, 0.7, ["git", "branch", "auto-captured"]);
      } else if (/\bgit\s+stash\b/.test(cmd)) {
        storeMem(db, "Git stash", 0.6, ["git", "stash", "auto-captured"]);
      } else if (/\bnpm\s+(install|ci)\b/.test(cmd)) {
        storeMem(db, "npm install", 0.5, ["env", "setup", "auto-captured"]);
      } else if (/\bpip\s+install\b/.test(cmd)) {
        storeMem(db, "pip install", 0.5, ["env", "setup", "auto-captured"]);
      } else if (/\bdocker\s+(build|compose|run)\b/.test(cmd)) {
        storeMem(db, "docker operation", 0.6, ["env", "docker", "auto-captured"]);
      } else if (/\bsed\s+-i[^;|&]+/.test(cmd)) {
        const sedMatch = cmd.match(/sed\s+-i[^;|&]+/);
        storeMem(db, `sed edit: ${sedMatch ? sedMatch[0] : cmd.slice(0, 100)}`, 0.3, ["file", "sed", "auto-captured"]);
      } else if (/\b(git\s+apply|patch)\b/.test(cmd)) {
        storeMem(db, "Applied patch", 0.4, ["file", "patch", "auto-captured"]);
      }
      return;
    }

    // ── Config reads ──
    if (/^Read$/i.test(tool)) {
      const filePath = toolInput.file_path || toolInput.path || "";
      if (!filePath) { process.exit(0); }

      const significantFiles = /(\/CLAUDE\.md$|\/AGENTS\.md$|\/\.esr|\/\.loom|\/package\.json$|\/tsconfig\.json$|Dockerfile$)/i;
      if (significantFiles.test(filePath)) {
        storeMem(db, `Read config: ${filePath}`, 0.4, ["file", "read", "config", "auto-captured"]);
      }
      return;
    }
  } finally {
    db.close();
  }
}

function storeMem(db, content, importance, tags) {
  // Content-hash dedup (same as cmdStore)
  const hash = createHash("sha256")
    .update(content)
    .digest("hex").slice(0, 12);

  const existing = db.prepare(
    `SELECT id FROM memories WHERE content_hash = ? AND status = 'active'
     AND created_at > datetime('now', '-1 day') LIMIT 1`
  ).get(hash);
  if (existing) {
    process.stderr.write(`[loom-cli] capture dedup: ${existing.id}\n`);
    return;
  }

  const id = genId();
  db.prepare(`
    INSERT INTO memories (id, content, fact_summary, entity_id, valid_at, expire_at, importance, status, tags, content_hash)
    VALUES (?, ?, ?, NULL, datetime('now'), NULL, ?, 'active', ?, ?)
  `).run(id, content, null, importance, JSON.stringify(tags), hash);

  const row = db.prepare("SELECT rowid FROM memories WHERE id = ?").get(id);
  db.prepare(
    "INSERT INTO memories_fts(rowid, content, fact_summary) VALUES (?, ?, ?)"
  ).run(row.rowid, content, "");

  process.stderr.write(`[loom-cli] captured: ${id.slice(0, 6)} ${tags.join(",")}\n`);
}

// ── Main ────────────────────────────────────────────────

const cmd = process.argv[2];
switch (cmd) {
  case "context":
    cmdContext();
    break;
  case "context-inject":
    cmdContextInject();
    break;
  case "store":
    cmdStore();
    break;
  case "capture":
    cmdCapture();
    break;
  case "cleanup":
    cmdCleanup();
    break;
  case "guard":
    cmdGuard();
    break;
  case "unlock":
    cmdUnlock();
    break;
  default:
    process.stderr.write(`[loom-cli] unknown command: ${cmd}\n`);
    process.stderr.write("Commands: context | context-inject | store | capture | cleanup | guard | unlock\n");
    process.exit(1);
}
