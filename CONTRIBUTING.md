# Contributing to pi-esr

## Development Setup

```bash
git clone <repo-url>
cd pi-esr
npm install
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm test` | Run all 124 tests via vitest |
| `npm run test:watch` | Watch mode |
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm run build` | Compile TypeScript to `dist/` |

## Architecture

See README.md for the full architecture diagram and component descriptions.

## Code Style

- TypeScript strict mode (`strict: true`)
- `Result<T>` pattern: `{ ok: true; value?: T } | { ok: false; error: string }` — no exceptions
- Defensive copies on all read operations
- All context output must be deterministically sorted for prefix-cache stability

## Adding a New ESR Tool

1. Add the core logic to `extensions/core/graph.ts`
2. Register a runtime driver handler in `extensions/integration/tools.ts` (inside `registerRuntimeHandlers`)
3. Register the tool definition in `extensions/integration/tools.ts` (inside `registerTools`)
4. Add tests in `tests/tools.test.ts`

## Ontology Constraints

- Entity roles MUST be one of: Actor, Artifact, Task, Concept, Constraint
- Relation types MUST be from the allowed set (see validation.ts)
- State transitions MUST follow the matrix in validation.ts
- Structural edges (depends_on, part_of, implements, triggers) MUST be cycle-free

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run tests/graph.test.ts

# Efficiency benchmarks
npx vitest run tests/validate-efficiency.test.ts --reporter=verbose
```

All PRs must pass `npm test` and `npm run typecheck` before merge.
