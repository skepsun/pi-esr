# ESR Memory Extension

You have access to ESR Memory tools (`esr_mem_*`). Use them to anchor observations to ESR entities and recall context by entity.

## Tools

| Tool | Description |
|------|-------------|
| `esr_mem_store` | Store an observation anchored to an ESR entity |
| `esr_mem_recall` | Recall memories: by entity_id, by text search, or both |
| `esr_mem_timeline` | Get chronological timeline for a specific entity |
| `esr_mem_journal` | View or record entity state transition journal entries |

## Usage

When you discover relevant context about an ESR entity (a task, module, constraint), anchor it with `esr_mem_store`:

```
esr_mem_store("task-auth", "JWT library upgraded from 3.x to 4.x. Breaking change: RS256 → RSASSA-PKCS1-v1_5")
```

Before making decisions about an entity, recall its history:

```
esr_mem_recall(entity_id="task-auth")
```

## Context Block

The [ESR_MEMORY] context block shows recent observations grouped by entity. It is injected automatically when ESR entities exist in the current session. Memory entries are sorted by entity id for deterministic output.
