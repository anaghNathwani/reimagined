# Reimagined

> A heavily modified fork of [opencode](https://github.com/anomalyco/opencode) with an opencode kernel at its core.

Reimagined takes the open source opencode engine and builds on top of it with significant modifications, additional tooling, a native Tauri-based editor, and extended provider support. The underlying session management, LSP integration, and AI inference pipeline are powered by the opencode kernel — everything on top is Reimagined.

---

## What's different from upstream opencode

- **Tauri editor** — a fully featured IDE built with Tauri v2 + SolidJS, Monaco editor, xterm.js terminal, LSP support, git gutter, find-in-files, command palette, and status bar
- **Extended provider support** — local model inference, native provider bindings, and additional third-party provider integrations
- **Subagent sidebar** — automatic tab switching when subagents appear in a session
- **Modified prompts** — custom system prompts tuned for different model families (Anthropic, Gemini, GPT, Kimi, Codex, etc.)
- **Custom commands** — additional slash commands for managing sessions, clearing context, and launching the editor

---

## Kernel

The core of Reimagined is the opencode kernel — the original open source AI coding agent by [anomalyco](https://github.com/anomalyco/opencode). It handles:

- Session and message management
- Tool execution (file read/write, shell, LSP, web search)
- Provider abstraction and model routing
- Context compaction and token budgeting
- The TUI and ACP server

---

## Getting started

```bash
# Install
curl -fsSL https://opencode.ai/install | bash

# Run the editor
cd packages/editor
bun x vite          # start frontend dev server
cargo tauri dev     # launch the Tauri app
```

---

## Credits

Built on top of [opencode](https://github.com/anomalyco/opencode) — the open source AI coding agent. All upstream opencode code retains its original license.
