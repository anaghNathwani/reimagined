import { createEffect, onCleanup, onMount } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { Terminal } from "xterm"
import { FitAddon } from "xterm-addon-fit"
import { WebLinksAddon } from "xterm-addon-web-links"
import "xterm/css/xterm.css"

interface TerminalOutput { id: string; data: string }

export default function TerminalPane(props: { projectPath: string }) {
  let container!: HTMLDivElement
  let term: Terminal
  let fitAddon: FitAddon
  let sessionId: string
  let unlisten: (() => void) | null = null

  onMount(async () => {
    fitAddon = new FitAddon()

    term = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      cursorStyle: "bar",
      cursorInactiveStyle: "outline",
      scrollback: 10000,
      fontFamily: '"JetBrains Mono", "SF Mono", Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      theme: {
        background: "transparent",
        foreground: "#d4d4d4",
        cursor: "#aeafad",
        cursorAccent: "#1e1e1e",
        selectionBackground: "#264f7866",
        black: "#1e1e1e", red: "#f44747", green: "#6a9153", yellow: "#d7ba7d",
        blue: "#569cd6", magenta: "#c586c0", cyan: "#4ec9b0", white: "#d4d4d4",
        brightBlack: "#808080", brightRed: "#f44747", brightGreen: "#b5cea8",
        brightYellow: "#dcdcaa", brightBlue: "#9cdcfe", brightMagenta: "#c586c0",
        brightCyan: "#4fc1ff", brightWhite: "#ffffff",
      },
    })

    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    fitAddon.fit()

    sessionId = await invoke<string>("new_session_id")

    // Subscribe to PTY output from Rust
    unlisten = await listen<TerminalOutput>("terminal-output", (event) => {
      if (event.payload.id !== sessionId) return
      const bin = atob(event.payload.data)
      const arr = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
      term.write(arr)
    })

    // Forward keystrokes to PTY
    term.onData((data) => {
      invoke("terminal_write", { id: sessionId, data }).catch(() => {})
    })

    // Resize PTY when terminal resizes
    const ro = new ResizeObserver(() => {
      fitAddon.fit()
      invoke("terminal_resize", { id: sessionId, cols: term.cols, rows: term.rows }).catch(() => {})
    })
    ro.observe(container)

    // Spawn the shell
    await invoke("terminal_spawn", {
      id: sessionId,
      cwd: props.projectPath || ".",
      cols: term.cols,
      rows: term.rows,
    })

    term.focus()
  })

  // When projectPath changes, send cd command
  createEffect(() => {
    const p = props.projectPath
    if (p && sessionId) {
      invoke("terminal_write", { id: sessionId, data: `cd ${shellEscape(p)}\n` }).catch(() => {})
    }
  })

  onCleanup(() => {
    unlisten?.()
    if (sessionId) invoke("terminal_kill", { id: sessionId }).catch(() => {})
    term?.dispose()
  })

  function shellEscape(s: string) {
    return `'${s.replace(/'/g, "'\\''")}'`
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "rgba(8,8,12,0.85)",
        "backdrop-filter": "blur(20px)",
        "-webkit-backdrop-filter": "blur(20px)",
        padding: "6px",
        overflow: "hidden",
      }}
    >
      <div ref={container} style={{ width: "100%", height: "100%" }} />
    </div>
  )
}
