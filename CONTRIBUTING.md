# Contributing to claude-timeline

Thanks for your interest in contributing! Here's how to get started.

## Prerequisites

- Node.js ≥ 18
- pnpm ≥ 11

## Development Setup

1. **Clone**: `git clone https://github.com/abnersajr/claude-timeline.git`
2. **Install**: `pnpm install`
3. **Dev**: `pnpm dev` (starts API + web UI)

## Project Structure

This is a pnpm monorepo with five packages:

| Package | Path | Purpose | Publishable |
|---------|------|---------|-------------|
| `claude-timeline` | `./` | CLI entry point | ✅ npm |
| `claude-timeline-extractor` | `packages/extractor/` | Core extraction library | ✅ npm |
| `claude-timeline-api` | `packages/api/` | Express REST API | ❌ |
| `claude-timeline-web` | `packages/web/` | React web UI | ❌ (private) |
| `claude-timeline-types` | `packages/types/` | Shared TypeScript types | ❌ |

## Conventions

- **Language**: TypeScript (strict, ESM)
- **Linting**: Biome — no ESLint, no Prettier
- **Tests**: Vitest with seeded fixtures
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) format

## Testing

```bash
pnpm test                          # all packages
pnpm --filter claude-timeline-extractor test
pnpm --filter claude-timeline-api test
pnpm --filter claude-timeline-web test
pnpm typecheck                     # type check
```

## Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning and releases.

1. Run `pnpm changeset` to create a changeset after your changes
2. Select the affected package and bump level (patch/minor/major)
3. Write a summary, then commit the generated `.changeset/*.md` file

On release, `changeset version` bumps versions and `changeset publish` publishes to npm.

## PR Process

1. Create a branch: `git checkout -b feat/my-feature`
2. Make changes and write tests if applicable
3. Run `pnpm typecheck && pnpm lint && pnpm test`
4. Create a changeset if the change is publishable
5. Commit with a conventional commit message
6. Open a PR against `main`

## Links

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [GitHub Discussions](https://github.com/abnersajr/claude-timeline/discussions)
- [Issues](https://github.com/abnersajr/claude-timeline/issues)
