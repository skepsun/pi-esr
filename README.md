# pi-esr

**Engineering State Runtime** — structured state machine for LLM agents.

A constrained semantic graph state machine for engineering, documentation, and decision intelligence tasks. Designed for LLM prefix-cache stability — every byte is deterministic.

**NOT** a memory system. **NOT** a chat history system. **NOT** a retrieval-only system.

## Quick Start

Pi Agent (one command):

```bash
npm install -g pi-esr
pi-esr setup
```

That's it — 17 ESR tools (13 graph/runtime + 4 memory) are now available.

### MCP Clients (Claude Code, Codex, Cursor)

```bash
npm install -g pi-esr
pi-esr setup --claude
pi-esr setup --codex
```

`pi-esr setup --claude` registers the MCP server and syncs a managed ESR block into `CLAUDE.md`.

`pi-esr setup --codex` registers the MCP server and syncs a managed ESR block into `AGENTS.md`.

If you prefer manual setup, the MCP server still exposes `esr-system-prompt` via prompts discovery.

### From Source

```bash
git clone https://github.com/skepsun/pi-esr.git && cd pi-esr && npm install
npm test                    # 132 tests
npm run typecheck           # Zero errors
```

## Overview

pi-esr transforms user requests into structured entities, typed relations, explicit state transitions, and validated actions. It supports:

- **Coding tasks** – entities = modules/classes/functions, relations = depends_on/implements
- **Document processing** – entities = sections/artifacts/requirements, relations = supports/refines/contradicts
- **Expert evaluation** – entities = experts/evaluations/tasks, relations = evaluates/scores/validates
- **Scoring / decision support** – numeric metrics attached to entities
- **Runtime execution** – DAG-based task orchestration with cache-hit optimization

## ESR Tools

| Tool | Description |
|------|-------------|
| `esr_create_entity` | Create an entity (Actor, Artifact, Task, Concept, Constraint) |
| `esr_update_state` | Update entity state, confidence, or metrics |
| `esr_link_relation` | Create a typed relation between entities |
| `esr_evaluate` | Record an evaluation with confidence and metrics |
| `esr_score` | Attach a numeric score to an entity |
| `esr_promote_task` | Promote a task to active/stable |
| `esr_update_artifact` | Create/update structured artifact with sections |
| `esr_apply_constraint` | Apply a constraint to an entity |
| `esr_get_context` | Query the current ESR graph state |
| `esr_remove_entity` | Remove an entity and cascade-delete all its relations |
| `esr_remove_relation` | Remove a specific relation between two entities |
| `esr_create_node` | Create a runtime execution node for the DAG engine |
| `esr_run` | Execute all pending runtime nodes until idle (zero-token DAG dispatch) |

### Memory Tools (optional — requires `better-sqlite3`)

| Tool | Description |
|------|-------------|
| `esr_mem_store` | Store an observation anchored to an ESR entity |
| `esr_mem_recall` | Recall memories by entity_id, text search, or both |
| `esr_mem_timeline` | Chronological timeline of all observations about an entity |
| `esr_mem_journal` | View entity state transition journal or record manual entry |

## Commands

| Command | Description |
|---------|-------------|
| `/esr` | Display ESR graph + runtime nodes |
| `/esr-clear` | Clear all ESR state |
| `/esr-step` | Run one runtime tick |
| `/esr-run [maxSteps]` | Run runtime until idle |

## Guardrails

- **State machine enforcement** — `stable → draft` is rejected; only valid transitions allowed
- **Cycle detection** — structural edges (`depends_on`, `part_of`, `implements`, `triggers`) are checked for cycles via DFS
- **Confidence clamping** — all confidence values validated to `[0, 1]`
- **Duplicate prevention** — identical relations and repeated evaluations are rejected
- **Immutability** — `getEntity()` returns defensive copy, internal state cannot be corrupted
- **Cryptographic IDs** — constraint entities use `crypto.randomUUID()`
- **Timestamps** — every entity carries `updated_at`, excluded from context to preserve cache
- **Context fingerprint** — `buildGraphFingerprint` (DJB2 hash) enables cache-hit diagnosis
- **Query helpers** — `getRelationsFor(entityId)` and `getRelationsByType(type)`

## Cache Stability

ESR is designed for DeepSeek-style prefix caching. Three invariants ensure byte-stable context:

1. **System prompt is never mutated at runtime** — `prompts/esr.md` is a static file
2. **Context injection wrapper is always identical** — no branching based on empty/non-empty
3. **All context output is deterministically sorted** — entities by id, relations by (from, type, to)

The system prompt also includes **Cache Stability Rules** that forbid the LLM from rearranging, paraphrasing, or annotating the ESR context block.

## Runtime Engine

ESR includes a DAG-based execution engine for orchestrating multi-step tool workflows:

- **Execution nodes** — `pending → ready → running → succeeded/failed/blocked/cached`
- **Dependency planning** — `computeRunnableNodes` evaluates DAG readiness
- **SHA256 cache keys** — deterministic keys include inputs + dependency fingerprints + artifact versions
- **Invalidation cascade** — graph mutations mark dependent runtime nodes stale
- **Tool driver abstraction** — runtime tool dispatch is independent of pi's tool definitions

## Architecture

```
packages/
└── core/                     @pi-esr/core — framework-agnostic engine
    └── src/
        ├── types.ts              Type definitions
        ├── validation.ts         Ontology validators + state transition matrix
        ├── graph.ts              ESRGraph class (core state machine)
        ├── context.ts            ESR context builder + fingerprint
        ├── runtime.ts            ESRRuntime — tick loop + runUntilIdle
        ├── state.ts              ESRRuntimeStateStore — node store + events
        ├── planner.ts            DAG dependency planner
        ├── executor.ts           Node execution with cache layer
        ├── scheduler.ts          Simple priority scheduler
        ├── cache.ts              InMemoryCacheStore + SHA256 cache keys
        ├── runtime-types.ts      ExecutionNode, RuntimeEvent, etc.
        ├── driver.ts             ToolDriverRegistry
        ├── store.ts              MemoryStore — SQLite-backed observation storage
        ├── recall.ts             Entity-anchored memory context builder
        ├── journal.ts            State transition journal + summaries
        ├── session.ts            Shared session state
        ├── host.ts               Host interface
        └── index.ts              Package entry point
extensions/
├── integration/
│   ├── tools.ts              12 ESR tool registrations + runtime tool drivers
│   └── commands.ts           /esr /esr-clear /esr-step /esr-run /esr-mem
├── persistence/
│   ├── graph-persist.ts      Unified persistence (session + file)
│   ├── snapshot.ts           Graph state persistence adapter
│   ├── reconstruct.ts        Graph state reconstruction
│   ├── runtime-state.ts      Runtime state persistence
│   └── runtime-cache.ts      Runtime cache persistence
├── memory/
│   └── tools.ts              4 esr_mem_* tool registrations
├── prompt.ts                 Prompt context builder
└── index.ts                  Extension entry point

packages/core/tests/
├── graph.test.ts             49 tests
├── cache.test.ts             4 tests
├── planner.test.ts           4 tests
├── runtime.test.ts           6 tests
├── memory.test.ts            24 tests
├── session.test.ts           3 tests
└── validate-efficiency.test.ts 11 tests

tests/
├── tools.test.ts             21 tests
├── persistence.test.ts       4 tests
└── repository.test.ts        3 tests
```

## Validation

### Correctness (132 tests, 10 test files)

```bash
npm test                    # 132 tests, <1s
npm run typecheck           # tsc --noEmit, zero errors
```

| Layer | Tests | What's covered |
|-------|-------|---------------|
| Graph core | 49 | Entity CRUD, state transitions, cycle detection, serialization roundtrips, fingerprint stability, immutability, context builder, artifact auto-proxy |
| Tool drivers | 21 | All 11 driver operations + scheduler + runtime context |
| Runtime | 6 | Tick execution, cache hit, invalidation cascade, persisted state roundtrips |
| Cache | 4 | SHA256 key determinism, input-change detection, artifact version impact, persistence roundtrip |
| Planner | 4 | Dependency-satisfied/none/pending, blocked-by-failure classification |
| Memory | 24 | Store CRUD, recall/search/timeline, journal, context builder, format helpers, entity ID extraction, session tag filtering |
| Session | 3 | Current session ID get/set/reset |
| Efficiency | 11 | Token compression benchmarks, prefix-cache stability, context growth rate, cost projection, DAG parallelism |
| Persistence | 4 | Reconstruct validation, malformed data rejection, session branch state loading |
| Repository | 3 | SQLite-backed versioned entity storage, conflict detection |

### Efficiency Benchmarks

```bash
npx vitest run tests/validate-efficiency.test.ts --reporter=verbose
```

#### Token Compression vs Chat History

| Entities | ESR context | Chat equivalent | Ratio | Savings |
|----------|-------------|-----------------|-------|---------|
| 5 | 138t | 210t | 1.5x | 34.3% |
| 10 | 260t | 435t | 1.7x | 40.2% |
| 20 | 515t | 897t | 1.7x | 42.6% |
| 50 | 1280t | 2285t | 1.8x | 44.0% |
| 100 | 2555t | 4597t | 1.8x | 44.4% |

ESR context is ~1.8x more compact than equivalent chat history at scale.

#### Prefix-Cache Stability

- Identical state → identical fingerprint → **100% cache hit**
- Adding/removing entities → fingerprint changes (correct cache miss)
- Context output is **byte-for-byte deterministic** — DeepSeek/Claude prefix cache compatible
- Per-entity overhead: ~11 tokens (linear O(n), no quadratic blowup)
- Per-relation overhead: ~18 tokens (entity + relation, linear O(n))

#### DAG Parallelism

| Scenario | Sequential (chat) | ESR runtime | Reduction |
|----------|-------------------|-------------|-----------|
| 3 independent nodes | 3 LLM rounds | 1 `esr_run` (zero-token) | **67%** |
| 5-node chain, 1 changed | 5 re-executions | 3 re-executions (cache hit on 2) | **40%** |

#### Cost Projection (DeepSeek pricing)

For a 100-entity session with 50 turns:
- Chat history cost (no cache): ~$0.032
- ESR with prefix-cache hits: ~$0.0015
- **Estimated savings per session: $0.03+** (compounds across many sessions)
```

## State Transition Matrix

| From ↓ / To → | draft | active | stable | blocked | deprecated |
|---------------|-------|--------|--------|---------|------------|
| **draft**     | —     | ✓      | ✓      | ✓       | ✓          |
| **active**    | ✗     | —      | ✓      | ✓       | ✓          |
| **stable**    | ✗     | ✓      | —      | ✓       | ✓          |
| **blocked**   | ✓     | ✓      | ✗      | —       | ✓          |
| **deprecated**| ✓     | ✗      | ✗      | ✗       | —          |

## Core Ontology

### Entity Roles
`Actor` | `Artifact` | `Task` | `Concept` | `Constraint`

### Relation Types
**Structural:** `depends_on` | `part_of` | `implements`
**Semantic:** `supports` | `contradicts` | `refines`
**Evaluation:** `evaluates` | `scores` | `validates`
**Operational:** `triggers` | `updates` | `blocks` | `produces`

### Execution States
`pending` | `ready` | `running` | `succeeded` | `failed` | `blocked` | `cached`

## Golden Rules

1. Everything meaningful is an Entity
2. All structure is Relation-based
3. State is the only truth
4. Actions are the only write interface
5. If it cannot be represented in ontology → DO NOT STORE
6. If it does not affect future decisions → DO NOT STORE
