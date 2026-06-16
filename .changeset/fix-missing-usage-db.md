---
"@abnersajr/claude-timeline": patch
---

fix: gracefully handle missing usage.db on first-time setup

Claude Code creates usage.db — if it doesn't exist yet, the server crashed with DbOpenError.
Now returns empty list and falls back to JSONL files, with a startup warning.
