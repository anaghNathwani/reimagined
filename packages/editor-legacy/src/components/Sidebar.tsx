import { createSignal, createResource, For, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"

interface DirEntry { name: string; path: string; is_dir: boolean }

const SKIP = new Set(["node_modules", ".git", ".build", "dist", "build", ".next", "__pycache__", ".DS_Store"])

function fileIcon(name: string, isDir: boolean, expanded?: boolean): { badge: string; color: string; arrow?: boolean } {
  if (isDir) return { badge: "", color: "#c5a028", arrow: true }
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, { badge: string; color: string }> = {
    ts:    { badge: "TS", color: "#3178c6" },
    tsx:   { badge: "TS", color: "#3178c6" },
    js:    { badge: "JS", color: "#f0db4f" },
    jsx:   { badge: "JS", color: "#f0db4f" },
    swift: { badge: "SW", color: "#f05138" },
    py:    { badge: "PY", color: "#3572a5" },
    rs:    { badge: "RS", color: "#dea584" },
    go:    { badge: "GO", color: "#00acd7" },
    json:  { badge: "{}", color: "#c8c8c8" },
    md:    { badge: "MD", color: "#c8c8c8" },
    html:  { badge: "HT", color: "#e34c26" },
    css:   { badge: "CS", color: "#563d7c" },
    scss:  { badge: "SC", color: "#c6538c" },
    sh:    { badge: "SH", color: "#4eaa25" },
    toml:  { badge: "TM", color: "#9c4221" },
    yaml:  { badge: "YM", color: "#cb171e" },
    yml:   { badge: "YM", color: "#cb171e" },
    rb:    { badge: "RB", color: "#cc342d" },
    kt:    { badge: "KT", color: "#7f52ff" },
    java:  { badge: "JV", color: "#b07219" },
    c:     { badge: "C",  color: "#555555" },
    cpp:   { badge: "C+", color: "#f34b7d" },
    rs_:   { badge: "RS", color: "#dea584" },
  }
  return map[ext] ?? { badge: ".", color: "#858585" }
}

function TreeNode(props: {
  entry: DirEntry
  level: number
  selectedFile: string | null
  onSelectFile: (p: string) => void
}) {
  const [open, setOpen] = createSignal(false)
  const [children] = createResource(
    () => (props.entry.is_dir && open() ? props.entry.path : null),
    (p) => invoke<DirEntry[]>("list_dir", { path: p }).then(entries =>
      entries.filter(e => !SKIP.has(e.name))
    )
  )

  const icon = () => fileIcon(props.entry.name, props.entry.is_dir, open())
  const isSelected = () => props.selectedFile === props.entry.path
  const indent = 6 + props.level * 14

  const click = () => {
    if (props.entry.is_dir) setOpen(v => !v)
    else props.onSelectFile(props.entry.path)
  }

  return (
    <div>
      <div
        onClick={click}
        style={{
          display: "flex", "align-items": "center", gap: "4px",
          height: "22px", cursor: "pointer",
          "padding-left": `${indent}px`,
          "padding-right": "8px",
          background: isSelected() ? "var(--vsc-highlight)" : "transparent",
          color: "var(--vsc-text)",
          "font-size": "13px",
          "user-select": "none",
          overflow: "hidden",
        }}
        onMouseEnter={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = "var(--vsc-hover)" }}
        onMouseLeave={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = "transparent" }}
      >
        {/* Arrow for dirs */}
        <Show when={props.entry.is_dir}>
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            style={{ "flex-shrink": 0, transform: open() ? "rotate(90deg)" : "", transition: "transform 0.1s", color: "var(--vsc-text-muted)" }}
          >
            <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </Show>
        {/* File badge */}
        <Show when={!props.entry.is_dir}>
          <span style={{
            color: icon().color, "font-size": "9px", "font-weight": 700,
            width: "18px", "text-align": "center", "flex-shrink": 0,
            "font-family": "'Consolas', 'Courier New', monospace",
          }}>
            {icon().badge}
          </span>
        </Show>
        {/* Folder icon */}
        <Show when={props.entry.is_dir}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ "flex-shrink": 0, color: "#c5a028" }}>
            <path d="M1 3.5A1.5 1.5 0 012.5 2H5l1.5 1.5H11.5A1.5 1.5 0 0113 5.5v5A1.5 1.5 0 0111.5 12h-9A1.5 1.5 0 011 10.5v-7z" fill="currentColor" fill-opacity="0.7" stroke="currentColor" stroke-width="0.5"/>
          </svg>
        </Show>
        {/* Name */}
        <span style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis", flex: 1, "font-size": "13px" }}>
          {props.entry.name}
        </span>
      </div>
      <Show when={open() && children()}>
        <For each={children()!}>
          {(child) => (
            <TreeNode
              entry={child}
              level={props.level + 1}
              selectedFile={props.selectedFile}
              onSelectFile={props.onSelectFile}
            />
          )}
        </For>
      </Show>
    </div>
  )
}

export default function Sidebar(props: {
  projectPath: string
  selectedFile: string | null
  onSelectFile: (p: string) => void
  onOpenFolder: () => void
}) {
  const [roots] = createResource(
    () => props.projectPath || null,
    (p) => invoke<DirEntry[]>("list_dir", { path: p }).then(entries =>
      entries.filter(e => !SKIP.has(e.name))
    )
  )

  const folderName = () => props.projectPath ? props.projectPath.split("/").pop() ?? props.projectPath : ""

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", width: "100%", overflow: "hidden", background: "var(--vsc-sidebar-bg)" }}>

      {/* Project name header */}
      <Show when={props.projectPath}>
        <div
          onClick={props.onOpenFolder}
          title={props.projectPath}
          style={{
            display: "flex", "align-items": "center", gap: "5px",
            padding: "6px 10px 4px", cursor: "pointer",
            "font-size": "11px", "font-weight": 700, "letter-spacing": "0.1em",
            "text-transform": "uppercase", color: "#bbbcbd",
            "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ "flex-shrink": 0, color: "#c5a028" }}>
            <path d="M1 3.5A1.5 1.5 0 012.5 2H5l1.5 1.5H11.5A1.5 1.5 0 0113 5.5v5A1.5 1.5 0 0111.5 12h-9A1.5 1.5 0 011 10.5v-7z" fill="currentColor" fill-opacity="0.6" stroke="currentColor" stroke-width="0.5"/>
          </svg>
          {folderName()}
        </div>
      </Show>

      {/* File tree */}
      <div style={{ flex: 1, overflow: "auto", padding: "2px 0" }}>
        <Show when={!props.projectPath}>
          <div style={{
            display: "flex", "flex-direction": "column", "align-items": "center", gap: "12px",
            padding: "32px 16px", color: "var(--vsc-text-muted)", "text-align": "center",
          }}>
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" style={{ opacity: "0.4" }}>
              <path d="M3 8A3 3 0 016 5h8l3 3h13a3 3 0 013 3v14a3 3 0 01-3 3H6a3 3 0 01-3-3V8z" stroke="currentColor" stroke-width="1.5"/>
            </svg>
            <div style={{ "font-size": "12px", "line-height": "1.6" }}>
              No folder open
            </div>
            <button
              onClick={props.onOpenFolder}
              style={{
                background: "#007acc", border: "none", color: "#ffffff",
                "border-radius": "2px", padding: "5px 14px", "font-size": "12px",
                cursor: "pointer",
              }}
            >
              Open Folder
            </button>
          </div>
        </Show>

        <For each={roots()}>
          {(entry) => (
            <TreeNode
              entry={entry}
              level={0}
              selectedFile={props.selectedFile}
              onSelectFile={props.onSelectFile}
            />
          )}
        </For>
      </div>
    </div>
  )
}
