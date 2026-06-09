import { describe, expect, it } from "vitest";
import { MemoryStore } from "../../core/src/store.js";
import { createMemoryProvider } from "../src/factory.js";
import type { MemoryCapabilityReport } from "../src/types.js";

function makeReport(overrides: Partial<MemoryCapabilityReport> = {}): MemoryCapabilityReport {
  return {
    status: "none",
    kinds: [],
    providerHints: [],
    confidence: 0,
    evidence: [],
    ...overrides,
  };
}

describe("createMemoryProvider", () => {
  it("uses local sqlite memory when no external memory is detected", () => {
    const provider = createMemoryProvider({
      report: makeReport({
        status: "available",
        kinds: ["store"],
        providerHints: [],
        confidence: 0.85,
      }),
      sqliteStore: new MemoryStore(":memory:"),
    });

    expect(provider.name).toBe("sqlite-memory");
  });

  it("falls back to null when local sqlite is unavailable", () => {
    const provider = createMemoryProvider({
      report: makeReport({
        status: "available",
        kinds: ["store"],
        providerHints: [],
        confidence: 0.85,
      }),
      sqliteStore: null,
    });

    expect(provider.name).toBe("null");
  });

  it("avoids competing with detected external memory providers", () => {
    const provider = createMemoryProvider({
      report: makeReport({
        status: "available",
        kinds: ["store", "tool"],
        providerHints: ["claude-mem"],
        confidence: 0.95,
      }),
      sqliteStore: new MemoryStore(":memory:"),
    });

    expect(provider.name).toBe("null");
  });
});
