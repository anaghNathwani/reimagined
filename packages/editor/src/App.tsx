import { createSignal, Show, onMount, For } from "solid-js"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { invoke } from "@tauri-apps/api/core"
import Sidebar from "./components/Sidebar"
import EditorPane from "./components/EditorPane"
import TerminalPane from "./components/TerminalPane"
import AIPanel from "./components/AIPanel"
import CommandPalette, { type PaletteCommand } from "./components/CommandPalette"
import SearchPanel from "./components/SearchPanel"

// ── Types ──────────────────────────────────────────────────────────────────────

type ActivityId = "files" | "search" | "git" | "ai" | "extensions"
type PanelTab = "terminal" | "problems"

// ── SVG icons (24×24 viewBox, stroke style) ───────────────────────────────────

const Icons = {
  files: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 4.5A1.5 1.5 0 015.5 3h9.086a1.5 1.5 0 011.06.44l3.915 3.914A1.5 1.5 0 0120 8.414V19.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 19.5v-15z" stroke="currentColor" stroke-width="1.4"/>
    <path d="M14.5 3v5H20" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`,

  search: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.5"/>
    <path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
  </svg>`,

  git: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="6" cy="6" r="2.5" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="6" cy="18" r="2.5" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="18" cy="9" r="2.5" stroke="currentColor" stroke-width="1.4"/>
    <path d="M6 8.5v7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M6 8.5c0 3 12 3 12 0.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`,

  ai: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3L13.8 9.2L20 11L13.8 12.8L12 19L10.2 12.8L4 11L10.2 9.2L12 3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M19 3L19.8 5.2L22 6L19.8 6.8L19 9L18.2 6.8L16 6L18.2 5.2L19 3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M5 16L5.6 17.8L7.4 18.4L5.6 19L5 20.8L4.4 19L2.6 18.4L4.4 17.8L5 16Z" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/>
  </svg>`,

  extensions: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
    <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
    <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.4"/>
    <path d="M14 17.5h7M17.5 14v7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,

  close: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`,

  chevronRight: `<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
}

// ── ResizeBar ──────────────────────────────────────────────────────────────────

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
    const onUp = () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        [props.horizontal ? "height" : "width"]: "1px",
        "flex-shrink": 0,
        cursor: props.cursor,
        background: "var(--vsc-border)",
        transition: "background 0.15s",
        "z-index": 10,
      }}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "#007acc" }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "var(--vsc-border)" }}
    />
  )
}

// ── ActivityBtn ────────────────────────────────────────────────────────────────

function ActivityBtn(props: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      title={props.label}
      onClick={props.onClick}
      style={{
        width: "48px", height: "48px",
        border: "none", background: "transparent",
        color: props.active ? "#cccccc" : "#858585",
        cursor: "pointer",
        display: "flex", "align-items": "center", "justify-content": "center",
        position: "relative",
        "border-left": props.active ? "2px solid #cccccc" : "2px solid transparent",
        "border-right": "none",
        transition: "color 0.1s",
        "flex-shrink": 0,
      }}
      onMouseEnter={(e) => { if (!props.active) (e.currentTarget as HTMLElement).style.color = "#cccccc" }}
      onMouseLeave={(e) => { if (!props.active) (e.currentTarget as HTMLElement).style.color = "#858585" }}
      innerHTML={props.icon}
    />
  )
}

// ── PanelTabBtn ────────────────────────────────────────────────────────────────

function PanelTabBtn(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      style={{
        background: "transparent", border: "none", cursor: "pointer",
        padding: "6px 12px", "font-size": "11px", "font-weight": 700,
        "letter-spacing": "0.06em", "text-transform": "uppercase",
        color: props.active ? "var(--vsc-text)" : "var(--vsc-text-muted)",
        "border-bottom": props.active ? "1px solid var(--vsc-text)" : "1px solid transparent",
        "margin-bottom": "-1px",
        transition: "color 0.1s",
        "flex-shrink": 0,
      }}
      onMouseEnter={(e) => { if (!props.active) (e.currentTarget as HTMLElement).style.color = "var(--vsc-text)" }}
      onMouseLeave={(e) => { if (!props.active) (e.currentTarget as HTMLElement).style.color = "var(--vsc-text-muted)" }}
    >
      {props.label}
    </button>
  )
}

// ── EmptyState ─────────────────────────────────────────────────────────────────

function EmptyState(props: { onOpenFolder: () => void; onPalette: () => void }) {
  return (
    <div style={{
      flex: 1, height: "100%",
      display: "flex", "flex-direction": "column",
      "align-items": "center", "justify-content": "center",
      gap: "20px", background: "var(--vsc-editor-bg)",
      color: "var(--vsc-text-muted)", "user-select": "none",
    }}>
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" style={{ opacity: "0.15" }}>
        <rect x="10" y="14" width="60" height="52" rx="4" stroke="currentColor" stroke-width="2.5"/>
        <path d="M10 26h60M26 14v12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="18" cy="20" r="2.5" fill="currentColor"/>
        <circle cx="26" cy="20" r="2.5" fill="currentColor"/>
        <circle cx="34" cy="20" r="2.5" fill="currentColor"/>
        <path d="M22 44l8 6-8 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M36 56h20" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      <div style={{ "text-align": "center" }}>
        <div style={{ "font-size": "20px", "font-weight": 400, color: "var(--vsc-text-muted)", "margin-bottom": "8px" }}>
          Reimagined Editor
        </div>
        <div style={{ "font-size": "13px", color: "var(--vsc-text-dim)" }}>
          Open a folder or a file to get started.
        </div>
      </div>
      <div style={{ display: "flex", "flex-direction": "column", gap: "6px", "font-size": "12px" }}>
        {[
          ["Open Folder...", "⌘O", props.onOpenFolder],
          ["Go to File...", "⌘P", props.onPalette],
        ].map(([label, key, action]) => (
          <div
            onClick={action as () => void}
            style={{ display: "flex", "justify-content": "space-between", gap: "48px", cursor: "pointer", color: "var(--vsc-text-muted)", padding: "2px 0" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--vsc-text)" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--vsc-text-muted)" }}
          >
            <span>{label as string}</span>
            <span style={{ "font-family": "monospace" }}>{key as string}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────────────────

export default function App() {
  const [projectPath, setProjectPath] = createSignal("")
  const [updateAvailable, setUpdateAvailable] = createSignal<string | null>(null)
  const [installing, setInstalling] = createSignal(false)
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null)
  const [activeActivity, setActiveActivity] = createSignal<ActivityId | null>("files")
  const [sidebarWidth, setSidebarWidth] = createSignal(240)
  const [panelHeight, setPanelHeight] = createSignal(220)
  const [showPanel, setShowPanel] = createSignal(false)
  const [panelTab, setPanelTab] = createSignal<PanelTab>("terminal")
  const [palette, setPalette] = createSignal<"files" | "commands" | null>(null)

  onMount(async () => {
    try {
      const info = await invoke<{ available: boolean; version: string | null }>("check_update")
      if (info.available && info.version) setUpdateAvailable(info.version)
    } catch { /* silent */ }
  })

  const installUpdate = async () => {
    setInstalling(true)
    try { await invoke("install_update") } catch { setInstalling(false) }
  }

  const openFolder = async () => {
    const dir = await openDialog({ directory: true, multiple: false, title: "Open Folder" })
    if (dir && typeof dir === "string") setProjectPath(dir)
  }

  const jumpToLocation = (file: string, line: number, col: number) => {
    setSelectedFile(file)
    setTimeout(() => { (window as any).__editorJumpTo?.(file, line, col) }, 100)
  }

  const toggleActivity = (id: ActivityId) => {
    setActiveActivity(v => v === id ? null : id)
  }

  const paletteCommands: PaletteCommand[] = [
    { id: "open-folder",    label: "Open Folder...",    keybind: "⌘O",     action: openFolder },
    { id: "toggle-panel",   label: "Toggle Panel",      keybind: "Ctrl+J", action: () => setShowPanel(v => !v) },
    { id: "find-in-files",  label: "Find in Files",     keybind: "⌘⇧F",   action: () => setActiveActivity("search") },
    { id: "go-to-file",     label: "Go to File...",     keybind: "⌘P",    action: () => setPalette("files") },
    { id: "toggle-ai",      label: "Toggle AI Panel",              action: () => toggleActivity("ai") },
    { id: "terminal",       label: "New Terminal",      keybind: "Ctrl+`", action: () => { setShowPanel(true); setPanelTab("terminal") } },
  ]

  const onKeyDown = (e: KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey
    if (meta && !e.shiftKey && e.key === "o") { e.preventDefault(); openFolder() }
    if (meta && !e.shiftKey && e.key === "p") { e.preventDefault(); setPalette("files") }
    if (meta && e.shiftKey  && e.key === "P") { e.preventDefault(); setPalette("commands") }
    if (meta && e.shiftKey  && e.key === "F") { e.preventDefault(); setActiveActivity("search") }
    if (e.ctrlKey && e.key === "`")           { e.preventDefault(); setShowPanel(v => !v); setPanelTab("terminal") }
    if (e.ctrlKey && e.key === "j")           { e.preventDefault(); setShowPanel(v => !v) }
    if (e.key === "Escape" && palette())       { setPalette(null) }
  }

  const projectName = () => projectPath() ? projectPath().split("/").pop()! : "Reimagined Editor"

  const sidebarLabel = () => {
    switch (activeActivity()) {
      case "files":      return "EXPLORER"
      case "search":     return "SEARCH"
      case "git":        return "SOURCE CONTROL"
      case "ai":         return "REIMAGINED AI"
      case "extensions": return "EXTENSIONS"
      default:           return ""
    }
  }

  const activities: { id: ActivityId; label: string; icon: string }[] = [
    { id: "files",      label: "Explorer (⌘⇧E)",         icon: Icons.files },
    { id: "search",     label: "Search (⌘⇧F)",           icon: Icons.search },
    { id: "git",        label: "Source Control (Ctrl+⇧G)", icon: Icons.git },
    { id: "ai",         label: "Reimagined AI",           icon: Icons.ai },
    { id: "extensions", label: "Extensions (⌘⇧X)",       icon: Icons.extensions },
  ]

  return (
    <div
      style={{
        display: "flex", "flex-direction": "column", height: "100%",
        background: "var(--vsc-editor-bg)",
        "border-radius": "10px",
        overflow: "hidden",
      }}
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      {/* ── Titlebar ── */}
      <div
        data-tauri-drag-region
        style={{
          height: "38px", "flex-shrink": 0,
          display: "flex", "align-items": "center",
          "padding-left": "72px",
          background: "#3c3c3c",
          "-webkit-app-region": "drag",
        }}
      >
        {/* Centered filename */}
        <div
          data-tauri-drag-region
          style={{
            position: "absolute", left: 0, right: 0,
            display: "flex", "align-items": "center", "justify-content": "center",
            "pointer-events": "none",
          }}
        >
          <span style={{
            "font-size": "12px", color: "#cccccc",
            "user-select": "none", overflow: "hidden",
            "text-overflow": "ellipsis", "white-space": "nowrap",
            "max-width": "50vw",
          }}>
            {projectName()}
          </span>
        </div>

        {/* Title actions (no-drag zone) */}
        <div style={{ "margin-left": "auto", "padding-right": "12px", display: "flex", gap: "4px", "-webkit-app-region": "no-drag", "z-index": 1 }}>
          <Show when={updateAvailable()}>
            {(version) => (
              <button
                onClick={installUpdate}
                disabled={installing()}
                style={{
                  display: "flex", "align-items": "center", gap: "5px",
                  background: "rgba(63,185,80,0.15)", border: "1px solid rgba(63,185,80,0.35)",
                  color: "#4ec9b0", "border-radius": "3px", padding: "2px 9px",
                  "font-size": "11px", "font-weight": 500, cursor: "pointer",
                }}
              >
                {installing() ? "Installing..." : `Update ${version()}`}
              </button>
            )}
          </Show>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", "min-height": 0 }}>

        {/* ── Activity Bar ── */}
        <div style={{
          width: "48px", "flex-shrink": 0,
          display: "flex", "flex-direction": "column",
          background: "var(--vsc-activity-bg)",
          "border-right": "none",
        }}>
          {/* Top icons */}
          <div style={{ flex: 1, display: "flex", "flex-direction": "column" }}>
            <For each={activities}>
              {(act) => (
                <ActivityBtn
                  icon={act.icon}
                  label={act.label}
                  active={activeActivity() === act.id}
                  onClick={() => toggleActivity(act.id)}
                />
              )}
            </For>
          </div>
          {/* Bottom: settings */}
          <div style={{ "flex-shrink": 0, "margin-bottom": "4px" }}>
            <button
              title="Settings"
              style={{
                width: "48px", height: "48px", border: "none", background: "transparent",
                color: "#858585", cursor: "pointer",
                display: "flex", "align-items": "center", "justify-content": "center",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#cccccc" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#858585" }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.4"/>
                <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* ── Sidebar Panel ── */}
        <Show when={activeActivity() !== null}>
          <div style={{
            width: `${sidebarWidth()}px`, "flex-shrink": 0,
            display: "flex", "flex-direction": "column",
            background: "var(--vsc-sidebar-bg)",
            "border-right": "1px solid var(--vsc-border)",
            overflow: "hidden",
          }}>
            {/* Section header */}
            <div style={{
              height: "35px", "flex-shrink": 0,
              display: "flex", "align-items": "center",
              padding: "0 12px", gap: "6px",
            }}>
              <span style={{
                "font-size": "11px", "font-weight": 700, "letter-spacing": "0.1em",
                color: "#bbbcbd", flex: 1,
              }}>
                {sidebarLabel()}
              </span>
              <Show when={activeActivity() === "files"}>
                <button
                  title="Open Folder (⌘O)"
                  onClick={openFolder}
                  style={{
                    background: "transparent", border: "none", color: "var(--vsc-text-muted)",
                    cursor: "pointer", display: "flex", "align-items": "center",
                    "border-radius": "3px", padding: "3px",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--vsc-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--vsc-text)" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--vsc-text-muted)" }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M1 3.5A1.5 1.5 0 012.5 2H5l1.5 1.5H13.5A1.5 1.5 0 0115 5.5v7A1.5 1.5 0 0113.5 14h-11A1.5 1.5 0 011 12.5v-9z" stroke="currentColor" stroke-width="1.2"/>
                  </svg>
                </button>
              </Show>
            </div>

            {/* Panel content */}
            <div style={{ flex: 1, overflow: "hidden" }}>
              <Show when={activeActivity() === "files"}>
                <Sidebar
                  projectPath={projectPath()}
                  selectedFile={selectedFile()}
                  onSelectFile={setSelectedFile}
                  onOpenFolder={openFolder}
                />
              </Show>
              <Show when={activeActivity() === "search"}>
                <SearchPanel projectPath={projectPath()} onJump={jumpToLocation} />
              </Show>
              <Show when={activeActivity() === "ai"}>
                <AIPanel projectPath={projectPath()} />
              </Show>
              <Show when={activeActivity() === "git"}>
                <div style={{ padding: "12px", color: "var(--vsc-text-muted)", "font-size": "12px" }}>
                  Source control coming soon.
                </div>
              </Show>
              <Show when={activeActivity() === "extensions"}>
                <div style={{ padding: "12px", color: "var(--vsc-text-muted)", "font-size": "12px" }}>
                  Extensions marketplace coming soon.
                </div>
              </Show>
            </div>
          </div>

          {/* Sidebar resize handle */}
          <ResizeBar
            onDelta={(d) => setSidebarWidth(w => Math.max(160, Math.min(600, w + d)))}
            cursor="col-resize"
          />
        </Show>

        {/* ── Main Editor Area ── */}
        <div style={{ flex: 1, display: "flex", "flex-direction": "column", "min-width": 0, overflow: "hidden" }}>

          {/* Editor pane */}
          <div style={{ flex: 1, "min-height": 0, overflow: "hidden", display: "flex", "flex-direction": "column" }}>
            <Show
              when={selectedFile() || projectPath()}
              fallback={<EmptyState onOpenFolder={openFolder} onPalette={() => setPalette("files")} />}
            >
              <EditorPane filePath={selectedFile()} projectPath={projectPath()} />
            </Show>
          </div>

          {/* Panel (terminal / problems) */}
          <Show when={showPanel()}>
            <ResizeBar
              onDelta={(d) => setPanelHeight(h => Math.max(80, Math.min(800, h - d)))}
              cursor="row-resize"
              horizontal
            />
            <div style={{
              height: `${panelHeight()}px`, "flex-shrink": 0,
              display: "flex", "flex-direction": "column",
              background: "var(--vsc-panel-bg)",
              "border-top": "1px solid var(--vsc-border)",
            }}>
              {/* Panel tab strip */}
              <div style={{
                display: "flex", "align-items": "center",
                "border-bottom": "1px solid var(--vsc-border)",
                background: "var(--vsc-sidebar-bg)",
                "flex-shrink": 0, height: "35px", "padding-left": "4px",
              }}>
                <PanelTabBtn label="TERMINAL"  active={panelTab() === "terminal"}  onClick={() => setPanelTab("terminal")} />
                <PanelTabBtn label="PROBLEMS"  active={panelTab() === "problems"}  onClick={() => setPanelTab("problems")} />
                <div style={{ flex: 1 }} />
                <button
                  title="Close Panel (Ctrl+J)"
                  onClick={() => setShowPanel(false)}
                  style={{
                    background: "transparent", border: "none", color: "var(--vsc-text-muted)",
                    cursor: "pointer", padding: "4px 8px", "border-radius": "2px",
                    display: "flex", "align-items": "center",
                    "margin-right": "4px",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--vsc-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--vsc-text)" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--vsc-text-muted)" }}
                  innerHTML={Icons.close}
                />
              </div>

              {/* Panel content */}
              <div style={{ flex: 1, "min-height": 0, overflow: "hidden" }}>
                <Show when={panelTab() === "terminal"}>
                  <TerminalPane projectPath={projectPath()} />
                </Show>
                <Show when={panelTab() === "problems"}>
                  <ProblemsPane />
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </div>

      {/* ── Status Bar ── */}
      <VscStatusBar
        projectPath={projectPath()}
        onClickDiagnostics={() => { setShowPanel(true); setPanelTab("problems") }}
      />

      {/* ── Command Palette ── */}
      <Show when={palette()}>
        {(mode) => (
          <CommandPalette
            mode={mode()}
            projectPath={projectPath()}
            commands={paletteCommands}
            onOpenFile={setSelectedFile}
            onClose={() => setPalette(null)}
          />
        )}
      </Show>
    </div>
  )
}

// ── ProblemsPane ───────────────────────────────────────────────────────────────

function ProblemsPane() {
  const diagnostics = () => (window as any).__diagnostics ?? []

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "4px 0" }}>
      <Show
        when={diagnostics().length > 0}
        fallback={
          <div style={{ padding: "24px 16px", "text-align": "center", color: "var(--vsc-text-muted)", "font-size": "12px" }}>
            No problems detected in the workspace.
          </div>
        }
      >
        <For each={diagnostics()}>
          {(d: any) => (
            <div style={{ display: "flex", gap: "8px", padding: "4px 12px", "font-size": "12px", color: "var(--vsc-text)" }}>
              <span style={{ color: d.severity === 8 ? "#f44747" : "#d7ba7d" }}>
                {d.severity === 8 ? "E" : "W"}
              </span>
              <span>{d.message}</span>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}

// ── VscStatusBar ───────────────────────────────────────────────────────────────

function VscStatusBar(props: { projectPath: string; onClickDiagnostics: () => void }) {
  return (
    <div style={{
      height: "22px", "flex-shrink": 0,
      display: "flex", "align-items": "center",
      background: "var(--vsc-statusbar-bg)",
      color: "#ffffff",
      "font-size": "12px",
      "user-select": "none",
      overflow: "hidden",
    }}>
      {/* Left */}
      <SBItem>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ "vertical-align": "middle", "margin-right": "4px" }}>
          <circle cx="5" cy="3" r="1.5" stroke="currentColor" stroke-width="1.2"/>
          <circle cx="5" cy="13" r="1.5" stroke="currentColor" stroke-width="1.2"/>
          <circle cx="11" cy="6" r="1.5" stroke="currentColor" stroke-width="1.2"/>
          <path d="M5 4.5v7M5 4.5c0 2 6 2 6 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        main
      </SBItem>
      <SBItem onClick={props.onClickDiagnostics} clickable>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ "vertical-align": "middle", "margin-right": "3px" }}>
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/>
          <path d="M8 5v4M8 11v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        0
        <span style={{ "margin-left": "6px", "margin-right": "3px" }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ "vertical-align": "middle" }}>
            <path d="M8 2L14.5 14H1.5L8 2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M8 6.5v3.5M8 12v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </span>
        0
      </SBItem>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Right */}
      <SBItem>UTF-8</SBItem>
      <SBItem>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ "vertical-align": "middle", "margin-right": "4px" }}>
          <path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" fill="rgba(255,255,255,0.8)" stroke="rgba(255,255,255,0.3)" stroke-width="0.8"/>
        </svg>
        Reimagined
      </SBItem>
    </div>
  )
}

function SBItem(props: { children: any; onClick?: () => void; clickable?: boolean }) {
  return (
    <div
      onClick={props.onClick}
      style={{
        display: "inline-flex", "align-items": "center",
        padding: "0 8px", height: "22px",
        cursor: props.clickable || props.onClick ? "pointer" : "default",
        "white-space": "nowrap",
      }}
      onMouseEnter={(e) => {
        if (props.onClick || props.clickable)
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.12)"
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent"
      }}
    >
      {props.children}
    </div>
  )
}
