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

That's it — ESR graph tools, closure tools, pack tools, and optional memory tools are now available.

### MCP Clients (Claude Code, Codex, Cursor)

```bash
npm install -g pi-esr
pi-esr plugin install --claude
pi-esr plugin install --codex
```

`pi-esr plugin install --claude` installs the native Claude Code plugin and automatically registers the `pi-esr` MCP server.

`pi-esr plugin install --codex` installs the native Codex plugin and automatically registers the `pi-esr` MCP server.

If you only want MCP registration without the native plugin, you can still use:

```bash
pi-esr setup --claude
pi-esr setup --codex
```

If you prefer manual setup, the MCP server still exposes `esr-system-prompt` via prompts discovery.

### From Source

```bash
git clone https://github.com/skepsun/pi-esr.git && cd pi-esr && npm install
npm test                    # 156 tests
npm run typecheck           # Zero errors
```

## Overview

pi-esr transforms user requests into structured entities, typed relations, explicit state transitions, and validated actions. It supports:

- **Coding tasks** – entities = modules/classes/functions, relations = depends_on/implements
- **Document processing** – entities = sections/artifacts/requirements, relations = supports/refines/contradicts
- **Expert evaluation** – entities = experts/evaluations/tasks, relations = evaluates/scores/validates
- **Scoring / decision support** – numeric metrics attached to entities
- **Cross-session continuity** – graph state persists across sessions and projects

The architecture now has four intentionally separate layers:

- `ESR Core` – the single source of truth for entities, relations, tasks, artifacts, constraints, and closure
- `Memory Bridge` – detects host memory capabilities and selects a compatible provider
- `Domain Pack` – compiles domain semantics into ESR structures without owning state
- `Pack Registry` – a lightweight built-in pack market for discovery and selection

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
| `esr_get_closure_status` | Check whether a task has enough evidence to move to stable |
| `esr_list_closure_gaps` | List missing closure evidence for tasks |
| `esr_list_tasks` | View task state with closure-oriented summaries |
| `esr_remove_entity` | Remove an entity and cascade-delete all its relations |
| `esr_remove_relation` | Remove a specific relation between two entities |
| `esr_attach_memory_ref` | Attach an external memory reference without duplicating full content |
| `esr_list_packs` | List available domain packs |
| `esr_detect_pack` | Detect the best-matching domain pack |
| `esr_expand_with_pack` | Expand a request into ESR entities, constraints, artifacts, and validation |
### Memory Tools (optional — requires `better-sqlite3`)

| Tool | Description |
|------|-------------|
| `esr_mem_store` | Store an observation anchored to an ESR entity |
| `esr_mem_recall` | Recall memories by entity_id, text search, or both |
| `esr_mem_timeline` | Chronological timeline of all observations about an entity |
| `esr_mem_journal` | View entity state transition journal or record manual entry |

## Memory Compatibility

pi-esr does not assume the host runtime has no memory, and it does not try to replace a mature memory system.

- If the host already exposes memory capabilities, `memory-bridge` detects them and ESR cooperates through `memory_ref`
- If the host has no usable memory layer, ESR can fall back to a SQLite provider or a null provider
- ESR itself stores only decision-relevant structured state rather than duplicating full external memory content

This keeps ESR compatible with:

- agent runtimes with built-in state or memory
- retrieval-oriented memory plugins
- summary-oriented memory plugins
- lightweight hosts with no memory support

The point of auto-detection is to avoid competing state systems, not to declare one memory implementation superior.

## Domain Packs

pi-esr now supports a lightweight domain-pack model:

- `software` – software delivery and engineering closure
- `govdoc` – public-sector and enterprise documents, proposals, policy references, budget/risk sections
- `planning-review` – strategic planning review, indicator coverage, consistency checks, rectification closure

The boundaries are strict:

- `ESR` does not understand domain semantics
- `Pack` does not persist state
- `Adapter` only performs structural mapping
- `Registry` only handles discovery and selection

This allows domain growth without turning ESR itself into a domain framework.

## Real Enterprise Scenarios

Two non-software scenarios have already been calibrated against real enterprise materials:

- `planning-review`
  - for 15th Five-Year planning review, strategy alignment, indicator completeness, text/data consistency, and rectification tracking
  - supports requirement-source modeling so national standards or normative documents can be attached as review criteria
- `govdoc`
  - for official writing, project proposals, budget sections, policy references, and risk-section completeness

All of this enters the system through `Pack -> ESR` compilation rather than hard-coded core semantics.

## Commands

| Command | Description |
|---------|-------------|
| `/esr` | Display the current ESR graph |
| `/esr-clear` | Clear all ESR state |

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

## Persistence Model

ESR persists graph state in two places:

- **Session branch entries** — per-session audit trail inside the host
- **Project-level file** — `.pi-esr-memory/esr-state.json` for cross-session continuity
- **Bootstrap recovery** — if neither exists, ESR can scan recent session files to recover prior graph state

## Architecture

```
packages/
└── core/                     @pi-esr/core — framework-agnostic engine
    └── src/
        ├── types.ts              Type definitions
        ├── validation.ts         Ontology validators + state transition matrix
        ├── graph.ts              ESRGraph class (core state machine)
        ├── context.ts            ESR context builder + fingerprint
        ├── store.ts              MemoryStore — SQLite-backed observation storage
        ├── recall.ts             Entity-anchored memory context builder
        ├── journal.ts            State transition journal + summaries
        ├── session.ts            Shared session state
        ├── host.ts               Host interface
        └── index.ts              Package entry point
extensions/
├── integration/
│   ├── tools.ts              11 ESR tool registrations
│   └── commands.ts           /esr /esr-clear /esr-mem
├── persistence/
│   ├── graph-persist.ts      Unified persistence (session + file)
│   ├── snapshot.ts           Graph state persistence adapter
│   └── reconstruct.ts        Graph state reconstruction
├── memory/
│   └── tools.ts              4 esr_mem_* tool registrations
├── prompt.ts                 Prompt context builder
└── index.ts                  Extension entry point

packages/core/tests/
├── graph.test.ts             49 tests
├── memory.test.ts            24 tests
├── session.test.ts           3 tests
└── validate-efficiency.test.ts 11 tests

tests/
├── tools.test.ts             6 tests
├── persistence.test.ts       3 tests
└── repository.test.ts        5 tests
```

## Validation

### Correctness (156 tests, 11 test files)

```bash
npm test                    # 156 tests, <1s
npm run typecheck           # tsc --noEmit, zero errors
```

| Layer | Tests | What's covered |
|-------|-------|---------------|
| Graph core | 49 | Entity CRUD, state transitions, cycle detection, serialization roundtrips, fingerprint stability, immutability, context builder, artifact auto-proxy |
| Tool integration | 6 | Registered graph tools, persistence writes, error handling, context output |
| Memory | 24 | Store CRUD, recall/search/timeline, journal, context builder, format helpers, entity ID extraction, session tag filtering |
| Session | 3 | Current session ID get/set/reset |
| Efficiency | 11 | Token compression benchmarks, prefix-cache stability, context growth rate, cost projection |
| Persistence | 3 | Reconstruct validation, malformed data rejection, session branch state loading |
| Repository | 5 | SQLite-backed versioned entity storage, conflict detection |

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

## Golden Rules

1. Everything meaningful is an Entity
2. All structure is Relation-based
3. State is the only truth
4. Actions are the only write interface
5. If it cannot be represented in ontology → DO NOT STORE
6. If it does not affect future decisions → DO NOT STORE
