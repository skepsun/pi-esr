/**
 * pi-esr: Engineering State Runtime Plugin for Pi Agent
 *
 * Pi adapter — imports the framework-agnostic @pi-esr/core engine
 * and wires it to pi's extension API (tools, commands, persistence, prompts).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryStore } from "../packages/core/src/store.js";
import {
  ESRGraph,
  setCurrentSessionId,
  getCurrentSessionId,
} from "./core";
import {
  createMemoryProvider,
  detectMemoryCapabilities,
  type ESRMemoryProvider,
  selectMemoryProvider,
  SqliteMemoryProvider,
} from "./memory-bridge";
import { registerCommands, setMemoryStoreForCommands } from "./integration/commands";
import { registerTools } from "./integration/tools";
import { reconstructGraph } from "./persistence/reconstruct";
import { buildStaticPrompt } from "./prompt";

async function getMemoryStore(): Promise<MemoryStore | null> {
  try {
    const { MemoryStore: Store } = await import("../packages/core/src/store.js");
    return new Store();
  } catch {
    return null;
  }
}

async function getMemoryProvider(): Promise<ESRMemoryProvider> {
  const report = detectMemoryCapabilities({
    cwd: process.cwd(),
    env: process.env,
    packageJson: readRootPackageJson(),
    hostHints: ["pi"],
  });
  const store = await getMemoryStore();
  return createMemoryProvider({
    report,
    sqliteStore: store,
  });
}

function captureSessionId(ctx: ExtensionContext): void {
  try {
    setCurrentSessionId(ctx.sessionManager.getSessionId());
  } catch {
    setCurrentSessionId(null);
  }
}

function readRootPackageJson(): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | undefined {
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf-8");
    return JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return undefined;
  }
}

export default async function (pi: ExtensionAPI) {
  const graph = new ESRGraph();
  const memoryReport = detectMemoryCapabilities({
    cwd: process.cwd(),
    env: process.env,
    packageJson: readRootPackageJson(),
    hostHints: ["pi"],
  });
  const selectedMemoryProvider = selectMemoryProvider(memoryReport);

  console.error(
    `[pi-esr] Memory capability: status=${memoryReport.status} confidence=${memoryReport.confidence.toFixed(2)} kinds=${memoryReport.kinds.join(",") || "none"} provider=${selectedMemoryProvider}`,
  );

  // ── Session startup protocol: enforce esr_get_context ──
  // Blocks non-ESR, non-loom tools until state graph is loaded.
  // (loom protocol enforced independently in pi-loom)

  let esrContextLoaded = false;

  pi.on("session_start", () => { esrContextLoaded = false; });

  pi.on("tool_call", (event) => {
    if (event.toolName === "esr_get_context") { esrContextLoaded = true; return; }
    if (event.toolName.startsWith("esr_")) return;  // allow all ESR tools
    if (event.toolName.startsWith("loom_")) return; // allow loom tools (own protocol in pi-loom)

    if (!esrContextLoaded) {
      console.error(`[pi-esr] Protocol: blocked ${event.toolName} — esr_get_context not yet called`);
      return { block: true, reason: "Session protocol: call esr_get_context() first to load state graph" };
    }
  });

  // ── Event handlers ────────────────────────────────────

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    captureSessionId(ctx);
    await reconstructGraph(ctx, graph);
  });

  pi.on("session_tree", async (_event, ctx: ExtensionContext) => {
    captureSessionId(ctx);
    await reconstructGraph(ctx, graph);
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    // Only inject STATIC methodology (ontology, rules, protocol).
    // Dynamic state (entities, relations, tasks, memories) is fetched
    // on-demand via esr_get_context to preserve prompt-cache stability.
    const staticPrompt = buildStaticPrompt();
    return { systemPrompt: event.systemPrompt + staticPrompt };
  });

  // ── Tools & commands ──────────────────────────────────

  await registerTools(pi, graph);
  registerCommands(pi, graph);

  // ── Auto-journal (memory) ─────────────────────────────

  getMemoryProvider().then(async (provider) => {
    setMemoryStoreForCommands(provider);
    if (!(provider instanceof SqliteMemoryProvider)) return;
    const mem = provider.getStore();
    try {
      graph.setStateChangeHook((entityId, oldState, newState, label) => {
        const transition = `${oldState} → ${newState}`;
        const sessionId = getCurrentSessionId();
        const sessionTag = sessionId ? `session:${sessionId}` : null;
        const baseTags = sessionTag
          ? ["state-transition", `from:${oldState}`, `to:${newState}`, sessionTag]
          : ["state-transition", `from:${oldState}`, `to:${newState}`];

        mem.journal(entityId, transition);
        const desc = label ? ` ${label}` : "";
        mem.store(entityId, `${transition}${desc}`, { tags: baseTags });
        if (newState === "stable") {
          const entity = graph.getEntity(entityId);
          if (entity?.role === "Task") {
            const metrics = Object.entries(entity.metrics)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ");
            const completeTags = sessionTag
              ? ["task-completed", "stable", sessionTag]
              : ["task-completed", "stable"];
            mem.store(entityId, `Task completed: ${entity.label ?? entityId}${metrics ? ` (${metrics})` : ""}`, {
              tags: completeTags,
            });
          }
        }
      });

      const { registerMemoryTools } = await import("./memory/tools");
      registerMemoryTools(pi, provider);
    } catch (err) {
      console.error("[pi-esr] Memory layer init failed:", err);
    }
  });
}
