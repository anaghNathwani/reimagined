import { createSignal, createResource, For, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"

interface DirEntry { name: string; path: string; is_dir: boolean }

const SKIP = new Set(["node_modules", ".git", ".build", "dist", "build", ".next", "__pycache__", ".DS_Store"])

function fileIcon(name: string, isDir: boolean, expanded?: boolean): { icon: string; color: string } {
  if (isDir) return { icon: expanded ? "▾" : "▸", color: "#569cd6" }
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, { icon: string; color: string }> = {
    ts: { icon: "TS", color: "#3178c6" }, tsx: { icon: "TS", color: "#3178c6" },
    js: { icon: "JS", color: "#f0db4f" }, jsx: { icon: "JS", color: "#f0db4f" },
    swift: { icon: "S", color: "#f05138" }, py: { icon: "PY", color: "#3572A5" },
    rs: { icon: "RS", color: "#dea584" }, go: { icon: "GO", color: "#00acd7" },
    json: { icon: "{}", color: "#c8c8c8" }, md: { icon: "MD", color: "#c8c8c8" },
    html: { icon: "HT", color: "#e34c26" }, css: { icon: "CS", color: "#563d7c" },
    scss: { icon: "SC", color: "#c6538c" }, sh: { icon: "SH", color: "#4EAA25" },
  }
  return map[ext] ?? { icon: "·", color: "rgba(255,255,255,0.4)" }
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

  const { icon, color } = fileIcon(props.entry.name, props.entry.is_dir, open())
  const isSelected = () => props.selectedFile === props.entry.path
  const indent = props.level * 14

  const click = () => {
    if (props.entry.is_dir) setOpen(v => !v)
    else props.onSelectFile(props.entry.path)
  }

  return (
    <div>
      <button
        onClick={click}
        style={{
          display: "flex", "align-items": "center", gap: "5px",
          width: "100%", background: isSelected() ? "rgba(86,156,214,0.2)" : "transparent",
          border: "none", cursor: "pointer", padding: `2px 8px 2px ${8 + indent}px`,
          color: isSelected() ? "#fff" : "rgba(255,255,255,0.78)",
          "font-size": "12.5px", "text-align": "left", "border-radius": "4px",
          transition: "background 0.1s",
        }}
        onMouseEnter={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)" }}
        onMouseLeave={(e) => { if (!isSelected()) (e.currentTarget as HTMLElement).style.background = "transparent" }}
      >
        <span style={{ color, "font-size": "10px", width: "18px", "text-align": "center", "flex-shrink": 0 }}>
          {fileIcon(props.entry.name, props.entry.is_dir, open()).icon}
        </span>
        <span style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
          {props.entry.name}
        </span>
      </button>
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

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", width: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "8px 10px", "border-bottom": "1px solid rgba(255,255,255,0.07)", "flex-shrink": 0 }}>
        <button
          onClick={props.onOpenFolder}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.55)", "font-size": "12px", padding: 0, display: "flex", "align-items": "center", gap: "5px" }}
          title="Open Folder"
        >
          <span>📁</span>
          <span style={{ "font-weight": 600, color: "rgba(255,255,255,0.75)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", "max-width": "160px" }}>
            {props.projectPath ? props.projectPath.split("/").pop() : "Open Folder…"}
          </span>
        </button>
      </div>

      {/* File tree */}
      <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        <Show when={!props.projectPath}>
          <div style={{ padding: "24px 16px", color: "rgba(255,255,255,0.25)", "font-size": "12px", "text-align": "center" }}>
            No folder open
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
