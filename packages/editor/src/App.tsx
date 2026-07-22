import { createSignal, Show, onMount } from "solid-js"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"
import Sidebar from "./components/Sidebar"
import EditorPane from "./components/EditorPane"
import TerminalPane from "./components/TerminalPane"
import AgentPanel from "./components/AgentPanel"
import CommandPalette, { type PaletteCommand } from "./components/CommandPalette"
import SearchPanel from "./components/SearchPanel"

type Panel = "files" | "search" | "agents" | null

const IC = {
  files:   `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 2.5A1.5 1.5 0 013.5 1h6.086a1.5 1.5 0 011.06.44l2.915 2.914A1.5 1.5 0 0114 5.414V13.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 13.5v-11z" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 1v3.5H13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  search:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.2"/><path d="M10 10l3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  agents:  `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="5" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 14c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="12.5" cy="3.5" r="1.5" stroke="currentColor" stroke-width="1"/><path d="M12.5 5.5v1.5M11 5l1 1" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>`,
  terminal:`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M4 6l2.5 2L4 10M8 10h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  folder:  `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 3.5A1.5 1.5 0 012.5 2H5l1.5 1.5H11.5A1.5 1.5 0 0113 5.5v5A1.5 1.5 0 0111.5 12h-9A1.5 1.5 0 011 10.5v-7z" stroke="currentColor" stroke-width="1.2"/></svg>`,
  close:   `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
}

function Icon(props: { html: string; style?: string }) {
  return <span style={{ display: "inline-flex", "align-items": "center", ...(props.style ? {} : {}) }} innerHTML={props.html} />
}

export default function App() {
  const [projectPath, setProjectPath] = createSignal("")
  const [updateAvailable, setUpdateAvailable] = createSignal<string | null>(null)
  const [installing, setInstalling] = createSignal(false)

  onMount(async () => {
    try {
      const info = await invoke<{ available: boolean; version: string | null }>("check_update")
      if (info.available && info.version) setUpdateAvailable(info.version)
    } catch { /* no update server yet — silent */ }
  })

  const installUpdate = async () => {
    setInstalling(true)
    try { await invoke("install_update") } catch { setInstalling(false) }
  }
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)
  const [showTerminal, setShowTerminal] = createSignal(false)
  const [activePanel, setActivePanel] = createSignal<Panel>("files")
  const [sidebarWidth, setSidebarWidth] = createSignal(230)
  const [agentWidth, setAgentWidth] = createSignal(270)
  const [terminalHeight, setTerminalHeight] = createSignal(220)
  const [palette, setPalette] = createSignal<"files" | "commands" | null>(null)

  const openFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "Open Project" })
    if (dir && typeof dir === "string") setProjectPath(dir)
  }

  const jumpToLocation = (file: string, line: number, col: number) => {
    setSelectedFile(file)
    setTimeout(() => { (window as any).__editorJumpTo?.(file, line, col) }, 100)
  }

  const togglePanel = (p: Panel) => setActivePanel(v => v === p ? null : p)

  const paletteCommands: PaletteCommand[] = [
    { id: "open-folder",   label: "Open Folder…",     keybind: "⌘O",     action: openFolder },
    { id: "toggle-term",   label: "Toggle Terminal",   keybind: "Ctrl+`", action: () => setShowTerminal(v => !v) },
    { id: "find-in-files", label: "Find in Files",     keybind: "⌘⇧F",   action: () => setActivePanel("search") },
    { id: "go-to-file",    label: "Go to File…",       keybind: "⌘P",    action: () => setPalette("files") },
    { id: "toggle-agents", label: "Toggle Agents",                        action: () => togglePanel("agents") },
  ]

  const onKeyDown = (e: KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey
    if (meta && !e.shiftKey && e.key === "o") { e.preventDefault(); openFolder() }
    if (meta && !e.shiftKey && e.key === "p") { e.preventDefault(); setPalette("files") }
    if (meta && e.shiftKey  && e.key === "P") { e.preventDefault(); setPalette("commands") }
    if (meta && e.shiftKey  && e.key === "F") { e.preventDefault(); setActivePanel("search") }
    if (e.ctrlKey && e.key === "`")           { e.preventDefault(); setShowTerminal(v => !v) }
    if (e.key === "Escape" && palette())       { setPalette(null) }
  }

  const projectName = () => projectPath() ? projectPath().split("/").pop()! : "Reimagined Editor"

  return (
    <div
      style={{
        display: "flex", "flex-direction": "column", height: "100%",
        background: "rgba(13,17,23,0.93)",
        "backdrop-filter": "blur(32px) saturate(180%)",
        "-webkit-backdrop-filter": "blur(32px) saturate(180%)",
        "border-radius": "10px",
        overflow: "hidden",
      }}
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      {/* ── Title bar ── */}
      <div
        data-tauri-drag-region
        style={{
          height: "38px", "flex-shrink": 0,
          display: "flex", "align-items": "center",
          "padding-left": "76px", "padding-right": "12px", gap: "6px",
          background: "rgba(10,13,18,0.5)",
          "border-bottom": "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <span
          data-tauri-drag-region
          style={{
            flex: 1, "font-size": "12px", "font-weight": 500,
            color: "rgba(230,237,243,0.45)",
            "pointer-events": "none", "user-select": "none",
            overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap",
          }}
        >
          {projectName()}
        </span>
        <div style={{ display: "flex", "align-items": "center", gap: "6px", "-webkit-app-region": "no-drag" }}>
          <Show when={updateAvailable()}>
            {(version) => (
              <button
                onClick={installUpdate}
                disabled={installing()}
                style={{
                  display: "flex", "align-items": "center", gap: "5px",
                  background: "rgba(63,185,80,0.15)", border: "1px solid rgba(63,185,80,0.35)",
                  color: "#3fb950", "border-radius": "10px", padding: "2px 9px",
                  "font-size": "11px", "font-weight": 500, cursor: "pointer",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(63,185,80,0.25)" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(63,185,80,0.15)" }}
              >
                <span style={{ "font-size": "9px" }}>▲</span>
                {installing() ? "Installing…" : `Update ${version()}`}
              </button>
            )}
          </Show>
          <div style={{ display: "flex", gap: "2px" }}>
            <TitleBtn label="Open folder" onClick={openFolder} icon={IC.folder} />
            <TitleBtn label="Go to file (⌘P)" onClick={() => setPalette("files")} icon={IC.search} />
            <TitleBtn label="Toggle terminal (Ctrl+`)" onClick={() => setShowTerminal(v => !v)} active={showTerminal()} icon={IC.terminal} />
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", "min-height": 0 }}>

        {/* ── Activity bar ── */}
        <div style={{
          width: "44px", "flex-shrink": 0,
          display: "flex", "flex-direction": "column", "align-items": "center",
          padding: "6px 0", gap: "2px",
          background: "rgba(10,13,18,0.4)",
          "border-right": "1px solid rgba(255,255,255,0.07)",
        }}>
          <ActivityBtn icon={IC.files}  label="Explorer"    active={activePanel() === "files"}  onClick={() => togglePanel("files")} />
          <ActivityBtn icon={IC.search} label="Search"      active={activePanel() === "search"} onClick={() => togglePanel("search")} />
          <ActivityBtn icon={IC.agents} label="Agents"      active={activePanel() === "agents"} onClick={() => togglePanel("agents")} />
        </div>

        {/* ── Sidebar panel ── */}
        <Show when={activePanel() !== null}>
          <div style={{
            width: `${activePanel() === "agents" ? agentWidth() : sidebarWidth()}px`,
            "flex-shrink": 0,
            display: "flex", "flex-direction": "column",
            background: "rgba(13,17,23,0.5)",
            "border-right": activePanel() !== "agents" ? "1px solid rgba(255,255,255,0.07)" : "none",
            "border-left": activePanel() === "agents" ? "none" : "none",
            overflow: "hidden",
          }}>
            <div style={{
              height: "35px", "flex-shrink": 0,
              display: "flex", "align-items": "center",
              padding: "0 12px",
              "border-bottom": "1px solid rgba(255,255,255,0.07)",
            }}>
              <span style={{
                "font-size": "10px", "font-weight": 700,
                color: "rgba(230,237,243,0.25)",
                "text-transform": "uppercase", "letter-spacing": "0.1em",
                flex: 1,
              }}>
                {activePanel() === "files" ? "Explorer" : activePanel() === "search" ? "Search" : "Agents"}
              </span>
              <Show when={activePanel() === "files"}>
                <button
                  title="Open Folder (⌘O)"
                  onClick={openFolder}
                  style={{ background: "transparent", border: "none", color: "rgba(230,237,243,0.35)", cursor: "pointer", display: "flex", "align-items": "center", "border-radius": "4px", padding: "3px" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span innerHTML={IC.folder} style={{ display: "inline-flex" }} />
                </button>
              </Show>
            </div>

            <div style={{ flex: 1, overflow: "hidden" }}>
              <Show when={activePanel() === "files"}>
                <Sidebar projectPath={projectPath()} selectedFile={selectedFile()} onSelectFile={setSelectedFile} onOpenFolder={openFolder} />
              </Show>
              <Show when={activePanel() === "search"}>
                <SearchPanel projectPath={projectPath()} onJump={jumpToLocation} />
              </Show>
              <Show when={activePanel() === "agents"}>
                <AgentPanel projectPath={projectPath()} />
              </Show>
            </div>
          </div>

          <ResizeBar
            onDelta={(d) => {
              if (activePanel() === "agents") setAgentWidth(w => Math.max(200, Math.min(520, w - d)))
              else setSidebarWidth(w => Math.max(160, Math.min(480, w + d)))
            }}
            cursor="col-resize"
          />
        </Show>

        {/* ── Main editor + terminal ── */}
        <div style={{ flex: 1, display: "flex", "flex-direction": "column", "min-width": 0, overflow: "hidden" }}>
          <div style={{ flex: 1, "min-height": 0, overflow: "hidden" }}>
            <Show
              when={selectedFile() || projectPath()}
              fallback={<EmptyState onOpenFolder={openFolder} onPalette={() => setPalette("files")} />}
            >
              <EditorPane filePath={selectedFile()} projectPath={projectPath()} />
            </Show>
          </div>

          <Show when={showTerminal()}>
            <ResizeBar onDelta={(d) => setTerminalHeight(h => Math.max(120, Math.min(700, h - d)))} cursor="row-resize" horizontal />
            <div style={{ height: `${terminalHeight()}px`, "flex-shrink": 0, display: "flex", "flex-direction": "column", "border-top": "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ height: "32px", "flex-shrink": 0, display: "flex", "align-items": "center", padding: "0 12px", gap: "8px", background: "rgba(10,13,18,0.5)", "border-bottom": "1px solid rgba(255,255,255,0.07)" }}>
                <span innerHTML={IC.terminal} style={{ display: "inline-flex", color: "rgba(230,237,243,0.3)" }} />
                <span style={{ "font-size": "11px", "font-weight": 500, color: "rgba(230,237,243,0.4)", flex: 1 }}>Terminal</span>
                <button
                  onClick={() => setShowTerminal(false)}
                  style={{ width: "20px", height: "20px", border: "none", "border-radius": "4px", background: "transparent", color: "rgba(230,237,243,0.3)", cursor: "pointer", display: "flex", "align-items": "center", "justify-content": "center" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(248,81,73,0.15)"; (e.currentTarget as HTMLElement).style.color = "#f85149" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "rgba(230,237,243,0.3)" }}
                >
                  <span innerHTML={IC.close} style={{ display: "inline-flex" }} />
                </button>
              </div>
              <div style={{ flex: 1, "min-height": 0 }}>
                <TerminalPane projectPath={projectPath()} />
              </div>
            </div>
          </Show>
        </div>
      </div>

      {/* Command Palette */}
      <Show when={palette()}>
        {(mode) => (
          <CommandPalette mode={mode()} projectPath={projectPath()} commands={paletteCommands} onOpenFile={setSelectedFile} onClose={() => setPalette(null)} />
        )}
      </Show>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ActivityBtn(props: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      title={props.label}
      onClick={props.onClick}
      style={{
        width: "34px", height: "34px",
        border: "none", "border-radius": "8px",
        background: props.active ? "rgba(88,166,255,0.12)" : "transparent",
        color: props.active ? "#58a6ff" : "rgba(230,237,243,0.28)",
        cursor: "pointer",
        display: "flex", "align-items": "center", "justify-content": "center",
        transition: "background 0.12s, color 0.12s",
        position: "relative",
      }}
      onMouseEnter={(e) => { if (!props.active) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.07)"; (e.currentTarget as HTMLElement).style.color = "rgba(230,237,243,0.6)" } }}
      onMouseLeave={(e) => { if (!props.active) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "rgba(230,237,243,0.28)" } }}
    >
      <span innerHTML={props.icon} style={{ display: "inline-flex" }} />
    </button>
  )
}

function TitleBtn(props: { label: string; icon: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      title={props.label}
      onClick={props.onClick}
      style={{
        width: "26px", height: "24px",
        border: "none", "border-radius": "5px",
        background: props.active ? "rgba(88,166,255,0.12)" : "transparent",
        color: props.active ? "#58a6ff" : "rgba(230,237,243,0.35)",
        cursor: "pointer",
        display: "flex", "align-items": "center", "justify-content": "center",
        transition: "background 0.12s, color 0.12s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.color = "rgba(230,237,243,0.85)" }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = props.active ? "rgba(88,166,255,0.12)" : "transparent"; (e.currentTarget as HTMLElement).style.color = props.active ? "#58a6ff" : "rgba(230,237,243,0.35)" }}
    >
      <span innerHTML={props.icon} style={{ display: "inline-flex" }} />
    </button>
  )
}

function ResizeBar(props: { onDelta: (d: number) => void; cursor: string; horizontal?: boolean }) {
  let startPos = 0
  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault()
    startPos = props.horizontal ? e.clientY : e.clientX
    const onMove = (ev: MouseEvent) => {
      const pos = props.horizontal ? ev.clientY : ev.clientX
      props.onDelta(pos - startPos)
      startPos = pos
    }
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        [props.horizontal ? "height" : "width"]: "1px",
        "flex-shrink": 0, cursor: props.cursor,
        background: "rgba(255,255,255,0.06)",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "rgba(88,166,255,0.5)" }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "rgba(255,255,255,0.06)" }}
    />
  )
}

function EmptyState(props: { onOpenFolder: () => void; onPalette: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", "flex-direction": "column", "align-items": "center", "justify-content": "center", gap: "20px", color: "rgba(230,237,243,0.2)", "user-select": "none", height: "100%" }}>
      <svg width="52" height="52" viewBox="0 0 52 52" fill="none" style={{ opacity: "0.12" }}>
        <rect x="6" y="10" width="40" height="32" rx="4" stroke="currentColor" stroke-width="2.5"/>
        <path d="M6 18h40M16 10v8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="11" cy="14" r="1.5" fill="currentColor"/>
        <circle cx="16" cy="14" r="1.5" fill="currentColor"/>
        <circle cx="21" cy="14" r="1.5" fill="currentColor"/>
        <path d="M16 28l5 4-5 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M24 36h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <div style={{ "text-align": "center", "line-height": "1.7" }}>
        <div style={{ "font-size": "15px", "font-weight": 600, color: "rgba(230,237,243,0.35)", "margin-bottom": "6px" }}>Reimagined Editor</div>
        <div style={{ "font-size": "12px", color: "rgba(230,237,243,0.2)" }}>Open a folder or file to get started</div>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <Kb label="⌘O" hint="Open folder" onClick={props.onOpenFolder} />
        <Kb label="⌘P" hint="Go to file" onClick={props.onPalette} />
      </div>
    </div>
  )
}

function Kb(props: { label: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      style={{
        display: "flex", "align-items": "center", gap: "6px",
        padding: "5px 10px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        "border-radius": "6px",
        color: "rgba(230,237,243,0.35)",
        cursor: "pointer",
        "font-size": "11px",
        transition: "background 0.1s, color 0.1s",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.color = "rgba(230,237,243,0.7)" }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; (e.currentTarget as HTMLElement).style.color = "rgba(230,237,243,0.35)" }}
    >
      <span style={{ "font-family": "monospace", "font-weight": 600 }}>{props.label}</span>
      <span>{props.hint}</span>
    </button>
  )
}
