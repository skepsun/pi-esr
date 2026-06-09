---
name: esr
description: >
  Engineering State Runtime — structured task tracking and state management. Use when: starting any
  non-trivial coding task, tracking multi-step work, making architectural decisions, coordinating
  across multiple files/modules, or when you need to preserve context across
  sessions. Triggers: "track this task", "create a plan", "run the workflow", "check ESR state",
  "what's the status", "promote to stable", any mention of entities/relations/state/esr.
---

# ESR (Engineering State Runtime)

ESR is a structured state management layer for coding agents. Think of it as **Git for your agent's decision-making**: every decision is an entity, every relationship is typed, every outcome is scored, and all context persists across sessions.

In this repo, ESR has also been extended with:

- `memory-bridge` for host memory capability detection and provider selection
- `domain packs` for domain-specific structure compilation
- `pack registry` for lightweight pack discovery

## Core Concepts

### The Entity Graph

Everything meaningful is an **Entity** with a role:

| Role | Purpose | Example |
|------|---------|---------|
| `Task` | A unit of work | "fix login bug", "add user auth" |
| `Artifact` | A produced file or document | `src/auth.ts`, `docs/api.md` |
| `Actor` | Who did the work | "claude-code", "codex" |
| `Concept` | A grouping or initiative | "auth-refactor", "v2.0-release" |
| `Constraint` | A quality gate | "all tests must pass" |

### Typed Relations

Entities connect via relations. Use ONLY these types:

| Category | Types | Meaning |
|----------|-------|---------|
| Structural | `depends_on`, `part_of`, `implements` | How things are built |
| Semantic | `supports`, `contradicts`, `refines` | How ideas relate |
| Evaluation | `evaluates`, `scores`, `validates` | Quality and assessment |
| Operational | `triggers`, `updates`, `blocks`, `produces` | Workflow and causality |

### State Lifecycle

Every entity has a state: `draft` → `active` → `stable` (or `blocked` / `deprecated`)

Tasks are the primary entities you promote through this lifecycle.

## Quick Start Protocol

**Every session starts with:**

```
1. esr_get_context        — Load current graph state. Returns full state + revision number.
2. esr_mem_recall         — Check what happened last session when memory is available
```

**Subsequent state checks:**

```
esr_get_context(since_revision=N)   — Pass the revision from your last call.
                                       If unchanged: 10 tokens. If changed: full state.
```

**When beginning a task:**

```
3. esr_create_entity      — Create a Task entity (state=draft)
4. esr_link_relation      — Link dependencies (depends_on existing tasks)
5. esr_promote_task       — draft → active (work begins!)
```

**When completing a task — CLOSURE PROTOCOL (MANDATORY):**

```
6. esr_update_artifact    — For EVERY file produced or modified
7. esr_link_relation      — Task --[produces]--> Artifact
8. esr_evaluate           — With objective metrics (test_count, typecheck_errors, lines_changed...)
9. esr_get_closure_status — Check missing evidence before promotion
10. esr_mem_store         — Optional summary when memory is available
11. esr_promote_task      — active → stable only after closure is ready
```

**For multi-task initiatives:**

```
12. esr_create_entity     — Concept entity to group tasks
13. esr_link_relation     — Each task --[part_of]--> Concept
14. esr_create_entity     — Actor entity (who did the work)
15. esr_link_relation     — Actor --[evaluates]--> each task
16. esr_apply_constraint  — Quality gates (e.g. "typecheck: 0 errors")
```

## Memory Layer

ESR can integrate with an optional persistent memory layer:

- `esr_mem_store` — Record observations when a memory provider is available
- `esr_mem_recall` — Search by entity or text
- `esr_mem_timeline` — Chronological history of an entity
- `esr_mem_journal` — State transition audit trail

State changes are auto-journaled: every `draft→active`, `active→stable` transition is recorded.

When the host already has its own memory system, prefer attaching `memory_ref` instead of duplicating full memory content into ESR. ESR should remain the structured state layer, not become a second full-text memory store.

## Domain Packs

When a task is clearly domain-shaped rather than generic coding work, prefer pack-aware flow:

1. `esr_list_packs` — inspect available packs
2. `esr_detect_pack` — detect the best pack for the prompt
3. `esr_expand_with_pack` — expand into ESR entities, constraints, artifacts, and validation gaps

Current built-in packs:

- `software`
- `govdoc`
- `planning-review`

Use them to keep ESR Core generic while still supporting real enterprise scenarios.

## Golden Rules

1. **Everything meaningful → Entity** — tasks, files, decisions, concepts, constraints
2. **All structure → Relation** — connect entities with typed relations
3. **State is the only truth** — track everything through `draft→active→stable`
4. **Closure is mandatory** — every task reaching `stable` MUST produce artifact + evaluation, and should pass `esr_get_closure_status`
5. **Don't store noise** — if it can't be represented in the ontology or won't affect future decisions, don't store it

## Common Patterns

**Coding task workflow:**
```
esr_create_entity t1 Task "fix-login-bug"        → esr_promote_task t1 active
... do the work ...
esr_update_artifact a1 code {file: "src/auth.ts"} → esr_link_relation t1 produces a1
esr_evaluate t1 by-evaluator claude-code {test_count: 3, typecheck_errors: 0}
esr_get_closure_status t1
esr_mem_store t1 "Fixed null pointer in login handler, added 3 tests"   (optional)
esr_promote_task t1 stable
```

**Document writing workflow:**
```
esr_create_entity d1 Artifact "api-docs"         → esr_create_entity t1 Task "write-api-docs"
esr_link_relation t1 depends_on d1               → esr_promote_task t1 active
... write docs ...
esr_update_artifact d1 document {section: "Overview" state: stable}
esr_evaluate t1 {pages: 5, sections: 12}         → esr_promote_task t1 stable
```

**Cross-session recall:**
```
esr_get_context                                    → Load state + get current revision
esr_mem_recall {query: "login bug"}                → Find past work on similar topics
esr_mem_timeline t1                                → Audit all state changes on a task
esr_get_context(since_revision=42)                 → Check if anything changed
```

## Tool Reference

| Tool | When to use |
|------|------------|
| `esr_get_context` | Start of every session, before decisions, pass `since_revision` for incremental |
| `esr_create_entity` | New task, artifact, concept, actor, constraint |
| `esr_update_state` | Change state, confidence, or metrics |
| `esr_link_relation` | Connect any two entities |
| `esr_evaluate` | Task completion, quality assessment |
| `esr_score` | Attach numeric metrics to entities |
| `esr_promote_task` | Advance draft→active or active→stable |
| `esr_update_artifact` | Record produced/modified files |
| `esr_apply_constraint` | Add quality gates |
| `esr_get_closure_status` | Check whether a task is ready for stable |
| `esr_remove_entity` | Clean up irrelevant entities |
| `esr_remove_relation` | Remove invalid connections |
| `esr_mem_store` | Save observations for later recall when memory is available |
| `esr_mem_recall` | Search past observations |
| `esr_mem_timeline` | Audit entity history |
| `esr_mem_journal` | View/record state transitions |
