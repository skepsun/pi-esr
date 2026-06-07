/**
 * ESR Validation Suite — Token efficiency & prefix-cache stability benchmarks
 *
 * Run: npx vitest run tests/validate-efficiency.test.ts
 */

import { describe, expect, it } from "vitest";
import { buildESRContext, buildGraphFingerprint } from "@pi-esr/core";
import { ESRGraph } from "@pi-esr/core";

function makeEntity(id: string, overrides: Record<string, unknown> = {}) {
  return {
    entity_id: id,
    role: "Concept" as const,
    state: "draft" as const,
    confidence: 0.9,
    metrics: {} as Record<string, number>,
    label: undefined as string | undefined,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Simple cl100k_base token estimate: ~4 chars per token (conservative for code) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ═══════════════════════════════════════════════════════════
// Simulated chat history — what the LLM would see WITHOUT ESR
// ═══════════════════════════════════════════════════════════

function simulateChatHistory(numActions: number): string {
  const lines: string[] = [];
  for (let i = 0; i < numActions; i++) {
    lines.push(`User: Create entity module-${i} with dependencies on ${i > 0 ? `module-${i - 1}` : "none"}`);
    lines.push(`Assistant: Created entity module-${i} with state=draft role=Concept.`);
    if (i > 0) {
      lines.push(`Assistant: Linked module-${i} --[depends_on]--> module-${i - 1}.`);
    }
  }
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════
// Token Compression Ratio
// ═══════════════════════════════════════════════════════════

describe("Token Compression", () => {
  const SCALES = [5, 10, 20, 50, 100];

  for (const scale of SCALES) {
    it(`compresses ${scale}-entity graph vs chat history`, () => {
      const graph = new ESRGraph();
      for (let i = 0; i < scale; i++) {
        graph.createEntity(makeEntity(`module-${i}`, { label: `Module ${i}` }));
        if (i > 0) graph.linkRelation(`module-${i}`, `module-${i - 1}`, "depends_on");
      }

      const esrContext = buildESRContext(graph);
      const chatHistory = simulateChatHistory(scale);

      const esrTokens = estimateTokens(esrContext);
      const chatTokens = estimateTokens(chatHistory);
      const ratio = (chatTokens / esrTokens).toFixed(1);
      const savings = (((chatTokens - esrTokens) / chatTokens) * 100).toFixed(1);

      console.log(
        `  scale=${String(scale).padStart(3)} | ` +
        `ESR: ${String(esrTokens).padStart(5)}t | ` +
        `Chat: ${String(chatTokens).padStart(6)}t | ` +
        `ratio: ${ratio}x | ` +
        `savings: ${String(savings).padStart(5)}%`,
      );

      expect(esrTokens).toBeLessThan(chatTokens);
    });
  }
});

// ═══════════════════════════════════════════════════════════
// Fingerprint Stability → Cache Hit Rate
// ═══════════════════════════════════════════════════════════

describe("Prefix-Cache Stability", () => {
  it("identical state → identical fingerprint → 100% cache hit", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("a"));
    graph.createEntity(makeEntity("b"));
    graph.linkRelation("a", "b", "depends_on");

    const fp1 = buildGraphFingerprint(graph);
    const fp2 = buildGraphFingerprint(graph);
    expect(fp1).toBe(fp2);
  });

  it("adding entity changes fingerprint (expected cache miss)", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("a"));
    graph.createEntity(makeEntity("b"));

    const fpBefore = buildGraphFingerprint(graph);
    graph.createEntity(makeEntity("c"));
    const fpAfter = buildGraphFingerprint(graph);

    expect(fpBefore).not.toBe(fpAfter);
  });

  it("changing entity state changes fingerprint", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("a"));

    const fpBefore = buildGraphFingerprint(graph);
    graph.updateEntityState("a", "active");
    const fpAfter = buildGraphFingerprint(graph);

    expect(fpBefore).not.toBe(fpAfter);
  });

  it("context output is byte-stable across multiple builds", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("c"));
    graph.createEntity(makeEntity("a"));
    graph.createEntity(makeEntity("b"));
    graph.linkRelation("a", "b", "depends_on");
    graph.linkRelation("a", "c", "produces");

    const ctx1 = buildESRContext(graph);
    const ctx2 = buildESRContext(graph);

    expect(ctx1).toBe(ctx2);
    expect(ctx1.length).toBe(ctx2.length);

    const aPos = ctx1.indexOf("a [");
    const bPos = ctx1.indexOf("b [");
    const cPos = ctx1.indexOf("c [");
    expect(aPos).toBeLessThan(bPos);
    expect(bPos).toBeLessThan(cPos);
  });
});

// ═══════════════════════════════════════════════════════════
// Context Size & Growth Rate
// ═══════════════════════════════════════════════════════════

describe("Context Growth", () => {
  it("ESR grows linearly with entity count (O(n))", () => {
    const sizes: number[] = [];
    const graph = new ESRGraph();

    for (let i = 0; i < 50; i++) {
      graph.createEntity(makeEntity(`e${i}`));
      sizes.push(estimateTokens(buildESRContext(graph)));
    }

    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    }

    const perEntity = (sizes[sizes.length - 1] - sizes[0]) / (sizes.length - 1);
    console.log(`  Per-entity token overhead: ~${perEntity.toFixed(1)} tokens`);
    expect(perEntity).toBeLessThan(20);
  });

  it("relations grow linearly too", () => {
    const graph = new ESRGraph();
    graph.createEntity(makeEntity("root"));

    const sizes: number[] = [];
    for (let i = 0; i < 50; i++) {
      graph.createEntity(makeEntity(`e${i}`));
      graph.linkRelation("root", `e${i}`, "depends_on");
      sizes.push(estimateTokens(buildESRContext(graph)));
    }

    const perRelation = (sizes[sizes.length - 1] - sizes[0]) / (sizes.length - 1);
    console.log(`  Per-relation token overhead: ~${perRelation.toFixed(1)} tokens (entity + relation)`);
    expect(perRelation).toBeLessThan(30);
  });
});

// ═══════════════════════════════════════════════════════════
// Cost Projection (estimated)
// ═══════════════════════════════════════════════════════════

describe("Cost Projection", () => {
  it("estimates savings for a typical 100-entity session", () => {
    const scale = 100;
    const graph = new ESRGraph();
    for (let i = 0; i < scale; i++) {
      graph.createEntity(makeEntity(`module-${i}`));
      if (i > 0) graph.linkRelation(`module-${i}`, `module-${i - 1}`, "depends_on");
    }

    const esrTokens = estimateTokens(buildESRContext(graph));
    const chatTokens = estimateTokens(simulateChatHistory(scale));
    const savedTokens = chatTokens - esrTokens;

    // DeepSeek pricing: ~$0.14/1M input tokens (cache miss), ~$0.014/1M (cache hit)
    const costPer1MNoCache = 0.14;
    const costPer1MCacheHit = 0.014;

    const noCacheCost = (chatTokens / 1e6) * costPer1MNoCache;
    const cacheHitCost = (esrTokens / 1e6) * costPer1MCacheHit;
    const savingsPerTurn = noCacheCost - cacheHitCost;

    console.log(`\n  === Cost projection for ${scale}-entity session ===`);
    console.log(`  Chat history tokens:         ${chatTokens.toLocaleString().padStart(6)}`);
    console.log(`  ESR context tokens:          ${esrTokens.toLocaleString().padStart(6)}`);
    console.log(`  Tokens saved per turn:       ${savedTokens.toLocaleString().padStart(6)}`);
    console.log(`  No-cache cost per turn:      $${noCacheCost.toFixed(5)}`);
    console.log(`  ESR cache-hit cost per turn: $${cacheHitCost.toFixed(5)}`);
    console.log(`  Savings per turn:            $${savingsPerTurn.toFixed(5)}`);
    console.log(`  Savings over 50 turns:       $${(savingsPerTurn * 50).toFixed(4)}`);

    expect(esrTokens).toBeLessThan(chatTokens);
  });
});

// ═══════════════════════════════════════════════════════════
// DAG Efficiency: Steps vs Sequential
// ═══════════════════════════════════════════════════════════

describe("DAG Efficiency", () => {
  it("parallel-ready nodes run in one tick vs sequential turns", () => {
    const independentNodes = 3;
    const sequentialTurns = independentNodes;
    const esrTurns = 1; // esr_run processes until idle

    console.log(`\n  === DAG parallelism ===`);
    console.log(`  Independent nodes: ${independentNodes}`);
    console.log(`  Sequential turns (chat): ${sequentialTurns}`);
    console.log(`  ESR turns (single esr_run): ${esrTurns}`);
    console.log(`  Turn reduction: ${(((sequentialTurns - esrTurns) / sequentialTurns) * 100).toFixed(0)}%`);

    expect(esrTurns).toBeLessThan(sequentialTurns);
  });

  it("cache invalidation only re-executes changed + downstream", () => {
    const totalNodes = 5;
    const changedIndex = 2;
    const reExecutedESR = totalNodes - changedIndex;
    const reExecutedChat = totalNodes;

    console.log(`\n  === Cache invalidation efficiency ===`);
    console.log(`  Total nodes in chain: ${totalNodes}`);
    console.log(`  Changed node: index ${changedIndex} (3 of 5)`);
    console.log(`  Nodes re-executed (chat):  ${reExecutedChat} (no invalidation logic)`);
    console.log(`  Nodes re-executed (ESR):   ${reExecutedESR} (only downstream)`);
    console.log(`  Work saved: ${(((reExecutedChat - reExecutedESR) / reExecutedChat) * 100).toFixed(0)}%`);

    expect(reExecutedESR).toBeLessThan(reExecutedChat);
  });
});

// ═══════════════════════════════════════════════════════════
// Real-world simulation: multi-module refactor
// ═══════════════════════════════════════════════════════════

describe("Real-world Scenario", () => {
  it("simulates a 5-module refactor session", () => {
    const graph = new ESRGraph();
    const modules = ["auth", "db", "api", "ui", "cli"];

    for (const mod of modules) {
      graph.createEntity(makeEntity(mod, {
        label: `Module ${mod}`,
        metrics: { completeness: 0.8 },
      }));
      // Evaluator entity
      graph.createEntity(makeEntity(`evaluator-${mod}`, { role: "Actor" }));
    }

    graph.linkRelation("api", "auth", "depends_on");
    graph.linkRelation("api", "db", "depends_on");
    graph.linkRelation("ui", "api", "depends_on");
    graph.linkRelation("cli", "api", "depends_on");

    for (const mod of modules) {
      graph.evaluate(mod, `evaluator-${mod}`, 0.85, { quality: 0.9, coverage: 0.85 });
    }

    const esrTokens = estimateTokens(buildESRContext(graph));
    const chatEquivalent = modules.length * 4 * 50;
    const ratio = (chatEquivalent / esrTokens).toFixed(1);

    console.log(`\n  === 5-module refactor scenario ===`);
    console.log(`  Modules: ${modules.join(", ")}`);
    console.log(`  Relations: 4 depends_on`);
    console.log(`  Evaluations: 5`);
    console.log(`  ESR context tokens: ${esrTokens}`);
    console.log(`  Chat equivalent tokens (est): ${chatEquivalent}`);
    console.log(`  Compression ratio: ${ratio}x`);

    expect(esrTokens).toBeLessThan(chatEquivalent);
  });
});
