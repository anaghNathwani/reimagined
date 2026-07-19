import { createSignal, createEffect, For, Show, onCleanup } from "solid-js"
import { invoke } from "@tauri-apps/api/core"

export interface PaletteCommand {
  id: string
  label: string
  description?: string
  keybind?: string
  action: () => void
}

interface Props {
  mode: "files" | "commands"
  projectPath: string
  commands: PaletteCommand[]
  onOpenFile: (path: string) => void
  onClose: () => void
}

export default function CommandPalette(props: Props) {
  const [query, setQuery] = createSignal("")
  const [files, setFiles] = createSignal<string[]>([])
  const [active, setActive] = createSignal(0)
  let inputRef!: HTMLInputElement

  createEffect(() => {
    inputRef?.focus()
  })

  createEffect(async () => {
    if (props.mode !== "files") return
    const q = query()
    const results = await invoke<string[]>("find_files", { cwd: props.projectPath || ".", pattern: q }).catch(() => [])
    setFiles(results)
    setActive(0)
  })

  const filteredCommands = () => {
    const q = query().toLowerCase()
    return props.commands.filter(c => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q))
  }

  const items = () => props.mode === "files" ? files() : filteredCommands().map(c => c.label)
  const total = () => items().length

  const confirm = (index: number) => {
    if (props.mode === "files") {
      const file = files()[index]
      if (file) {
        const full = props.projectPath ? `${props.projectPath}/${file}` : file
        props.onOpenFile(full)
        props.onClose()
      }
    } else {
      const cmd = filteredCommands()[index]
      if (cmd) {
        cmd.action()
        props.onClose()
      }
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { props.onClose(); return }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, total() - 1)) }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    if (e.key === "Enter")     { e.preventDefault(); confirm(active()) }
  }

  // Backdrop click closes
  const onBackdropClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).dataset.backdrop) props.onClose()
  }

  const title = props.mode === "files" ? "Go to File" : "Run Command"
  const placeholder = props.mode === "files" ? "Type to search files…" : "Type command name…"

  return (
    <div
      data-backdrop="1"
      onClick={onBackdropClick}
      style={{
        position: "fixed", inset: 0, "z-index": 1000,
        background: "rgba(0,0,0,0.45)",
        display: "flex", "align-items": "flex-start", "justify-content": "center",
        "padding-top": "80px",
      }}
    >
      <div
        style={{
          width: "560px", "max-height": "480px",
          background: "rgba(28,28,36,0.97)",
          border: "1px solid rgba(255,255,255,0.12)",
          "border-radius": "10px",
          "box-shadow": "0 24px 64px rgba(0,0,0,0.6)",
          display: "flex", "flex-direction": "column",
          overflow: "hidden",
        }}
      >
        {/* Input */}
        <div style={{ display: "flex", "align-items": "center", "border-bottom": "1px solid rgba(255,255,255,0.08)", padding: "0 14px" }}>
          <span style={{ color: "rgba(255,255,255,0.3)", "margin-right": "10px", "font-size": "14px" }}>
            {props.mode === "files" ? "📄" : "⌘"}
          </span>
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "rgba(255,255,255,0.9)", "font-size": "14px", padding: "13px 0",
              "font-family": "inherit",
            }}
          />
          <span style={{ "font-size": "11px", color: "rgba(255,255,255,0.2)", "margin-left": "8px" }}>esc</span>
        </div>

        {/* Results */}
        <div style={{ overflow: "auto", "max-height": "380px" }}>
          <Show when={total() === 0}>
            <div style={{ padding: "24px", "text-align": "center", color: "rgba(255,255,255,0.25)", "font-size": "13px" }}>
              {query() ? "No results" : props.mode === "files" ? "Start typing to search files…" : "No commands"}
            </div>
          </Show>
          <For each={props.mode === "files" ? files() : filteredCommands()}>
            {(item, i) => {
              const isCmd = props.mode === "commands"
              const cmd = isCmd ? (item as any as PaletteCommand) : null
              const label = isCmd ? cmd!.label : (item as string).split("/").pop()!
              const detail = isCmd ? cmd!.description : (item as string).split("/").slice(0, -1).join("/")
              const keybind = isCmd ? cmd!.keybind : undefined

              return (
                <div
                  onClick={() => confirm(i())}
                  onMouseEnter={() => setActive(i())}
                  style={{
                    display: "flex", "align-items": "center", padding: "7px 14px", cursor: "pointer",
                    background: active() === i() ? "rgba(86,156,214,0.18)" : "transparent",
                    "border-left": `2px solid ${active() === i() ? "#569cd6" : "transparent"}`,
                    transition: "background 0.08s",
                  }}
                >
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={{ "font-size": "13px", color: "rgba(255,255,255,0.88)", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
                      {label}
                    </div>
                    <Show when={detail}>
                      <div style={{ "font-size": "11px", color: "rgba(255,255,255,0.35)", "margin-top": "1px", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
                        {detail}
                      </div>
                    </Show>
                  </div>
                  <Show when={keybind}>
                    <span style={{ "font-size": "10px", color: "rgba(255,255,255,0.3)", "margin-left": "12px", "flex-shrink": 0 }}>{keybind}</span>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>

        {/* Footer */}
        <div style={{ padding: "6px 14px", "border-top": "1px solid rgba(255,255,255,0.06)", "font-size": "10px", color: "rgba(255,255,255,0.2)", display: "flex", gap: "12px" }}>
          <span>↑↓ navigate</span><span>↵ open</span><span>esc dismiss</span>
        </div>
      </div>
    </div>
  )
}
