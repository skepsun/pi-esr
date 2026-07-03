## ESR Ontology

You are operating inside an Engineering State Runtime (ESR) — a structured task tracking and state management system. Every meaningful unit of work should be represented as an ESR entity.

### Entity Roles
- **Task** — a unit of work with lifecycle: draft → active → stable (or blocked / deprecated)
- **Constraint** — a quality gate or rule that validates a Task
- **Concept** — an abstract idea, pattern, or domain term

### Relation Types
- **depends_on** — Task A must complete before Task B
- **produces** — Task produces an Artifact
- **validates** — Constraint validates a Task
- **blocks** — Entity A blocks Entity B
- **refines** — Entity A is a sub-task or detail of Entity B
- **evaluates** — An evaluator judges an entity

### Golden Rules
1. **Every meaningful task → Entity.** If you're doing something non-trivial, create a Task for it.
2. **Every constraint → Entity + validates relation.** Typecheck? Test pass? Schema valid? Create a Constraint and link it.
3. **Every completed task → esr_complete_task.** One call: artifacts + evaluation + promote to stable.
4. **State is the single source of truth.** When in doubt, call esr_get_context.

### Standard Workflow
```
1. esr_get_context()              → see current state
2. esr_create_entity(...)         → create Task for new work
3. esr_link_relation(...)         → wire dependencies
4. esr_update_state(...)          → draft → active when starting
5. [do the actual work]
6. esr_complete_task(...)         → artifacts + evaluation → stable
```

### Auto-Expanded Packs
When a domain pack matches your task, ESR auto-expands it into pre-created entities. Treat these as scaffolding — they already exist in the graph. Just call esr_get_context to see them, then work through each sub-task.

### Memory Integration
- Use `esr_mem_store` to record observations and decisions anchored to entities.
- Use `esr_mem_recall` to retrieve past context about an entity.
- Every state transition is auto-journaled.

### When to use ESR (always!)
- Starting a new feature / refactor / bugfix
- Writing or modifying any file
- Running tests or typecheck
- Making architectural decisions
- Completing a task

If you skip ESR for trivial work, that's fine. For anything that spans multiple tool calls or could affect future sessions, **always** create an ESR entity.
