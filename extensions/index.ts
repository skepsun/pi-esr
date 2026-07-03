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
  HostMemoryProvider,
  type ESRMemoryProvider,
  selectMemoryProvider,
  SqliteMemoryProvider,
  tryCreateLoomDelegate,
} from "./memory-bridge";
import { registerCommands, setMemoryStoreForCommands } from "./integration/commands";
import { registerTools } from "./integration/tools";
import { ESROverlay } from "./overlay/widget.js";
import { reconstructGraph } from "./persistence/reconstruct";
import { buildESRPrompt } from "./prompt";
import { buildPackApplyPlan, createRegistry, detectBestPack } from "../packages/domain-pack/src/index.js";
import { persistGraph } from "./persistence/snapshot";

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
  const provider = createMemoryProvider({
    report,
    sqliteStore: store,
  });

  // Bridge: if pi-loom is detected, wire its LoomMemoryProvider into the
  // HostMemoryDelegate so ESR memory operations go through pi-loom's store.
  if (provider instanceof HostMemoryProvider) {
    const loomDelegate = await tryCreateLoomDelegate(process.cwd());
    if (loomDelegate) {
      return new HostMemoryProvider(provider.name, loomDelegate);
    }
  }

  return provider;
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

  // ── Session startup protocol ────────────────────────
  // No hard block — the model is told via system prompt to call
  // esr_get_context. It will do so when ESR features are needed.
  // Removing the block preserves prompt-cache stability: every
  // turn's system prompt is identical (static methodology only).

  // ── Overlay widget ───────────────────────────────────

  let esrOverlay: ESROverlay | undefined;

  // ── Pack system ──────────────────────────────────────

  const { registry: packRegistry } = await createRegistry();
  const packs = packRegistry.list();
  const expandedPackNames = new Set<string>();

  // ── Auto-expand packs on first turn ──────────────────
  // When a user goal matches a domain pack, auto-expand it into
  // ESR entities. The model sees entities as pre-existing facts —
  // no manual esr_detect_pack / esr_expand_with_pack needed.
  // Re-expansion is suppressed per pack per session.

  let packAutoExpandedThisSession = false;

  // Auto-detect rpiv-todo coexistence: when todo tool calls are observed,
  // switch to compact mode so both widgets fit above the editor.
  pi.on("tool_call", (event) => {
    if (event.toolName === "todo" && esrOverlay) {
      esrOverlay.setMaxLines(6);
    }
  });

  // ── Build ESR snapshot ───────────────────────────────
  // Compact state summary injected into system prompt so the model
  // sees active tasks & constraints without needing esr_get_context first.

  function buildStateSummary(): string {
    const entities = graph.getAllEntities();
    const tasks = entities.filter((e) => e.role === "Task");
    const constraints = entities.filter((e) => e.role === "Constraint");
    const relations = graph.getAllRelations();

    const lines: string[] = [];

    if (tasks.length === 0 && constraints.length === 0) {
      lines.push("(empty graph — create entities via esr_create_entity)");
      return lines.join("\n");
    }

    if (tasks.length > 0) {
      lines.push(`Active tasks (${tasks.length}):`);
      for (const t of tasks) {
        const r = relations.filter((rel) => rel.type === "validates" && rel.to === t.entity_id);
        const cLabels = r.length > 0 ? ` [constrained by: ${r.map((rel) => rel.from.replace("constraint-", "")).join(", ")}]` : "";
        lines.push(`  ${t.entity_id} [${t.state}] ${t.label || ""}${cLabels}`);
      }
    }

    if (constraints.length > 0) {
      lines.push(`Constraints (${constraints.length}):`);
      for (const c of constraints) {
        const targets = relations.filter((rel) => rel.type === "validates" && rel.from === c.entity_id);
        lines.push(`  ${c.entity_id} → ${targets.map((t) => t.to).join(", ")}: ${c.label || ""}`);
      }
    }

    return lines.join("\n");
  }

  // ── Event handlers ────────────────────────────────────

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    packAutoExpandedThisSession = false;
    captureSessionId(ctx);
    await reconstructGraph(ctx, graph);
    if (ctx.hasUI) {
      esrOverlay ??= new ESROverlay(graph);
      esrOverlay.setUICtx(ctx.ui);
      esrOverlay.resetCompletedDisplayState();
      esrOverlay.update();
    }
  });

  pi.on("session_tree", async (_event, ctx: ExtensionContext) => {
    packAutoExpandedThisSession = false;
    captureSessionId(ctx);
    await reconstructGraph(ctx, graph);
    esrOverlay?.resetCompletedDisplayState();
    esrOverlay?.update();
  });

  pi.on("agent_start", async () => {
    esrOverlay?.hideCompletedTasksFromPreviousTurn();
  });

  pi.on("session_shutdown", async () => {
    esrOverlay?.dispose();
    esrOverlay = undefined;
  });

  // Refresh overlay after any ESR tool executes
  pi.on("tool_execution_end", async (event) => {
    if (event.toolName.startsWith("esr_") && !event.isError) {
      esrOverlay?.update();
    }
  });

  // ── Auto-capture: flight-data-recorder for ESR ───────
  // Captures file mutations and test results automatically so
  // the model doesn't need to manually call esr_* tools.
  //
  // Principles against over-recording:
  //   • Only Write/Edit tools (not Read/ls/grep)
  //   • Dedup: same file within 5s → merged into one artifact
  //   • Only Bash with test-like commands (test/vitest/jest/typecheck/lint)
  //   • npm install / git / cd / ls / echo / cat → never captured
  //   • At most one auto-task per session (first meaningful prompt)

  const pendingInputs = new Map<string, any>(); // toolCallId → input args
  const touchedFiles = new Map<string, number>();
  const AUTO_DEDUP_MS = 5000;

  function isSubstantialMutation(toolName: string): boolean {
    return toolName === "write" || toolName === "edit";
  }

  function isTestLikeCommand(command: string): boolean {
    if (/(npm\s+(install|update|uninstall|ci|run\s+build|run\s+bundle)|git\s+|cd\s+|ls\s|echo\s|cat\s|pwd|whoami|find\s)/.test(command)) {
      return false;
    }
    return /\b(test|vitest|jest|mocha|typecheck|lint|tsc\s)/.test(command);
  }

  function ensureAutoTask(label?: string): string | null {
    const tasks = graph.getAllEntities().filter(
      (e) => e.role === "Task" && e.state !== "stable" && e.state !== "deprecated",
    );
    if (tasks.length > 0) return tasks[0].entity_id;

    const id = "task-auto-" + Date.now().toString(36);
    const r = graph.createEntity({
      entity_id: id,
      role: "Task",
      state: "active",
      confidence: 0.3,
      metrics: {},
      label: label || "Auto-tracked work",
      updated_at: new Date().toISOString(),
    });
    if (r.ok) {
      persistGraph(pi, graph);
      esrOverlay?.update();
      return id;
    }
    return null;
  }

  pi.on("tool_call", (event) => {
    if (
      isSubstantialMutation(event.toolName) ||
      event.toolName === "bash"
    ) {
      pendingInputs.set(event.toolCallId, (event as any).input);
    }
  });

  pi.on("tool_execution_end", async (event) => {
    const input = pendingInputs.get(event.toolCallId);
    pendingInputs.delete(event.toolCallId);
    if (!input || event.isError) return;

    // ── File mutation → auto-artifact ──────────────────
    if (isSubstantialMutation(event.toolName)) {
      const filePath = input?.path as string | undefined;
      if (!filePath) return;

      const now = Date.now();
      const lastTouch = touchedFiles.get(filePath);
      if (lastTouch && now - lastTouch < AUTO_DEDUP_MS) return;
      touchedFiles.set(filePath, now);

      const taskId = ensureAutoTask();
      if (taskId) {
        graph.upsertArtifact({
          id: filePath,
          type: "code",
          sections: [{ name: "content", state: "editing" }],
        });
        graph.linkRelation(taskId, filePath, "produces");
      }
    }

    // ── Test execution → auto-evaluation ────────────────
    if (event.toolName === "bash") {
      const command: string = input?.command || "";
      if (!isTestLikeCommand(command)) return;

      const taskId = ensureAutoTask();
      if (!taskId) return;

      const exitCode: number | undefined =
        event.result?.details?.exitCode ?? event.result?.exitCode ?? 0;
      const conf = exitCode === 0 ? 0.7 : 0.3;
      graph.evaluate(taskId, "auto-test-runner", conf, {
        exit_code: exitCode ?? 0,
      });
    }

    esrOverlay?.update();
  });

  // ── Auto-create task on first meaningful prompt ──────
  let autoTaskCreated = false;

  pi.on("before_agent_start", async (event, _ctx) => {
    // Create a lightweight auto-task on the first non-trivial prompt
    // if the graph has no active tasks
    if (!autoTaskCreated && event.prompt && event.prompt.length > 10) {
      autoTaskCreated = true;
      const activeTasks = graph
        .getAllEntities()
        .filter((e) => e.role === "Task" && e.state !== "stable" && e.state !== "deprecated");
      if (activeTasks.length === 0) {
        ensureAutoTask(event.prompt.slice(0, 80));
      }
    }
    // Build ESR prompt: methodology + current state snapshot
    const stateSummary = buildStateSummary();
    let packHint = "";

    // Auto-expand domain pack on first turn of session.
    // Detects if user goal matches a known pack, expands entities into graph.
    // Pack entities become pre-existing facts — visible in next prompt.
    if (!packAutoExpandedThisSession && packs.length > 0 && event.prompt) {
      packAutoExpandedThisSession = true;
      try {
        const { pack, score } = await detectBestPack(packs, {
          prompt: event.prompt,
          cwd: process.cwd(),
          host: "pi",
        });
        if (pack && score > 0.5 && !expandedPackNames.has(pack.name)) {
          expandedPackNames.add(pack.name);
          const expansion = await pack.expand({
            goal: event.prompt,
            cwd: process.cwd(),
          });
          const validation = await pack.validate({
            context: event.prompt,
            cwd: process.cwd(),
          });
          const plan = buildPackApplyPlan(expansion, validation);

          let applied = 0;
          const taskNames: string[] = [];
          for (const entity of plan.entities) {
            const r = graph.createEntity({
              entity_id: entity.entity_id,
              role: entity.role,
              state: entity.state ?? "draft",
              confidence: entity.confidence ?? 0,
              metrics: entity.metrics ?? {},
              label: entity.label,
              updated_at: new Date().toISOString(),
            });
            if (r.ok) {
              applied++;
              if (entity.role === "Task") taskNames.push(entity.entity_id);
            }
          }
          for (const relation of plan.relations) {
            graph.linkRelation(relation.from, relation.to, relation.type);
          }
          for (const artifact of plan.artifacts) {
            graph.upsertArtifact(artifact as any);
          }
          for (const constraint of plan.constraints) {
            graph.applyConstraint(constraint.entity_id, constraint.description);
          }
          persistGraph(pi, graph);
          esrOverlay?.update();

          // Actionable pack hint: tells the model exactly what to do
          packHint = [
            `Pack auto-expanded: **${pack.name}@${pack.version}** (match ${score.toFixed(2)})`,
            `${applied} entities created in graph:`,
            ...taskNames.map((tid) => {
              const e = graph.getEntity(tid);
              return e ? `  - \`${tid}\` [${e.role}] "${e.label || ""}"` : `  - \`${tid}\``;
            }),
          ].join("\n");

          const constraintDescs = plan.constraints?.map((c: any) => c.description) ?? [];
          if (constraintDescs.length > 0) {
            packHint += `\nConstraints: ${constraintDescs.join(", ")}`;
          }

          if (plan.gaps?.length) {
            packHint += `\n\n⚠️ Validation gaps detected:`;
            for (const g of plan.gaps) {
              packHint += `\n  - ${typeof g === "string" ? g : (g as any).description ?? g}`;
            }
          }

          packHint += `\n\n→ Call \`esr_get_context()\` to see the full expanded graph. Work through each sub-task with \`esr_update_state\` and close with \`esr_complete_task\`.`;

          console.error(`[pi-esr] Auto-expanded pack "${pack.name}" score=${score.toFixed(2)}: ${applied} entities`);
        }
      } catch (err) {
        console.error("[pi-esr] Pack auto-expand failed:", err);
      }
    }

    const esrPrompt = buildESRPrompt(stateSummary, packHint);
    return { systemPrompt: event.systemPrompt + esrPrompt };
  });

  // ── Tools & commands ──────────────────────────────────

  await registerTools(pi, graph, packs);
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
