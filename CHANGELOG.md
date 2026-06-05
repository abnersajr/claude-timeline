# claude-timeline

## 1.0.2

### Patch Changes

- Read CLI version dynamically from package.json instead of hardcoded string

## 1.0.1

### Patch Changes

- Fix CLI crash on startup caused by index.ts self-executing guard conflicting with commander. Fix web UI infinite loading by correcting API base URL default. Fix "unknown model" warning by handling literal "unknown" values in SQLite. Add missing /api/status and /api/settings routes to bundled server. Set executable permission on dist/cli.js after build.

## 1.0.0

### Major Changes

- v1.0.0 — unified single-package release

  - Web UI, API server, CLI, and extractor bundled into one package
  - Install with `npm install -g @abnersajr/claude-timeline`
  - Run with `claude-timeline serve`
