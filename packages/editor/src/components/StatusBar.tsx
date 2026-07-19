import { For, Show } from "solid-js"

interface Diagnostic {
  severity: number // Monaco: 8=error, 4=warning, 2=info, 1=hint
}

interface Props {
  filePath: string | null
  line: number
  col: number
  language: string
  lspStatus: "off" | "starting" | "ready" | "error"
  diagnostics: Diagnostic[]
  onClickDiagnostics: () => void
  onClickLanguage: () => void
  indentSize: number
  encoding: string
}

export default function StatusBar(props: Props) {
  const errors = () => props.diagnostics.filter(d => d.severity === 8).length
  const warnings = () => props.diagnostics.filter(d => d.severity === 4).length
  const filename = () => props.filePath?.split("/").pop() ?? ""

  const lspDot = () => {
    switch (props.lspStatus) {
      case "ready":    return { color: "#6a9153", label: "LSP" }
      case "starting": return { color: "#d7ba7d", label: "LSP…" }
      case "error":    return { color: "#f44747", label: "LSP!" }
      default:         return null
    }
  }

  return (
    <div
      style={{
        height: "22px", "flex-shrink": 0,
        display: "flex", "align-items": "center",
        background: "rgba(0,0,0,0.35)",
        "border-top": "1px solid rgba(255,255,255,0.06)",
        "font-size": "11px",
        color: "rgba(255,255,255,0.45)",
        "padding": "0 8px",
        gap: "1px",
        "user-select": "none",
      }}
    >
      {/* Diagnostics */}
      <Show when={errors() > 0 || warnings() > 0}>
        <StatusItem onClick={props.onClickDiagnostics}>
          <Show when={errors() > 0}>
            <span style={{ color: "#f44747" }}>✗ {errors()}</span>
          </Show>
          <Show when={warnings() > 0}>
            <span style={{ color: "#d7ba7d", "margin-left": "6px" }}>⚠ {warnings()}</span>
          </Show>
        </StatusItem>
      </Show>

      <div style={{ flex: 1 }} />

      {/* LSP indicator */}
      <Show when={lspDot()}>
        {(dot) => (
          <StatusItem>
            <span style={{ color: dot().color, "font-size": "9px" }}>●</span>
            <span style={{ "margin-left": "3px" }}>{dot().label}</span>
          </StatusItem>
        )}
      </Show>

      {/* Indent */}
      <Show when={props.filePath}>
        <StatusItem>Spaces: {props.indentSize}</StatusItem>
      </Show>

      {/* Encoding */}
      <Show when={props.filePath}>
        <StatusItem>{props.encoding}</StatusItem>
      </Show>

      {/* Language */}
      <Show when={props.language}>
        <StatusItem onClick={props.onClickLanguage} clickable>
          {props.language}
        </StatusItem>
      </Show>

      {/* Line/col */}
      <Show when={props.filePath}>
        <StatusItem>Ln {props.line}, Col {props.col}</StatusItem>
      </Show>
    </div>
  )
}

function StatusItem(props: {
  children: any
  onClick?: () => void
  clickable?: boolean
}) {
  return (
    <div
      onClick={props.onClick}
      style={{
        display: "flex", "align-items": "center", gap: "3px",
        padding: "0 8px", height: "100%",
        cursor: props.clickable || props.onClick ? "pointer" : "default",
        transition: "background 0.1s",
        "border-radius": "2px",
      }}
      onMouseEnter={(e) => {
        if (props.onClick || props.clickable)
          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = "transparent"
      }}
    >
      {props.children}
    </div>
  )
}
