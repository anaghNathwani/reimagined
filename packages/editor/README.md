# OC Editor

A native macOS code editor built with Swift + WKWebView, embedding Monaco Editor with glass morphism aesthetics. Designed for division-of-labor workflows where you edit your own code while AI agents handle delegated tasks.

## Features

- **Monaco editor** with transparent glass background (native blur via NSVisualEffectView)
- **File tree sidebar** for project navigation
- **Agent management panel** showing active subagents and task status in real-time
- **Task composer**: describe a task → pick an agent → dispatch. Agents run independently.
- **⌘T** shortcut: select code in editor → dispatch selected text as agent task
- Connects to opencode server (port 4096) for real-time agent status
- Offline capable (Monaco bundled locally via `scripts/download-monaco.sh`)

## Architecture

```
macOS App (Swift/SwiftUI)
├── ContentView.swift        — three-column layout (sidebar | editor | agents)
├── SidebarView.swift        — file tree + task composer
├── MonacoEditorView.swift   — WKWebView wrapping Monaco
├── AgentPanelView.swift     — subagent task cards with live status
├── AgentStore.swift         — connects to opencode HTTP API (port 4096)
└── Resources/
    ├── editor.html          — Monaco shell with glass-morphism CSS
    └── monaco/              — bundled Monaco (run scripts/download-monaco.sh)
```

## Install

### Via opencode slash command
In any opencode session, type:
```
/editor
```

### Manual
```bash
# Download Monaco for offline use (optional)
bash scripts/download-monaco.sh

# Build and install to /Applications/OC Editor.app
bash install.sh
```

## Requirements

- macOS 14.0+
- Xcode Command Line Tools (`xcode-select --install`)
- Swift 5.9+
- opencode running locally (`opencode serve` on port 4096)

## Division of Labor

The core idea: **you write, agents delegate**.

1. Open your project in the file tree
2. Edit files in Monaco normally
3. When you encounter a subtask (tests, docs, refactor), use the task composer in the sidebar:
   - Pick the right agent (e.g., `test-writer`, `documenter`, `build`)
   - Describe what you want
   - Hit **Dispatch** — agent works asynchronously
4. The right panel shows all active agents and their task status
5. Use **⌘T** to quickly dispatch the selected code/text as a task
