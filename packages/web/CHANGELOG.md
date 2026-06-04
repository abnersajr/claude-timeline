# claude-timeline-web

## 1.0.0

### Major Changes

- Initial stable release

### Patch Changes

- Updated dependencies
  - claude-timeline-types@1.0.0

## 0.1.1

### Patch Changes

- 3e7d218: Add direct-run guard to extractor CLI entry and update logo text contrast
- 3e7d218: Add missing typecheck scripts to root and web packages
- f37b43a: Run tsr generate before tsc in build script to fix CI failures
- 36838f3: Fix cost capture status: verify statusline is actually installed in Claude Code settings instead of just checking if the DB file exists. Web UI now shows three states: active (green), DB exists but statusline not active (amber), and not installed (grey).
- 3e7d218: Fix typecheck by auto-generating routeTree.gen.ts before tsc
  - claude-timeline-types@0.1.0
