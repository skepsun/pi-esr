/**
 * pi-esr CLI: Auto-setup for all supported coding agents
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const HOME = homedir();

interface SetupResult {
  agent: string;
  status: "configured" | "already" | "not-found" | "error";
  message: string;
}

// ── Detection ──────────────────────────────────────────

function which(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasDir(path: string): boolean {
  return existsSync(path);
}

function hasFile(path: string): boolean {
  return existsSync(path);
}

// ── Config generators ──────────────────────────────────

function mcpServerConfig(): object {
  return {
    command: "npx",
    args: ["@pi-esr/adapter-mcp"],
  };
}

function cursorMCPConfig(): object {
  return {
    mcpServers: {
      "pi-esr": {
        command: "npx",
        args: ["@pi-esr/adapter-mcp"],
      },
    },
  };
}

function claudeMCPConfig(): string {
  return JSON.stringify({
    mcpServers: {
      "pi-esr": {
        command: "npx",
        args: ["@pi-esr/adapter-mcp"],
      },
    },
  }, null, 2);
}

function opencodeMCPConfig(): string {
  return JSON.stringify({
    mcp: {
      "pi-esr": {
        type: "local",
        command: ["npx", "@pi-esr/adapter-mcp"],
        enabled: true,
        timeout: 5000,
      },
    },
  }, null, 2);
}

// ── Setup functions ─────────────────────────────────────

function setupCursor(): SetupResult {
  const dir = join(HOME, ".cursor");
  const file = join(dir, "mcp.json");

  if (!hasDir(HOME)) {
    return { agent: "Cursor", status: "not-found", message: "Home directory not found" };
  }

  let existing: Record<string, unknown> = {};
  if (hasFile(file)) {
    try {
      existing = JSON.parse(readFileSync(file, "utf-8"));
    } catch { /* start fresh */ }
  }

  const servers = (existing.mcpServers as Record<string, unknown>) ?? {};
  if (servers["pi-esr"]) {
    return { agent: "Cursor", status: "already", message: `Already configured in ${file}` };
  }

  mkdirSync(dir, { recursive: true });
  const config = cursorMCPConfig();
  const merged = { ...existing, mcpServers: { ...existing.mcpServers as object, ...(config as any).mcpServers } };
  writeFileSync(file, JSON.stringify(merged, null, 2), "utf-8");
  return { agent: "Cursor", status: "configured", message: `Written to ${file}` };
}

function setupClaude(): SetupResult {
  if (!which("claude")) {
    return { agent: "Claude Code", status: "not-found", message: "claude CLI not found. Install: npm install -g @anthropic-ai/claude-code" };
  }

  try {
    // Check if already registered
    const list = execSync("claude mcp list 2>/dev/null || true", { encoding: "utf-8" });
    if (list.includes("pi-esr")) {
      return { agent: "Claude Code", status: "already", message: "Already registered" };
    }

    execSync("claude mcp add pi-esr -- npx @pi-esr/adapter-mcp", { stdio: "inherit" });
    return { agent: "Claude Code", status: "configured", message: "Registered via claude mcp add" };
  } catch (e: any) {
    return { agent: "Claude Code", status: "error", message: e.message ?? String(e) };
  }
}

function setupOpenCode(): SetupResult {
  const dir = join(HOME, ".opencode");
  const file = join(dir, "opencode.json");

  let existing: Record<string, unknown> = {};
  if (hasFile(file)) {
    try {
      existing = JSON.parse(readFileSync(file, "utf-8"));
    } catch { /* start fresh */ }
  }

  const mcpServers = (existing.mcp as Record<string, unknown>) ?? {};
  if (mcpServers["pi-esr"]) {
    return { agent: "OpenCode", status: "already", message: `Already configured in ${file}` };
  }

  mkdirSync(dir, { recursive: true });
  const config = JSON.parse(opencodeMCPConfig());
  const merged = { ...existing, mcp: { ...mcpServers, ...config.mcp } };
  writeFileSync(file, JSON.stringify(merged, null, 2), "utf-8");
  return { agent: "OpenCode", status: "configured", message: `Written to ${file}` };
}

function setupPi(): SetupResult {
  const cwd = process.cwd();
  const pirc = join(cwd, ".pirc.json");

  if (hasFile(pirc)) {
    try {
      const existing = JSON.parse(readFileSync(pirc, "utf-8"));
      const plugins: string[] = existing.plugins ?? [];
      if (plugins.includes("pi-esr")) {
        return { agent: "Pi Agent", status: "already", message: `Already in ${pirc}` };
      }
      existing.plugins = [...plugins, "pi-esr"];
      writeFileSync(pirc, JSON.stringify(existing, null, 2), "utf-8");
      return { agent: "Pi Agent", status: "configured", message: `Added to ${pirc}` };
    } catch { /* fall through */ }
  }

  writeFileSync(pirc, JSON.stringify({ plugins: ["pi-esr"] }, null, 2), "utf-8");
  return { agent: "Pi Agent", status: "configured", message: `Created ${pirc}` };
}

// ── Main ────────────────────────────────────────────────

export function setupAll(): SetupResult[] {
  return [
    setupClaude(),
    setupCodex(),
    setupCursor(),
    setupOpenCode(),
    setupPi(),
  ];
}

export function setupOne(agent: string): SetupResult {
  switch (agent.toLowerCase()) {
    case "claude": return setupClaude();
    case "codex": return setupCodex();
    case "cursor": return setupCursor();
    case "opencode": return setupOpenCode();
    case "pi": return setupPi();
    default: return { agent, status: "error", message: `Unknown agent: ${agent}. Use: claude, codex, cursor, opencode, pi` };
  }
}

function setupCodex(): SetupResult {
  if (!which("codex")) {
    return { agent: "Codex", status: "not-found", message: "codex CLI not found. Install: npm install -g @openai/codex" };
  }

  try {
    const list = execSync("codex mcp list 2>/dev/null || true", { encoding: "utf-8" });
    if (list.includes("pi-esr")) {
      return { agent: "Codex", status: "already", message: "Already registered" };
    }

    execSync("codex mcp add pi-esr -- npx @pi-esr/adapter-mcp", { stdio: "inherit" });
    return { agent: "Codex", status: "configured", message: "Registered via codex mcp add" };
  } catch (e: any) {
    return { agent: "Codex", status: "error", message: e.message ?? String(e) };
  }
}
