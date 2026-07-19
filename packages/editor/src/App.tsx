import { createSignal, Show } from "solid-js"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import Sidebar from "./components/Sidebar"
import EditorPane from "./components/EditorPane"
import TerminalPane from "./components/TerminalPane"
import AgentPanel from "./components/AgentPanel"
import CommandPalette, { type PaletteCommand } from "./components/CommandPalette"
import SearchPanel from "./components/SearchPanel"

type SidebarTab = "files" | "search"

export default function App() {
  const [projectPath, setProjectPath] = createSignal("")
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)
  const [showTerminal, setShowTerminal] = createSignal(false)
  const [showAgents, setShowAgents] = createSignal(true)
  const [sidebarWidth, setSidebarWidth] = createSignal(240)
  const [agentWidth, setAgentWidth] = createSignal(280)
  const [terminalHeight, setTerminalHeight] = createSignal(220)
  const [sidebarTab, setSidebarTab] = createSignal<SidebarTab>("files")
  const [palette, setPalette] = createSignal<"files" | "commands" | null>(null)

  const openFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "Open Project" })
    if (dir && typeof dir === "string") setProjectPath(dir)
  }

  const openFile = (path: string) => setSelectedFile(path)

  const jumpToLocation = (file: string, line: number, col: number) => {
    setSelectedFile(file)
    // Give EditorPane time to open the file, then jump
    setTimeout(() => {
      ;(window as any).__editorJumpTo?.(file, line, col)
    }, 100)
  }

  const paletteCommands: PaletteCommand[] = [
    { id: "open-folder",    label: "Open Folder…",           keybind: "⌘O",      action: openFolder },
    { id: "toggle-term",    label: "Toggle Terminal",         keybind: "Ctrl+`",  action: () => setShowTerminal(v => !v) },
    { id: "toggle-agents",  label: "Toggle Agent Panel",                          action: () => setShowAgents(v => !v) },
    { id: "search-files",   label: "Find in Files",           keybind: "⌘⇧F",    action: () => setSidebarTab("search") },
    { id: "go-to-file",     label: "Go to File",              keybind: "⌘P",     action: () => setPalette("files") },
  ]

  const onKeyDown = (e: KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey
    if (meta && !e.shiftKey && e.key === "o") { e.preventDefault(); openFolder() }
    if (meta && !e.shiftKey && e.key === "p") { e.preventDefault(); setPalette("files") }
    if (meta && e.shiftKey && e.key === "P")  { e.preventDefault(); setPalette("commands") }
    if (meta && e.shiftKey && e.key === "F")  { e.preventDefault(); setSidebarTab("search") }
    if (e.ctrlKey && e.key === "`")            { e.preventDefault(); setShowTerminal(v => !v) }
    if (e.key === "Escape" && palette())        { setPalette(null) }
  }

  return (
    <div
      style={{ display: "flex", "flex-direction": "column", height: "100%", background: "rgba(14,14,20,0.90)", "backdrop-filter": "blur(24px) saturate(160%)", "-webkit-backdrop-filter": "blur(24px) saturate(160%)" }}
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      {/* Title bar */}
      <div
        data-tauri-drag-region
        style={{ height: "38px", "flex-shrink": 0, display: "flex", "align-items": "center", "padding-left": "76px", "padding-right": "10px", gap: "6px", background: "rgba(0,0,0,0.25)", "border-bottom": "1px solid rgba(255,255,255,0.06)" }}
      >
        <span
          data-tauri-drag-region
          style={{ flex: 1, "font-size": "12px", "font-weight": 500, color: "rgba(255,255,255,0.35)", "pointer-events": "none", "user-select": "none" }}
        >
          {projectPath() ? projectPath().split("/").pop() : "Reimagined Editor"}
        </span>
        <TitleBtn title="Open Folder (⌘O)"      onClick={openFolder}                             icon="📁" />
        <TitleBtn title="Go to File (⌘P)"       onClick={() => setPalette("files")}              icon="🔍" />
        <TitleBtn title="Find in Files (⌘⇧F)"  onClick={() => setSidebarTab("search")}          icon="🔎" />
        <TitleBtn title="Toggle Terminal (^`)"  onClick={() => setShowTerminal(v => !v)} active={showTerminal()} icon="⌨" />
        <TitleBtn title="Toggle Agents"         onClick={() => setShowAgents(v => !v)}  active={showAgents()}   icon="⚡" />
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", "min-height": 0 }}>

        {/* Sidebar */}
        <div style={{ width: `${sidebarWidth()}px`, "flex-shrink": 0, display: "flex", "flex-direction": "column", "border-right": "1px solid rgba(255,255,255,0.07)", overflow: "hidden" }}>
          {/* Sidebar tab bar */}
          <div style={{ display: "flex", "border-bottom": "1px solid rgba(255,255,255,0.07)", "flex-shrink": 0 }}>
            <SidebarTabBtn label="Files"  active={sidebarTab() === "files"}  onClick={() => setSidebarTab("files")} />
            <SidebarTabBtn label="Search" active={sidebarTab() === "search"} onClick={() => setSidebarTab("search")} />
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <Show when={sidebarTab() === "files"}>
              <Sidebar
                projectPath={projectPath()}
                selectedFile={selectedFile()}
                onSelectFile={openFile}
                onOpenFolder={openFolder}
              />
            </Show>
            <Show when={sidebarTab() === "search"}>
              <SearchPanel
                projectPath={projectPath()}
                onJump={jumpToLocation}
              />
            </Show>
          </div>
        </div>

        <ResizeBar onDelta={(d) => setSidebarWidth(w => Math.max(160, Math.min(480, w + d)))} cursor="col-resize" />

        {/* Center: editor + terminal */}
        <div style={{ flex: 1, display: "flex", "flex-direction": "column", "min-width": 0, overflow: "hidden" }}>
          <div style={{ flex: 1, "min-height": 0, overflow: "hidden" }}>
            <EditorPane
              filePath={selectedFile()}
              projectPath={projectPath()}
            />
          </div>
          <Show when={showTerminal()}>
            <ResizeBar onDelta={(d) => setTerminalHeight(h => Math.max(120, Math.min(700, h - d)))} cursor="row-resize" horizontal />
            <div style={{ height: `${terminalHeight()}px`, "flex-shrink": 0 }}>
              <TerminalPane projectPath={projectPath()} />
            </div>
          </Show>
        </div>

        {/* Agent panel */}
        <Show when={showAgents()}>
          <ResizeBar onDelta={(d) => setAgentWidth(w => Math.max(200, Math.min(520, w - d)))} cursor="col-resize" />
          <div style={{ width: `${agentWidth()}px`, "flex-shrink": 0, "border-left": "1px solid rgba(255,255,255,0.07)", overflow: "hidden" }}>
            <AgentPanel projectPath={projectPath()} />
          </div>
        </Show>
      </div>

      {/* Command Palette overlay */}
      <Show when={palette()}>
        {(mode) => (
          <CommandPalette
            mode={mode()}
            projectPath={projectPath()}
            commands={paletteCommands}
            onOpenFile={openFile}
            onClose={() => setPalette(null)}
          />
        )}
      </Show>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function TitleBtn(props: { title: string; icon: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      title={props.title}
      onClick={props.onClick}
      style={{
        background: props.active ? "rgba(255,255,255,0.1)" : "transparent",
        border: "none", color: props.active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.38)",
        cursor: "pointer", "border-radius": "5px", padding: "3px 8px",
        "font-size": "13px", transition: "background 0.15s, color 0.15s",
      }}
    >{props.icon}</button>
  )
}

function SidebarTabBtn(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      style={{
        flex: 1, background: "transparent", border: "none",
        "border-bottom": `2px solid ${props.active ? "#569cd6" : "transparent"}`,
        color: props.active ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)",
        cursor: "pointer", "font-size": "11px", "font-weight": 500,
        padding: "6px 0", transition: "color 0.1s", "letter-spacing": "0.03em",
        "text-transform": "uppercase",
      }}
    >{props.label}</button>
  )
}

function ResizeBar(props: { onDelta: (d: number) => void; cursor: string; horizontal?: boolean }) {
  let startPos = 0
  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault()
    startPos = props.horizontal ? e.clientY : e.clientX
    const onMove = (e: MouseEvent) => {
      const pos = props.horizontal ? e.clientY : e.clientX
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
      style={{ [props.horizontal ? "height" : "width"]: "4px", "flex-shrink": 0, cursor: props.cursor, background: "rgba(255,255,255,0.04)", transition: "background 0.15s" }}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "rgba(255,255,255,0.12)" }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "rgba(255,255,255,0.04)" }}
    />
  )
}
