import { createSignal, createEffect, For, Show } from "solid-js"
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
      if (cmd) { cmd.action(); props.onClose() }
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { props.onClose(); return }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, total() - 1)) }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    if (e.key === "Enter")     { e.preventDefault(); confirm(active()) }
  }

  const onBackdropClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).dataset.backdrop) props.onClose()
  }

  const placeholder = props.mode === "files" ? "Go to File..." : "> Type command name..."
  const prefix = props.mode === "commands" ? "> " : ""

  return (
    <div
      data-backdrop="1"
      onClick={onBackdropClick}
      style={{
        position: "fixed", inset: 0, "z-index": 1000,
        background: "rgba(0,0,0,0.5)",
        display: "flex", "align-items": "flex-start", "justify-content": "center",
        "padding-top": "15vh",
      }}
    >
      <div
        style={{
          width: "600px", "max-height": "440px",
          background: "#252526",
          "box-shadow": "0 16px 40px rgba(0,0,0,0.6)",
          display: "flex", "flex-direction": "column",
          overflow: "hidden",
          "border-radius": "0",
        }}
      >
        {/* Input row */}
        <div style={{
          display: "flex", "align-items": "center",
          padding: "0 12px",
          background: "#252526",
          "border-bottom": "1px solid #454545",
        }}>
          <Show when={props.mode === "commands"}>
            <span style={{ color: "#cccccc", "font-size": "14px", "margin-right": "2px" }}>{">"}</span>
          </Show>
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "#cccccc", "font-size": "14px", padding: "10px 4px",
              "font-family": "inherit",
            }}
          />
          <span style={{ "font-size": "11px", color: "#858585", "margin-left": "8px", "white-space": "nowrap" }}>
            esc to dismiss
          </span>
        </div>

        {/* Results list */}
        <div style={{ overflow: "auto", "max-height": "380px", background: "#252526" }}>
          <Show when={total() === 0}>
            <div style={{ padding: "8px 12px", "font-size": "12px", color: "#858585" }}>
              {query() ? "No matching results" : props.mode === "files" ? "Type to search files..." : "No commands found"}
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
                    display: "flex", "align-items": "center", padding: "4px 12px",
                    cursor: "pointer", "min-height": "34px",
                    background: active() === i() ? "#094771" : "transparent",
                  }}
                >
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={{
                      "font-size": "13px", color: "#cccccc",
                      "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis",
                    }}>
                      {label}
                    </div>
                    <Show when={detail}>
                      <div style={{ "font-size": "11px", color: "#858585", "margin-top": "1px", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
                        {detail}
                      </div>
                    </Show>
                  </div>
                  <Show when={keybind}>
                    <span style={{ "font-size": "11px", color: "#858585", "margin-left": "16px", "flex-shrink": 0, "font-family": "monospace" }}>
                      {keybind}
                    </span>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </div>
  )
}
