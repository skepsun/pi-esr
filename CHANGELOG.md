# Changelog

## [0.4.0] — 2026-07-02

### Added
- `agent-tool@0.1.0` domain pack: tool contract, schema design, error taxonomy, timeout strategy, and idempotency checks
- `[ESR_SNAPSHOT]` auto-injection: compact task + constraint summary injected into system prompt every turn
- Pack auto-expand now lists concrete entity IDs + constraints + actionable next steps

### Changed
- `prompts/esr.md`: expanded from 1 line to full ontology, golden rules, closure protocol, workflow guide, and "when to use ESR"
- `buildStaticPrompt()` → `buildESRPrompt(stateSummary?, packHint?)`: composes methodology + dynamic snapshot + pack hint
- Default closure policy: `require_constraints_satisfied_for_stable` changed to `false` (constraints are advisory by default)

### Fixed
- Closure test now explicitly passes `require_constraints_satisfied_for_stable: true` policy
- Pack integration tests now supply real pack objects instead of empty array
- Vitest config aliases extended with all domain pack packages

## [0.5.0] — 2026-07-03

### Added
- `esr_complete_task` tool — single-call task closure combining artifact recording, evaluation, memory ref attachment, closure validation, and promotion to stable
- End-to-end benchmark (21 tests) simulating a 3-session refactor scenario
- `pi-memory-stack` meta package structure bundling context-mode + pi-loom + pi-esr
- Layer detection protocol documentation (DESIGN.md)

### Changed
- Slimmed `prompts/esr.md` from 55 lines to 1 paragraph — ontology details moved to `skills/esr/SKILL.md` (on-demand via `/skill:esr`)
- SKILL.md reorganized: `esr_complete_task` as primary completion path, low-level tools documented as extended
- Tool reference table split into Core (7 tools) and Extended (14 tools) sections

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
