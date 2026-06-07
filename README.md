# pi-esr

**Engineering State Runtime** plugin for [Pi Agent](https://github.com/earendil-works/pi).

A constrained semantic graph state machine for engineering, documentation, and decision intelligence tasks. Designed for LLM prefix-cache stability — every byte is deterministic.

**NOT** a memory system. **NOT** a chat history system. **NOT** a retrieval-only system.

## Quick Start

```bash
pi install ./pi-esr
npm test                    # 61 unit tests
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
extensions/
├── core/
│   ├── types.ts              Type definitions
│   ├── validation.ts         Ontology validators + state transition matrix
│   ├── graph.ts              ESRGraph class (core state machine)
│   └── context.ts            Context builder + fingerprint
├── integration/
│   ├── tools.ts              12 ESR tool registrations + runtime tool drivers
│   └── commands.ts           /esr /esr-clear /esr-step /esr-run
├── persistence/
│   ├── snapshot.ts           Graph state persistence
│   ├── reconstruct.ts        Graph state reconstruction
│   ├── runtime-state.ts      Runtime state persistence
│   └── runtime-cache.ts      Runtime cache persistence
├── runtime/
│   ├── runtime.ts            ESRRuntime — tick loop + runUntilIdle
│   ├── state.ts              ESRRuntimeStateStore — node store + events
│   ├── planner.ts            DAG dependency planner
│   ├── executor.ts           Node execution with cache layer
│   ├── scheduler.ts          Simple priority scheduler
│   ├── cache.ts              InMemoryCacheStore + SHA256 cache keys
│   ├── runtime-types.ts      ExecutionNode, RuntimeEvent, etc.
│   └── drivers/
│       └── tool-driver.ts    ToolDriverRegistry
├── prompt.ts                 Prompt context builder
└── index.ts                  Entry point (thin orchestration)
tests/
├── graph.test.ts             46 tests
├── cache.test.ts             4 tests
├── planner.test.ts           4 tests
└── runtime.test.ts           7 tests
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
