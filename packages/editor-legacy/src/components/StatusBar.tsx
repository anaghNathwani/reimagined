import { Show } from "solid-js"

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
  branch?: string
}

export default function StatusBar(props: Props) {
  const errors = () => props.diagnostics.filter(d => d.severity === 8).length
  const warnings = () => props.diagnostics.filter(d => d.severity === 4).length
  const branch = () => props.branch ?? "main"

  return (
    <div
      style={{
        height: "22px", "flex-shrink": 0,
        display: "flex", "align-items": "center",
        background: "var(--vsc-statusbar-bg)",
        "font-size": "12px",
        color: "#ffffff",
        "user-select": "none",
        overflow: "hidden",
      }}
    >
      {/* LEFT: branch + errors */}
      <SBItem>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ "vertical-align": "middle", "margin-right": "4px" }}>
          <circle cx="5" cy="3" r="1.5" stroke="currentColor" stroke-width="1.2"/>
          <circle cx="5" cy="13" r="1.5" stroke="currentColor" stroke-width="1.2"/>
          <circle cx="11" cy="6" r="1.5" stroke="currentColor" stroke-width="1.2"/>
          <path d="M5 4.5v7M5 4.5c0 2 6 2 6 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        {branch()}
      </SBItem>

      <SBItem onClick={props.onClickDiagnostics} clickable>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ "vertical-align": "middle", "margin-right": "2px" }}>
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.2"/>
          <path d="M8 5v4M8 11v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        {errors()}
        <span style={{ "margin-left": "6px", "margin-right": "2px" }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ "vertical-align": "middle" }}>
            <path d="M8 2L14.5 14H1.5L8 2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            <path d="M8 6.5v3.5M8 12v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </span>
        {warnings()}
      </SBItem>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* RIGHT: Ln/Col, language, encoding, Reimagined */}
      <Show when={props.filePath}>
        <SBItem>
          Ln {props.line}, Col {props.col}
        </SBItem>
      </Show>

      <Show when={props.filePath}>
        <SBItem>
          Spaces: {props.indentSize}
        </SBItem>
      </Show>

      <Show when={props.language}>
        <SBItem onClick={props.onClickLanguage} clickable>
          {langDisplayName(props.language)}
        </SBItem>
      </Show>

      <Show when={props.filePath}>
        <SBItem>{props.encoding || "UTF-8"}</SBItem>
      </Show>

      {/* LSP dot */}
      <Show when={props.lspStatus !== "off"}>
        <SBItem>
          <span style={{ color: lspColor(props.lspStatus), "font-size": "8px", "margin-right": "3px" }}>&#9679;</span>
          {lspLabel(props.lspStatus)}
        </SBItem>
      </Show>

      {/* Reimagined branding */}
      <SBItem>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ "vertical-align": "middle", "margin-right": "4px" }}>
          <path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" fill="rgba(255,255,255,0.7)" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>
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

function langDisplayName(lang: string): string {
  const map: Record<string, string> = {
    typescript: "TypeScript", javascript: "JavaScript", python: "Python",
    rust: "Rust", go: "Go", java: "Java", csharp: "C#", cpp: "C++",
    c: "C", json: "JSON", markdown: "Markdown", html: "HTML", css: "CSS",
    scss: "SCSS", shell: "Shell Script", yaml: "YAML", toml: "TOML",
    ruby: "Ruby", kotlin: "Kotlin", php: "PHP", sql: "SQL", xml: "XML",
    swift: "Swift", plaintext: "Plain Text",
  }
  return map[lang] ?? lang
}

function lspColor(status: string): string {
  switch (status) {
    case "ready":    return "#4ec9b0"
    case "starting": return "#dcdcaa"
    case "error":    return "#f44747"
    default:         return "#858585"
  }
}

function lspLabel(status: string): string {
  switch (status) {
    case "ready":    return "LSP"
    case "starting": return "LSP..."
    case "error":    return "LSP!"
    default:         return ""
  }
}
