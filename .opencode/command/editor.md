---
description: Build and install OC Editor — a native macOS Monaco-based code editor with glass morphism and subagent management panels
---

Build and install the OC Editor macOS app, then open it.

Steps:
1. Navigate to the editor package: `packages/editor`
2. Run `bash install.sh` to build the Swift app and install it to `/Applications/OC Editor.app`
3. The editor will open automatically after installation

If the editor is already installed, just open it with `open "/Applications/OC Editor.app"`.

The OC Editor features:
- Monaco editor with glass morphism (transparent background, blur)
- File tree sidebar with project navigation
- Right-side agent panel showing active subagents and their tasks
- Task composer: describe a task, pick an agent, dispatch — agents work independently
- Division-of-labor workflow: you edit your own files while agents handle assigned tasks
- Connects to the local opencode server on port 4096
- Works offline (Monaco bundled locally)
- Keyboard shortcut ⌘T to dispatch selected text as a task to the active agent
