# pi-esr

**Engineering State Runtime** — structured state machine for LLM agents.

A constrained semantic graph state machine for engineering, documentation, and decision intelligence tasks. Designed for LLM prefix-cache stability — every byte is deterministic.

**NOT** a memory system. **NOT** a chat history system. **NOT** a retrieval-only system.

## Quick Start

### Pi Agent (one command)

```bash
pi install npm:pi-esr
```

That's it — `/esr` command is available immediately. ESR graph tools, closure tools, pack tools, and optional memory tools are ready.

For global install (all projects):

```bash
pi install npm:pi-esr
```

For project-local only:

```bash
npm install -g pi-esr
pi-esr setup
```

### Pi Agent (CLI-based)

```bash
npm install -g pi-esr
pi-esr setup              # project-local
pi-esr setup --global     # all projects
```

### Claude Code

```bash
npm install -g pi-esr
pi-esr setup --claude
```

### Codex (OpenAI)

```bash
npm install -g pi-esr
pi-esr setup --codex
```

### From Source

```bash
git clone https://github.com/skepsun/pi-esr.git && cd pi-esr && npm install
npm test                    # 156 tests
npm run typecheck           # Zero errors
```

## Overview

pi-esr transforms user requests into structured entities, typed relations, explicit state transitions, and validated actions. It supports:

- **Coding tasks** — entities = modules/classes/functions, relations = depends_on/implements
- **Document processing** — entities = sections/artifacts/requirements, relations = supports/refines/contradicts
- **Expert evaluation** — entities = experts/evaluations/tasks, relations = evaluates/scores/validates
- **Scoring / decision support** — numeric metrics attached to entities
- **Cross-session continuity** — graph state persists across sessions and projects

The architecture has four intentionally separate layers:

- `ESR Core` — the single source of truth for entities, relations, tasks, artifacts, constraints, and closure
- `Memory Bridge` — detects host memory capabilities and selects a compatible provider (pi-loom, SQLite, null)
- `Domain Pack` — compiles domain semantics into ESR structures without owning state
- `Pack Registry` — lightweight built-in pack market for discovery and selection

## ESR Tools

### Core (16 tools)

| Tool | Description |
|------|-------------|
| `esr_create_entity` | Create entity (Task, Constraint, Concept, Actor, Artifact) |
| `esr_update_state` | Update entity state, confidence, or metrics |
| `esr_link_relation` | Create a typed relation between entities |
| `esr_evaluate` | Record an evaluation with confidence and metrics |
| `esr_update_artifact` | Create/update structured artifact with versioned sections |
| `esr_get_context` | Query the current ESR graph state |
| `esr_get_closure_status` | Check if a task has enough evidence for stable promotion |
| `esr_list_closure_gaps` | List tasks with missing closure evidence |
| `esr_list_tasks` | View task state with closure-oriented summaries |
| `esr_remove_entity` | Remove an entity and cascade-delete all its relations |
| `esr_remove_relation` | Remove a specific relation between two entities |
| `esr_attach_memory_ref` | Attach external memory reference without duplicating content |
| `esr_list_packs` | List available domain packs |
| `esr_detect_pack` | Detect the best-matching domain pack for a goal |
| `esr_expand_with_pack` | Expand a goal through a domain pack into ESR structure |
| `esr_complete_task` | **Primary completion path** — artifacts + evaluation + closure → stable |

### Memory Tools (built-in, requires `better-sqlite3`)

| Tool | Description |
|------|-------------|
| `esr_mem_store` | Store observation anchored to an ESR entity |
| `esr_mem_recall` | Recall memories by entity_id, text search, or both |
| `esr_mem_timeline` | Chronological timeline of observations about an entity |
| `esr_mem_journal` | View state transition journal or record manual entry |

## Memory Compatibility

pi-esr does not assume the host runtime has no memory, and it does not try to replace a mature memory system.

- If the host already exposes memory capabilities (e.g., pi-loom), `memory-bridge` detects them and ESR cooperates through `memory_ref`
- If the host has no usable memory layer, ESR can fall back to a SQLite provider or a null provider
- ESR itself stores only decision-relevant structured state rather than duplicating full external memory content

This keeps ESR compatible with:

- agent runtimes with built-in state or memory
- retrieval-oriented memory plugins
- summary-oriented memory plugins
- lightweight hosts with no memory support

## Domain Packs

### Built-in Packs (shipped with distribution)

Three packs are bundled and auto-loaded from `~/.pi-esr/packs/` or `$ESR_PACKS_PATH`:

| Pack | Version | Scope | Auto-expands |
|------|---------|-------|-------------|
| `software` | 0.6.3 | Code tasks, refactoring, builds | 1 Task + typecheck/test constraints |
| `agent-tool` | 0.6.3 | MCP tool/server/plugin development | 6 Tasks (contract, schema, error, timeout, idempotency, tests) + 4 Artifacts + baseline review |
| `refactor` | 0.6.3 | Extract, migrate, verify, document | 7 Tasks with depends_on chain + 2 Artifacts + safety baseline |

### Pack Locations

Packs are loaded at runtime from these paths (checked in order):

1. **`ESR_PACKS_PATH`** environment variable (colon-separated, like `PATH`)
2. **`~/.pi-esr/packs/`** (default, created automatically on first run)

Each subdirectory under these paths must contain an `index.js` that exports an `ESRDomainPack` object.

After `npm install -g pi-esr`, run `pi-esr setup` to ensure `~/.pi-esr/packs/` is initialized.

### Creating a New Domain Pack

Every domain pack is a plain object implementing the `ESRDomainPack` interface:

```typescript
interface ESRDomainPack {
  name: string;
  version: string;
  description?: string;
  detect(input: { prompt: string; cwd: string }): Promise<number>;  // 0.0–1.0 confidence
  expand(input: { goal: string; cwd: string }): Promise<ESRPackExpansion>;
  validate(input: { context: string; cwd: string }): Promise<ESRPackValidationResult>;
}
```

**Step-by-step:**

1. Create a directory under `~/.pi-esr/packs/my-pack/`
2. Add `index.js` exporting your pack object
3. Implement `detect()` — return a confidence score (0.0–1.0) based on keywords, patterns, or context
4. Implement `expand()` — return entities, relations, artifacts, constraints, checks, and baselines
5. Implement `validate()` — return evaluations, gaps, baseline diffs, review findings, and remediation items
6. The pack is auto-discovered on next `esr_list_packs` or `esr_expand_with_pack` call

**Minimal example** (`~/.pi-esr/packs/my-pack/index.js`):

```javascript
export const myPack = {
  name: "my-pack",
  version: "0.6.3",
  description: "A minimal domain pack example.",

  async detect(input) {
    return input.prompt.toLowerCase().includes("my-topic") ? 0.85 : 0.1;
  },

  async expand(input) {
    return {
      entities: [
        { entity_id: "task-main", role: "Task", state: "draft", label: input.goal, confidence: 0.5 },
      ],
      relations: [],
      artifacts: [],
      constraints: [{ entity_id: "task-main", description: "must_pass_quality_check" }],
      summary: "My pack initialized.",
    };
  },

  async validate(_input) {
    return { evaluations: [], constraints: [], memoryRefs: [], gaps: [], summary: "Validated." };
  },
};
```

**Multiple packs in one directory** — use `ESR_PACKS_PATH` to point to additional directories. Packs are only discovered if a subdirectory has `index.js` exporting a valid `ESRDomainPack`.

**Advanced packs** can include:
- `checks` — structured check definitions for quality gates
- `referenceBaselines` — requirement baselines with sections and expected signals
- `baselineDiffs` — diff between actual vs expected in validation
- `reviewFindings` — structured findings with severity, category, evidence, recommendations
- `remediationItems` — suggested actions with priority, owner hints, traceability

See `packages/domain-pack-agent-tool/src/index.ts` and `packages/domain-pack-refactor/src/index.ts` for full-featured examples.

### Design Boundaries

- `ESR` does not understand domain semantics
- `Pack` does not persist state
- `Adapter` only performs structural mapping
- `Registry` only handles discovery and selection

## Commands

| Command | Description |
|---------|-------------|
| `/esr` | Display the current ESR graph |
| `/esr-clear` | Clear all ESR state |

## Core Ontology

### LLM-Exposed Roles (subset)

| Role | Purpose |
|------|---------|
| `Task` | A unit of work: draft → active → stable (or blocked / deprecated) |
| `Constraint` | A quality gate or rule that validates a Task |
| `Concept` | An abstract idea, pattern, or domain term |

Full type system also includes `Actor` and `Artifact` (see `packages/core/src/types.ts`).

### LLM-Exposed Relation Types (subset)

| Type | Meaning |
|------|---------|
| `depends_on` | Task A must complete before Task B |
| `produces` | Task produces an Artifact |
| `validates` | Constraint validates a Task |
| `blocks` | Entity A blocks Entity B |
| `refines` | Entity A is a sub-task or detail of Entity B |
| `evaluates` | An evaluator judges an entity |

Full type system also includes `part_of`, `implements`, `supports`, `contradicts`, `scores`, `triggers`, `updates`.

## Guardrails

- **State machine enforcement** — valid transitions only; `stable → draft` rejected
- **Cycle detection** — DFS on structural edges (depends_on, part_of, implements, triggers)
- **Confidence clamping** — all values validated to [0, 1]
- **Duplicate prevention** — identical relations and repeated evaluations rejected
- **Immutability** — `getEntity()` returns defensive copy
- **Cryptographic IDs** — constraint entities use `crypto.randomUUID()`
- **Timestamps** — every entity carries `updated_at`, excluded from context for cache
- **Context fingerprint** — `buildGraphFingerprint` (DJB2 hash) for cache-hit diagnosis
- **Query helpers** — `getRelationsFor(entityId)`, `getRelationsByType(type)`

## Cache Stability

ESR is designed for DeepSeek-style prefix caching. Three invariants:

1. **System prompt is never mutated at runtime** — `prompts/esr.md` is static
2. **Context injection wrapper is always identical** — no branching based on empty/non-empty
3. **All context output is deterministically sorted** — entities by id, relations by (from, type, to)

## Persistence Model

- **Session branch entries** — per-session audit trail inside the host
- **Project-level file** — `.pi-esr-memory/esr-state.json` for cross-session continuity
- **Bootstrap recovery** — scans recent session files if neither exists

## Architecture

```
packages/
├── core/                          @pi-esr/core — framework-agnostic engine
│   └── src/
│       ├── types.ts               Entity/Relation/State type definitions
│       ├── validation.ts          Ontology validators + state transition matrix
│       ├── graph.ts               ESRGraph class (core state machine)
│       ├── context.ts             ESR context builder + fingerprint
│       ├── closure.ts             Closure protocol + evaluation engine
│       ├── store.ts               MemoryStore — SQLite-backed observation storage
│       ├── recall.ts              Entity-anchored memory context builder
│       ├── journal.ts             State transition journal + summaries
│       ├── session.ts             Shared session state
│       ├── host.ts                Host interface
│       ├── driver.ts              Graph execution driver
│       ├── planner.ts             Task planning engine
│       ├── scheduler.ts           Task scheduling engine
│       ├── runtime.ts             Runtime types & lifecycle
│       ├── runtime-types.ts       Runtime type guards
│       ├── repository.ts          Repository interface
│       ├── repository-sqlite.ts   SQLite-backed versioned entity storage
│       ├── state.ts               State machine core
│       ├── cache.ts               Cache utilities
│       ├── executor.ts            Task executor
│       └── index.ts               Package entry point
├── adapter-mcp/                   @pi-esr/adapter-mcp — MCP server adapter
├── adapter-opencode/              @pi-esr/adapter-opencode — OpenCode adapter
├── cli/                           pi-esr CLI — setup, plugin install, MCP registration
├── domain-pack/                   @pi-esr/domain-pack — Pack protocol + adapter types
├── domain-pack-agent-tool/        Agent tool development domain pack
├── domain-pack-refactor/          Refactoring domain pack
├── domain-pack-software/          Software engineering domain pack
└── memory-bridge/                 @pi-esr/memory-bridge — Host capability detection + provider selection

extensions/
├── integration/
│   ├── tools.ts              16 ESR tool registrations
│   └── commands.ts           /esr /esr-clear
├── persistence/
│   ├── graph-persist.ts      Unified persistence (session + file)
│   ├── snapshot.ts            Graph state persistence adapter
│   └── reconstruct.ts         Graph state reconstruction
├── memory/
│   └── tools.ts              4 esr_mem_* tool registrations
├── overlay/
│   ├── widget.ts              TUI overlay widgets
│   ├── format.ts              Output formatting
│   └── selectors.ts           Entity selectors
├── memory-bridge.ts           Memory bridge extension
├── prompt.ts                  Prompt context builder
├── core.ts                    Core extension
└── index.ts                   Extension entry point
```

## Validation

### Correctness (156 tests, 11 test files)

```bash
npm test                    # 156 tests, <1s
npm run typecheck           # tsc --noEmit, zero errors
```

| Layer | Tests | What's covered |
|-------|-------|---------------|
| Graph core | 54 | Entity CRUD, state transitions, cycle detection, serialization roundtrips, fingerprint stability, immutability, context builder, artifact auto-proxy, neighborhood queries |
| Closure | 10 | Evaluation engine, constraint validation, closure promotion, policy-driven gating, memory-ref requirements |
| Tool integration | 25 | All 16 ESR tools, pack detection/expansion, closure workflow, domain pack scenarios |
| Memory | 24 | Store CRUD, recall/search/timeline, journal, context builder, format helpers, session tag filtering |
| Session | 3 | Current session ID get/set/reset |
| Efficiency | 15 | Token compression benchmarks, prefix-cache stability, context growth, cost projection, DAG parallelism, real-world scenario |
| Persistence | 3 | Reconstruct validation, malformed data rejection, session branch state loading, mirror locking |
| Repository | 5 | SQLite-backed versioned entity storage, conflict detection, concurrent client safety |
| MCP adapter | 11 | MCP tool registration, parameter validation, hook context injection, pack tools, snapshot mirroring |
| E2E multi-session | 5 | 3-session refactor scenario, state continuity, closure across sessions, artifact auto-proxy |

### Efficiency Benchmarks

#### Token Compression vs Chat History

| Entities | ESR context | Chat equivalent | Ratio | Savings |
|----------|-------------|-----------------|-------|---------|
| 5 | 124t | 210t | 1.7x | 41.0% |
| 10 | 240t | 435t | 1.8x | 44.8% |
| 20 | 479t | 897t | 1.9x | 46.6% |
| 50 | 1,199t | 2,285t | 1.9x | 47.5% |
| 100 | 2,400t | 4,597t | 1.9x | 47.8% |

ESR context is ~1.9x more compact than equivalent chat history at scale.

#### Prefix-Cache Stability

- Identical state → identical fingerprint → **100% cache hit**
- Adding/removing entities → fingerprint changes (correct cache miss)
- Context output is **byte-for-byte deterministic** — DeepSeek/Claude prefix cache compatible
- Per-entity overhead: ~9.5 tokens (linear O(n), no quadratic blowup)
- Per-relation overhead: ~16.7 tokens (entity + relation, linear O(n))

#### Cost Projection (DeepSeek pricing)

For a 100-entity session with 50 turns:
- Chat history tokens: 4,597
- ESR context tokens: 2,102
- Tokens saved per turn: 2,495
- Chat history cost (no cache): ~$0.032
- ESR with prefix-cache hits: ~$0.0015
- **Estimated savings per session: $0.03+** (compounds across many sessions)

#### DAG Parallelism

- 3 independent nodes: ESR executes in 1 turn vs 3 sequential chat turns → **67% turn reduction**
- Cache invalidation: only changed + downstream nodes re-executed → **40% work saved** vs full re-run

#### Real-world Scenario

5-module refactor (auth, db, api, ui, cli) with 4 depends_on relations and 5 evaluations:
- ESR context: 287 tokens vs ~1,000 chat equivalent → **3.5x compression**

## State Transition Matrix

| From ↓ / To → | draft | active | stable | blocked | deprecated |
|---------------|-------|--------|--------|---------|------------|
| **draft**     | —     | ✓      | ✓      | ✓       | ✓          |
| **active**    | ✗     | —      | ✓      | ✓       | ✓          |
| **stable**    | ✗     | ✓      | —      | ✓       | ✓          |
| **blocked**   | ✓     | ✓      | ✗      | —       | ✓          |
| **deprecated**| ✓     | ✗      | ✗      | ✗       | —          |

## Golden Rules

1. Every meaningful task → Entity
2. Every constraint → Entity + validates relation
3. Every completed task → `esr_complete_task` (artifacts + evaluation → stable)
4. State is the single source of truth — when in doubt, call `esr_get_context`
5. If it cannot be represented in ontology → DO NOT STORE
6. If it does not affect future decisions → DO NOT STORE
