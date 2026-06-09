# Changelog

## [0.3.1] — 2026-06-07

### Added
- File-based ESR graph persistence: `esr-state.json` at project level (`.pi-esr-memory/`)
- Cross-session ESR state continuity — new sessions now inherit the latest ESR graph state

### Changed
- `reconstructGraph()` now falls back to file persistence when session branch has no ESR entries
- `persistGraph()` now writes both to session branch and to project-level file
- `/esr-clear` command now also clears the project-level state file

## [0.2.0] — 2026-06-07

### Added
- Memory layer: `esr_mem_store`, `esr_mem_recall`, `esr_mem_timeline`, `esr_mem_journal` tools
- Entity-anchored observation storage with SQLite (better-sqlite3)
- State transition journal with auto-recording
- Memory context injection into system prompt
- Efficiency benchmarks: `validate-efficiency.test.ts` (15 tests)
- Token compression, prefix-cache stability, cost projection validation

### Changed
- Memory DB default: project-level `$CWD/.pi-esr-memory/` (was user-level `~/.pi-esr-memory`)
  Set `PI_ESR_MEMORY_DIR` to restore the old user-global behaviour
- Session ID automatically injected as `session:<id>` tag on every observation
- README updated to reflect 129 tests, 16 tools, 3-layer scoping model

### Fixed
- Test count discrepancy in README (85 → 129)

## [0.1.0] — 2026-05-31

### Added
- Initial release
- ESRGraph core state machine with entity CRUD, typed relations, state transitions
- 11 ESR tools: create_entity, update_state, link_relation, evaluate, score, promote_task, update_artifact, apply_constraint, get_context, remove_entity, remove_relation
- Prefix-cache stability (deterministic context sorting, DJB2 fingerprint)
- Persistence layer: graph state
- TUI commands: /esr, /esr-clear
- 85 tests across 6 test files
