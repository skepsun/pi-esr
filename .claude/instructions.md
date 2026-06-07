## ESR Quick Commands

When the user types these shortcuts, map them to ESR tool calls:

- `/esr` → call `esr_get_context`, show a summary
- `/esr-clear` → call `esr_remove_entity` for all entities
- `/esr-run` → call `esr_run`

Also: before making any engineering decision, call `esr_get_context` first to check the current graph state.
