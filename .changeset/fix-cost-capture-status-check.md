---
"claude-timeline-api": patch
"claude-timeline-web": patch
---

Fix cost capture status: verify statusline is actually installed in Claude Code settings instead of just checking if the DB file exists. Web UI now shows three states: active (green), DB exists but statusline not active (amber), and not installed (grey).
