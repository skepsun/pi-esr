# Changelog

## [0.2.0] — 2026-06-07

### Added
- Memory layer: `esr_mem_store`, `esr_mem_recall`, `esr_mem_timeline`, `esr_mem_journal` tools
- Entity-anchored observation storage with SQLite (better-sqlite3)
- State transition journal with auto-recording
- Memory context injection into system prompt
- Efficiency benchmarks: `validate-efficiency.test.ts` (15 tests)
- Token compression, prefix-cache stability, cost projection validation

### Changed
- README updated to reflect 121 tests, 16 tools, memory module architecture

### Fixed
- Test count discrepancy in README (85 → 121)

## [0.1.0] — 2026-05-31

### Added
- Initial release
- ESRGraph core state machine with entity CRUD, typed relations, state transitions
- 12 ESR tools: create_entity, update_state, link_relation, evaluate, score, promote_task, update_artifact, apply_constraint, get_context, remove_entity, remove_relation, create_node
- DAG-based runtime engine: planner, executor, scheduler, cache
- SHA256 deterministic cache keys with invalidation cascade
- Prefix-cache stability (deterministic context sorting, DJB2 fingerprint)
- Persistence layer: graph, runtime state, runtime cache
- TUI commands: /esr, /esr-clear, /esr-step, /esr-run
- 85 tests across 6 test files
