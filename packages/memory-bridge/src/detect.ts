import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  DetectionContext,
  MemoryCapabilityKind,
  MemoryCapabilityReport,
  MemoryCapabilityStatus,
  MemoryEvidence,
} from "./types.js";

const FILE_RULES = [
  {
    relPath: "CLAUDE.md",
    confidence: 0.45,
    note: "Project instruction file may participate in persistent memory flow",
  },
  {
    relPath: "AGENTS.md",
    confidence: 0.35,
    note: "Project agent instruction file found",
  },
  {
    relPath: "MEMORY.md",
    confidence: 0.75,
    note: "Explicit memory file found",
  },
  {
    relPath: ".claude/rules",
    confidence: 0.8,
    note: "Claude rules directory suggests rule memory",
  },
  {
    relPath: ".pi-memory",
    confidence: 0.85,
    note: "Persistent Pi memory directory found",
  },
  {
    relPath: ".memory",
    confidence: 0.7,
    note: "Generic memory directory found",
  },
  {
    relPath: ".scratchpad",
    confidence: 0.55,
    note: "Scratchpad directory suggests working memory",
  },
  {
    relPath: ".pi-esr-memory",
    confidence: 0.5,
    note: "ESR local persistence directory found",
  },
  {
    relPath: ".pi-loom",
    confidence: 0.85,
    note: "pi-loom memory database directory found",
  },
];

const POSITIVE_TOOL_PATTERNS = [
  /memory/i,
  /recall/i,
  /journal/i,
  /timeline/i,
  /scratchpad/i,
  /note/i,
];

const NEGATIVE_TOOL_PATTERNS = [
  /grep/i,
  /ripgrep/i,
  /web[-_ ]search/i,
  /file[-_ ]search/i,
];

const KNOWN_MEMORY_PACKAGES = [
  "pi-memory",
  "claude-mem",
  "@pi/pi-memory",
  "pi-loom",
];

export function detectMemoryCapabilities(ctx: DetectionContext): MemoryCapabilityReport {
  const evidence = [
    ...detectFileEvidence(ctx),
    ...detectToolEvidence(ctx),
    ...detectConfigEvidence(ctx),
    ...detectHostHintEvidence(ctx),
  ];

  return buildCapabilityReport(evidence);
}

function detectFileEvidence(ctx: DetectionContext): MemoryEvidence[] {
  const evidence: MemoryEvidence[] = [];

  for (const rule of FILE_RULES) {
    const fullPath = join(ctx.cwd, rule.relPath);
    if (!existsSync(fullPath)) continue;

    evidence.push({
      source: "file",
      key: rule.relPath,
      value: statSafe(fullPath),
      confidence: rule.confidence,
      note: rule.note,
    });
  }

  return evidence;
}

function detectToolEvidence(ctx: DetectionContext): MemoryEvidence[] {
  const tools = ctx.tools ?? [];
  const evidence: MemoryEvidence[] = [];

  for (const tool of tools) {
    const haystack = `${tool.name} ${tool.description ?? ""}`.trim();
    if (NEGATIVE_TOOL_PATTERNS.some((pattern) => pattern.test(haystack))) continue;
    if (!POSITIVE_TOOL_PATTERNS.some((pattern) => pattern.test(haystack))) continue;

    evidence.push({
      source: "tool",
      key: tool.name,
      value: tool.description ?? "",
      confidence: inferToolConfidence(tool.name, tool.description),
      note: "Tool appears to expose memory-like capability",
    });
  }

  return evidence;
}

function detectConfigEvidence(ctx: DetectionContext): MemoryEvidence[] {
  const evidence: MemoryEvidence[] = [];
  const deps = {
    ...(ctx.packageJson?.dependencies ?? {}),
    ...(ctx.packageJson?.devDependencies ?? {}),
  };

  for (const dep of Object.keys(deps)) {
    if (!KNOWN_MEMORY_PACKAGES.includes(dep) && !dep.includes("memory")) continue;

    evidence.push({
      source: "config",
      key: "package.json",
      value: dep,
      confidence: 0.9,
      note: "Memory-related package dependency found",
    });
  }

  const mcpPath = join(ctx.cwd, ".mcp.json");
  if (!existsSync(mcpPath)) return evidence;

  try {
    const raw = readFileSync(mcpPath, "utf-8");
    if (/memory/i.test(raw) || /recall/i.test(raw)) {
      evidence.push({
        source: "config",
        key: ".mcp.json",
        value: "contains memory-related entries",
        confidence: 0.75,
        note: "MCP config mentions memory-like capability",
      });
    }
  } catch {
    // ignore invalid config during capability detection
  }

  return evidence;
}

function detectHostHintEvidence(ctx: DetectionContext): MemoryEvidence[] {
  const evidence: MemoryEvidence[] = [];
  const env = ctx.env ?? {};

  for (const key of Object.keys(env)) {
    if (/^CLAUDE_/i.test(key) || /^PI_/i.test(key) || /^CODEX_/i.test(key) || /^MEMORY_/i.test(key)) {
      evidence.push({
        source: "env",
        key,
        value: env[key] ?? "",
        confidence: 0.25,
        note: "Host-related environment hint found",
      });
    }
  }

  for (const hint of ctx.hostHints ?? []) {
    evidence.push({
      source: "host_hint",
      key: "hostHints",
      value: hint,
      confidence: 0.3,
      note: "Caller supplied host hint",
    });
  }

  return evidence;
}

function buildCapabilityReport(evidence: MemoryEvidence[]): MemoryCapabilityReport {
  const confidence = normalizeConfidence(evidence);
  const kinds = inferKinds(evidence);
  const providerHints = inferProviderHints(evidence);
  const status = inferStatus(confidence, kinds.length);

  return {
    status,
    kinds,
    providerHints,
    confidence,
    evidence: evidence.sort((a, b) => b.confidence - a.confidence),
  };
}

function normalizeConfidence(evidence: MemoryEvidence[]): number {
  if (evidence.length === 0) return 0;

  const weighted = evidence
    .map((item) => item.confidence)
    .sort((a, b) => b - a)
    .slice(0, 5);
  const sum = weighted.reduce((acc, value) => acc + value, 0);
  return Math.min(1, sum / 2.5);
}

function inferKinds(evidence: MemoryEvidence[]): MemoryCapabilityKind[] {
  const kinds = new Set<MemoryCapabilityKind>();

  for (const item of evidence) {
    const haystack = `${item.key} ${item.value} ${item.note ?? ""}`.toLowerCase();
    if (item.source === "file" && /claude\.md|agents\.md|memory\.md|rules/.test(haystack)) {
      kinds.add("rule");
    }
    if (item.source === "tool") {
      kinds.add("tool");
    }
    if ((item.source === "file" || item.source === "config") && /memory|scratchpad|pi-memory/.test(haystack)) {
      kinds.add("store");
    }
  }

  return [...kinds];
}

function inferProviderHints(evidence: MemoryEvidence[]): string[] {
  const hints = new Set<string>();

  for (const item of evidence) {
    const haystack = `${item.key} ${item.value}`.toLowerCase();
    if (haystack.includes("claude-mem")) hints.add("claude-mem");
    if (haystack.includes("pi-memory")) hints.add("pi-memory");
    if (haystack.includes("claude")) hints.add("claude");
    if (haystack.includes("codex")) hints.add("codex");
    if (haystack.includes("pi")) hints.add("pi");
  }

  return [...hints];
}

function inferStatus(confidence: number, kindCount: number): MemoryCapabilityStatus {
  if (confidence >= 0.75 && kindCount > 0) return "available";
  if (confidence >= 0.4) return "likely";
  if (confidence > 0) return "unknown";
  return "none";
}

function inferToolConfidence(name: string, description?: string): number {
  const haystack = `${name} ${description ?? ""}`.toLowerCase();
  if (haystack.includes("memory_write") || haystack.includes("memory_read")) return 0.95;
  if (haystack.includes("memory_search")) return 0.9;
  if (haystack.includes("timeline") || haystack.includes("journal")) return 0.8;
  if (haystack.includes("note")) return 0.65;
  return 0.7;
}

function statSafe(path: string): string {
  try {
    return statSync(path).isDirectory() ? "directory" : "file";
  } catch {
    return "unknown";
  }
}
