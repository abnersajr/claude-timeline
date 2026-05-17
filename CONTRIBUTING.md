# Contributing to claude-timeline

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

1. **Prerequisites**: Node.js ≥ 18, pnpm ≥ 11
2. **Clone**: `git clone https://github.com/abnersajr/claude-timeline.git`
3. **Install**: `pnpm install`
4. **Dev**: `pnpm dev` (starts API + web UI)

## Project Structure

This is a pnpm monorepo with four packages:

| Package | Purpose | Publishable |
|---------|---------|-------------|
| `extractor/` | Core extraction library + CLI | ✅ npm |
| `api/` | Express REST API server | ❌ |
| `types/` | Shared TypeScript types | ❌ |
| `web/` | React web UI | ❌ |

## Conventions

- **Language**: TypeScript (no Bun)
- **Linting**: Biome only — no ESLint, no Prettier
- **Editor**: Follow `.editorconfig`
- **Imports**: Import from canonical module locations (no barrel files)
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) format, ≤50 char subject
- **Tests**: Vitest, use seeded fixtures, never connect to real databases

## Making Changes

1. Create a branch: `git checkout -b feat/my-feature`
2. Make your changes
3. Run `pnpm typecheck && pnpm test && pnpm lint`
4. Commit with a conventional commit message
5. Open a PR against `main`

## Testing

```bash
# Run all tests
pnpm test

# Run specific package tests
pnpm --filter extractor test
pnpm --filter claude-timeline-api test

# Type check
pnpm typecheck
```

## Adding Dependencies

- Use `pnpm add <pkg>` in the relevant package directory
- Lock file (`pnpm-lock.yaml`) must be committed

## Questions?

Open a [GitHub Discussion](https://github.com/abnersajr/claude-timeline/discussions) or [Issue](https://github.com/abnersajr/claude-timeline/issues).
