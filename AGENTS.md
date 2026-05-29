# Agents Instructions

Guidelines for AI coding agents (Claude Code, Cursor, Copilot, etc.) working on this repo.

## Project Structure

This is a **pnpm monorepo** with Turborepo. Five packages:

| Package | Name | Purpose |
|---------|------|---------|
| root | `claude-timeline` | CLI + server + web UI. **This is what publishes to npm.** |
| `packages/extractor` | `claude-timeline-extractor` | Core library. 21 subpath exports. |
| `packages/api` | `claude-timeline-api` | Express REST API server. |
| `packages/web` | `claude-timeline-web` | React 19 + Tailwind v4 web UI. |
| `packages/types` | `claude-timeline-types` | Shared TypeScript types. |

**Key:** The root package is the CLI distribution. The extractor is the library. They are different npm packages.

## Commands

```bash
pnpm install              # install all deps
pnpm build                # full build (types → CLI → web → server)
pnpm --filter claude-timeline-extractor test   # run tests
pnpm typecheck            # type check all packages
pnpm lint                 # biome lint
pnpm dev                  # dev server (HTTP)
```

## Conventions

- **Language:** TypeScript (strict, ESM). No Bun.
- **Linting:** Biome only — no ESLint, no Prettier.
- **Tests:** Vitest. Use seeded fixtures, never real databases.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `chore:`, etc.
- **Imports:** No barrel files. Import from canonical module locations.
- **Package manager:** pnpm 11.0.3 (pinned in `packageManager` field).
- **Node: >= 22

## Release Process

Releases use [Changesets](https://github.com/changesets/changesets).

### Adding a changeset

After making changes, always add a changeset:

```bash
pnpm changeset
```

Follow the prompts:
1. **Which packages changed?** — select the affected packages
2. **Semver bump:** `patch` (bugfix), `minor` (feature), `major` (breaking)
3. **Summary:** Write a short description of the change

This creates a markdown file in `.changeset/`. **Commit it with your changes.**

### How releases work

1. Push changes to `main` (including the `.changeset/*.md` file)
2. The `release.yml` GitHub Action runs `changesets/action`
3. If there are pending changesets → it opens/updates a **"Version Packages" PR**
4. When you **merge that PR** → it auto-publishes to npm

```
your changes → .changeset/xxx.md → push to main
                                      ↓
                              Version Packages PR (auto)
                                      ↓
                                    merge → npm publish 🚀
```

### First-time npm setup

```bash
npm login
npm publish --access public   # claim the package name
```

### Required secrets

- `NPM_TOKEN` — npm automation token (Settings → Secrets → Actions)

### What NOT to do

- Do NOT run `npm publish` manually — let changesets handle it
- Do NOT bump versions in package.json manually — changesets does this
- Do NOT delete `.changeset/` files — they are the release instructions

## Common Pitfalls

- `tsx watch` ignores workspace dist changes — touch a source file to trigger restart
- Extractor modules MUST be in `package.json` `exports` — Node enforces at runtime
- `process.env.NODE_ENV` in tests needs `define: { "process.env.NODE_ENV": '"development"' }` in vitest.config.ts
- The `update-pricing` command fetches from `platform.claude.com/docs` — no API exists, it scrapes HTML
- `~/.claude-timeline/cost-stream.db` is the data path (NOT `~/.claude-dash/`)

## File Ownership

| Area | Key files |
|------|-----------|
| CLI | `packages/extractor/src/cli.ts` |
| Pricing | `packages/extractor/src/pricing.ts`, `pricing-scraper.ts` |
| API | `packages/api/src/serve.ts`, `routes/` |
| Web UI | `packages/web/src/` |
| Build | `scripts/build.mjs` |
| CI | `.github/workflows/ci.yml`, `release.yml` |
