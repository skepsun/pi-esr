/**
 * pi-esr CLI: Auto-setup for all supported coding agents
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, parse, resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const __dirname = dirname(fileURLToPath(import.meta.url));

interface SetupResult {
  agent: string;
  status: "configured" | "already" | "not-found" | "error";
  message: string;
}

interface SetupDeps {
  cwd(): string;
  exec(command: string, options?: { encoding?: BufferEncoding; stdio?: "ignore" | "inherit" }): string;
  hasCommand(command: string): boolean;
}

const defaultDeps: SetupDeps = {
  cwd: () => process.cwd(),
  exec: (command, options) => {
    const result = execSync(command, options as Parameters<typeof execSync>[1]);
    return result ? result.toString() : "";
  },
  hasCommand: which,
};

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

interface MCPLaunchSpec {
  command: string;
  args: string[];
  mode: "local" | "package";
}

function findPluginDir(): string {
  // Prefer cwd if it has the plugin structure (repo development)
  if (existsSync(join(process.cwd(), ".claude-plugin", "plugin.json"))) return process.cwd();
  // Walk up from dist/ until we find .claude-plugin/plugin.json
  let dir = dirname(fileURLToPath(import.meta.url));
  const root = parse(dir).root;
  while (dir !== root) {
    if (existsSync(join(dir, ".claude-plugin", "plugin.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function resolveMCPLaunchSpec(cwd: string = process.cwd()): MCPLaunchSpec {
  const pluginDir = findPluginDir();
  const localDist = resolve(pluginDir, "packages/adapter-mcp/dist/server.js");
  if (existsSync(localDist) && cwd.startsWith(pluginDir)) {
    return {
      command: "node",
      args: [localDist],
      mode: "local",
    };
  }
  return {
    command: "npx",
    args: ["@pi-esr/adapter-mcp"],
    mode: "package",
  };
}

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

function buildMCPAddCommand(client: "claude" | "codex", spec: MCPLaunchSpec): string {
  const args = spec.args.map(shellQuote).join(" ");
  return `${client} mcp add pi-esr -- ${shellQuote(spec.command)}${args ? ` ${args}` : ""}`;
}



// ── Config generators ──────────────────────────────────

function mcpServerConfig(): object {
  const spec = resolveMCPLaunchSpec();
  return {
    command: spec.command,
    args: spec.args,
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
  const spec = resolveMCPLaunchSpec();
  return JSON.stringify({
    mcpServers: {
      "pi-esr": {
        command: spec.command,
        args: spec.args,
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

// ── Status functions (read-only, no side effects) ────────

function statusCursor(): SetupResult {
  const dir = join(HOME, ".cursor");
  const file = join(dir, "mcp.json");
  if (hasFile(file)) {
    try {
      const existing = JSON.parse(readFileSync(file, "utf-8"));
      const servers = existing.mcpServers as Record<string, unknown> | undefined;
      if (servers?.["pi-esr"]) return { agent: "Cursor", status: "already", message: `Configured in ${file}` };
    } catch { /* invalid JSON */ }
  }
  return { agent: "Cursor", status: "not-found", message: "Not configured" };
}

function statusClaude(): SetupResult {
  if (!which("claude")) {
    return { agent: "Claude Code", status: "not-found", message: "claude CLI not installed" };
  }
  try {
    const list = execSync("claude mcp list 2>/dev/null || true", { encoding: "utf-8" });
    if (list.includes("pi-esr")) {
      return { agent: "Claude Code", status: "already", message: "Registered" };
    }
    return { agent: "Claude Code", status: "not-found", message: "Not registered" };
  } catch {
    return { agent: "Claude Code", status: "error", message: "Could not check status" };
  }
}

function statusOpenCode(): SetupResult {
  const file = join(HOME, ".opencode", "opencode.json");
  if (hasFile(file)) {
    try {
      const existing = JSON.parse(readFileSync(file, "utf-8"));
      const mcp = existing.mcp as Record<string, unknown> | undefined;
      if (mcp?.["pi-esr"]) return { agent: "OpenCode", status: "already", message: `Configured in ${file}` };
    } catch { /* invalid JSON */ }
  }
  return { agent: "OpenCode", status: "not-found", message: "Not configured" };
}

function statusCodex(): SetupResult {
  if (!which("codex")) {
    return { agent: "Codex", status: "not-found", message: "codex CLI not installed" };
  }
  try {
    const list = execSync("codex mcp list 2>/dev/null || true", { encoding: "utf-8" });
    if (list.includes("pi-esr")) {
      return { agent: "Codex", status: "already", message: "Registered" };
    }
    return { agent: "Codex", status: "not-found", message: "Not registered" };
  } catch {
    return { agent: "Codex", status: "error", message: "Could not check status" };
  }
}

function statusPi(): SetupResult {
  const pirc = join(process.cwd(), ".pirc.json");
  if (hasFile(pirc)) {
    try {
      const existing = JSON.parse(readFileSync(pirc, "utf-8"));
      const plugins: string[] = existing.plugins ?? [];
      if (plugins.includes("pi-esr")) {
        return { agent: "Pi Agent", status: "already", message: `Configured in ${pirc}` };
      }
    } catch { /* invalid JSON */ }
  }
  return { agent: "Pi Agent", status: "not-found", message: "Not configured" };
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

function setupClaude(deps: SetupDeps = defaultDeps): SetupResult {
  if (!deps.hasCommand("claude")) {
    return { agent: "Claude Code", status: "not-found", message: "claude CLI not found. Install: npm install -g @anthropic-ai/claude-code" };
  }

  try {
    const list = deps.exec("claude mcp list 2>/dev/null || true", { encoding: "utf-8" });
    const alreadyRegistered = list.includes("pi-esr");
    const spec = resolveMCPLaunchSpec(deps.cwd());
    if (!alreadyRegistered) {
      deps.exec(buildMCPAddCommand("claude", spec), { stdio: "inherit" });
    }
    return {
      agent: "Claude Code",
      status: alreadyRegistered ? "already" : "configured",
      message: alreadyRegistered
        ? "MCP already registered"
        : spec.mode === "local"
          ? "Registered via claude mcp add (local dist)"
          : "Registered via claude mcp add (npx package)",
    };
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

// ── Remove functions ────────────────────────────────────

function removeCursor(): SetupResult {
  const file = join(HOME, ".cursor", "mcp.json");
  if (!hasFile(file)) return { agent: "Cursor", status: "not-found", message: "No config file" };
  try {
    const existing = JSON.parse(readFileSync(file, "utf-8"));
    if (existing.mcpServers && typeof existing.mcpServers === "object") {
      delete (existing.mcpServers as Record<string, unknown>)["pi-esr"];
      writeFileSync(file, JSON.stringify(existing, null, 2), "utf-8");
      return { agent: "Cursor", status: "configured", message: `Removed from ${file}` };
    }
    return { agent: "Cursor", status: "not-found", message: "Not configured" };
  } catch {
    return { agent: "Cursor", status: "error", message: "Failed to read config" };
  }
}

function removeClaude(deps: SetupDeps = defaultDeps): SetupResult {
  if (!deps.hasCommand("claude")) {
    return {
      agent: "Claude Code",
      status: "not-found",
      message: "claude CLI not installed",
    };
  }
  try {
    deps.exec("claude mcp remove pi-esr 2>/dev/null || true", { stdio: "ignore" });
    return {
      agent: "Claude Code",
      status: "configured",
      message: "Removed",
    };
  } catch (e: any) {
    return { agent: "Claude Code", status: "error", message: e.message ?? String(e) };
  }
}

function removeOpenCode(): SetupResult {
  const file = join(HOME, ".opencode", "opencode.json");
  if (!hasFile(file)) return { agent: "OpenCode", status: "not-found", message: "No config file" };
  try {
    const existing = JSON.parse(readFileSync(file, "utf-8"));
    if (existing.mcp && typeof existing.mcp === "object") {
      delete (existing.mcp as Record<string, unknown>)["pi-esr"];
      writeFileSync(file, JSON.stringify(existing, null, 2), "utf-8");
      return { agent: "OpenCode", status: "configured", message: `Removed from ${file}` };
    }
    return { agent: "OpenCode", status: "not-found", message: "Not configured" };
  } catch {
    return { agent: "OpenCode", status: "error", message: "Failed to read config" };
  }
}

function removeCodex(deps: SetupDeps = defaultDeps): SetupResult {
  if (!deps.hasCommand("codex")) {
    return {
      agent: "Codex",
      status: "not-found",
      message: "codex CLI not installed",
    };
  }
  try {
    deps.exec("codex mcp remove pi-esr 2>/dev/null || true", { stdio: "ignore" });
    return {
      agent: "Codex",
      status: "configured",
      message: "Removed",
    };
  } catch (e: any) {
    return { agent: "Codex", status: "error", message: e.message ?? String(e) };
  }
}

function removePi(): SetupResult {
  const pirc = join(process.cwd(), ".pirc.json");
  if (!hasFile(pirc)) return { agent: "Pi Agent", status: "not-found", message: "No .pirc.json" };
  try {
    const existing = JSON.parse(readFileSync(pirc, "utf-8"));
    const plugins: string[] = existing.plugins ?? [];
    const filtered = plugins.filter(p => p !== "pi-esr");
    if (filtered.length === plugins.length) {
      return { agent: "Pi Agent", status: "not-found", message: "Not in .pirc.json" };
    }
    existing.plugins = filtered;
    writeFileSync(pirc, JSON.stringify(existing, null, 2), "utf-8");
    return { agent: "Pi Agent", status: "configured", message: `Removed from ${pirc}` };
  } catch {
    return { agent: "Pi Agent", status: "error", message: "Failed to read .pirc.json" };
  }
}

export function removeAll(): SetupResult[] {
  return [removeClaude(), removeCodex(), removeCursor(), removeOpenCode(), removePi()];
}

export function removeOne(agent: string): SetupResult {
  switch (agent.toLowerCase()) {
    case "claude": return removeClaude();
    case "codex": return removeCodex();
    case "cursor": return removeCursor();
    case "opencode": return removeOpenCode();
    case "pi": return removePi();
    default: return { agent, status: "error", message: `Unknown agent: ${agent}` };
  }
}

// ── Main ────────────────────────────────────────────────

/** Check status only — no side effects, no file writes. */
export function statusAll(): SetupResult[] {
  return [
    statusClaude(),
    statusCodex(),
    statusCursor(),
    statusOpenCode(),
    statusPi(),
  ];
}

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

function setupCodex(deps: SetupDeps = defaultDeps): SetupResult {
  if (!deps.hasCommand("codex")) {
    return { agent: "Codex", status: "not-found", message: "codex CLI not found. Install: npm install -g @openai/codex" };
  }

  try {
    const list = deps.exec("codex mcp list 2>/dev/null || true", { encoding: "utf-8" });
    const alreadyRegistered = list.includes("pi-esr");
    const spec = resolveMCPLaunchSpec(deps.cwd());
    if (!alreadyRegistered) {
      deps.exec(buildMCPAddCommand("codex", spec), { stdio: "inherit" });
    }
    return {
      agent: "Codex",
      status: alreadyRegistered ? "already" : "configured",
      message: alreadyRegistered
        ? "MCP already registered"
        : spec.mode === "local"
          ? "Registered via codex mcp add (local dist)"
          : "Registered via codex mcp add (npx package)",
    };
  } catch (e: any) {
    return { agent: "Codex", status: "error", message: e.message ?? String(e) };
  }
}

// ── Plugin management functions ──────────────────────

function mergeInstallWithSetup(
  install: SetupResult,
  setup: SetupResult,
  fallbackConfiguredMessage: string,
): SetupResult {
  if (install.status === "error" || setup.status === "error") {
    return install.status === "error" ? install : setup;
  }
  if (install.status === "not-found" || setup.status === "not-found") {
    return install.status === "not-found" ? install : setup;
  }

  const installMessage = install.message;
  const setupMessage = setup.message;
  const status =
    install.status === "configured" || setup.status === "configured"
      ? "configured"
      : "already";
  const message =
    installMessage === setupMessage
      ? installMessage
      : `${installMessage}; ${setupMessage}` || fallbackConfiguredMessage;

  return {
    agent: install.agent,
    status,
    message,
  };
}

function pluginInstallClaude(): SetupResult {
  if (!which("claude")) return { agent: "Claude Code", status: "error", message: "claude CLI not found" };
  const pluginDir = findPluginDir();
  try {
    execSync(`claude plugin marketplace add ${JSON.stringify(pluginDir)} 2>/dev/null || true`, { stdio: "pipe" });
    const out = execSync("claude plugin install pi-esr 2>&1", { encoding: "utf-8" });
    const installResult: SetupResult = out.includes("already installed")
      ? { agent: "Claude Code", status: "already", message: "Plugin already installed" }
      : { agent: "Claude Code", status: "configured", message: `Plugin installed from ${pluginDir}` };
    const setupResult = setupClaude();
    return mergeInstallWithSetup(installResult, setupResult, "Plugin installed and MCP registered");
  } catch (e: any) {
    return { agent: "Claude Code", status: "error", message: e.message ?? String(e) };
  }
}

function pluginInstallCodex(): SetupResult {
  if (!which("codex")) return { agent: "Codex", status: "error", message: "codex CLI not found" };
  const pluginDir = findPluginDir();
  try {
    execSync(`codex plugin marketplace add ${JSON.stringify(pluginDir)} 2>/dev/null || true`, { stdio: "pipe" });
    const out = execSync("codex plugin add pi-esr@pi-esr 2>&1", { encoding: "utf-8" });
    const installResult: SetupResult = out.includes("already installed")
      ? { agent: "Codex", status: "already", message: "Plugin already installed" }
      : { agent: "Codex", status: "configured", message: `Plugin installed from ${pluginDir}` };
    const setupResult = setupCodex();
    return mergeInstallWithSetup(installResult, setupResult, "Plugin installed and MCP registered");
  } catch (e: any) {
    return { agent: "Codex", status: "error", message: e.message ?? String(e) };
  }
}

function pluginInstallPi(): SetupResult {
  if (!which("pi")) return { agent: "Pi Agent", status: "error", message: "pi CLI not found" };
  // cli.js is at dist/cli.js — root package is 2 levels up
  const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
  // In npm installs, dist/extensions/index.js exists at root. In dev, fall back to findPluginDir.
  const installDir = existsSync(join(rootDir, "dist", "extensions", "index.js"))
    ? rootDir
    : findPluginDir();
  try {
    const out = execSync(`pi install -l ${JSON.stringify(installDir)} 2>&1 || true`, { encoding: "utf-8" });
    if (out.includes("already installed")) return { agent: "Pi Agent", status: "already", message: "Already installed" };
    return { agent: "Pi Agent", status: "configured", message: `Installed from ${installDir}` };
  } catch (e: any) {
    return { agent: "Pi Agent", status: "error", message: e.message ?? String(e) };
  }
}

function pluginRemoveClaude(): SetupResult {
  if (!which("claude")) return { agent: "Claude Code", status: "not-found", message: "claude CLI not found" };
  try {
    execSync("claude plugin uninstall pi-esr 2>&1 || true", { encoding: "utf-8" });
    return { agent: "Claude Code", status: "configured", message: "Plugin uninstalled" };
  } catch (e: any) {
    return { agent: "Claude Code", status: "error", message: e.message ?? String(e) };
  }
}

function pluginRemoveCodex(): SetupResult {
  if (!which("codex")) return { agent: "Codex", status: "not-found", message: "codex CLI not found" };
  try {
    execSync("codex plugin remove pi-esr@pi-esr 2>&1 || true", { encoding: "utf-8" });
    return { agent: "Codex", status: "configured", message: "Plugin uninstalled" };
  } catch (e: any) {
    return { agent: "Codex", status: "error", message: e.message ?? String(e) };
  }
}

function pluginRemovePi(): SetupResult {
  if (!which("pi")) return { agent: "Pi Agent", status: "not-found", message: "pi CLI not found" };
  try {
    execSync("pi remove pi-esr 2>&1 || true", { encoding: "utf-8" });
    return { agent: "Pi Agent", status: "configured", message: "Plugin removed" };
  } catch (e: any) {
    return { agent: "Pi Agent", status: "error", message: e.message ?? String(e) };
  }
}

function pluginStatusClaude(): SetupResult {
  if (!which("claude")) return { agent: "Claude Code", status: "not-found", message: "claude CLI not installed" };
  try {
    const list = execSync("claude plugin list 2>&1 || true", { encoding: "utf-8" });
    const lines = list.split("\n");
    const idx = lines.findIndex(l => l.includes("pi-esr@"));
    if (idx === -1) return { agent: "Claude Code", status: "not-found", message: "Not installed" };
    const statusLine = lines.slice(idx, idx + 5).find(l => l.includes("Status:"));
    if (statusLine?.includes("enabled")) return { agent: "Claude Code", status: "already", message: "Plugin enabled" };
    return { agent: "Claude Code", status: "already", message: "Plugin installed (may be disabled)" };
  } catch {
    return { agent: "Claude Code", status: "error", message: "Could not check status" };
  }
}

function pluginStatusCodex(): SetupResult {
  if (!which("codex")) return { agent: "Codex", status: "not-found", message: "codex CLI not installed" };
  try {
    const list = execSync("codex plugin list 2>&1 || true", { encoding: "utf-8" });
    const lines = list.split("\n");
    const piLine = lines.find(l => l.includes("pi-esr@"));
    if (!piLine) return { agent: "Codex", status: "not-found", message: "Not installed" };
    if (piLine.includes("enabled")) return { agent: "Codex", status: "already", message: "Plugin enabled" };
    if (piLine.includes("not installed")) return { agent: "Codex", status: "not-found", message: "Not installed (marketplace entry exists)" };
    return { agent: "Codex", status: "already", message: "Plugin installed (may be disabled)" };
  } catch {
    return { agent: "Codex", status: "error", message: "Could not check status" };
  }
}

function pluginStatusPi(): SetupResult {
  const pirc = join(process.cwd(), ".pirc.json");
  if (existsSync(pirc)) {
    try {
      const data = JSON.parse(readFileSync(pirc, "utf-8"));
      if ((data.plugins ?? []).includes("pi-esr")) {
        return { agent: "Pi Agent", status: "already", message: "Installed (project-local)" };
      }
    } catch { /* ignore */ }
  }
  if (which("pi")) {
    try {
      const list = execSync("pi list 2>&1 || true", { encoding: "utf-8" });
      if (list.includes("pi-esr")) return { agent: "Pi Agent", status: "already", message: "Installed (user-level)" };
    } catch { /* ignore */ }
  }
  return { agent: "Pi Agent", status: "not-found", message: "Not installed" };
}

export function pluginInstallAll(): SetupResult[] {
  return [pluginInstallClaude(), pluginInstallCodex(), pluginInstallPi()];
}

export function pluginInstallOne(agent: string): SetupResult {
  switch (agent.toLowerCase()) {
    case "claude": return pluginInstallClaude();
    case "codex": return pluginInstallCodex();
    case "pi": return pluginInstallPi();
    default: return { agent, status: "error", message: `Unknown agent: ${agent}. Use: claude, codex, pi` };
  }
}

export function pluginRemoveAll(): SetupResult[] {
  return [pluginRemoveClaude(), pluginRemoveCodex(), pluginRemovePi()];
}

export function pluginRemoveOne(agent: string): SetupResult {
  switch (agent.toLowerCase()) {
    case "claude": return pluginRemoveClaude();
    case "codex": return pluginRemoveCodex();
    case "pi": return pluginRemovePi();
    default: return { agent, status: "error", message: `Unknown agent: ${agent}. Use: claude, codex, pi` };
  }
}

export function pluginStatusAll(): SetupResult[] {
  return [pluginStatusClaude(), pluginStatusCodex(), pluginStatusPi()];
}

export const __test__ = {
  removeClaude,
  removeCodex,
  setupClaude,
  setupCodex,
};
