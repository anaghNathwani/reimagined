import { createSignal, For, Show, onMount, onCleanup } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import loader from "@monaco-editor/loader"
import type * as Monaco from "monaco-editor"

interface AgentTask {
  id: string
  name: string
  prompt: string
  status: "pending" | "running" | "done" | "failed"
  output: string
  lang: string
}

function agentColor(name: string): string {
  const colors = ["#58a6ff", "#3fb950", "#bc8cff", "#e3b341", "#f85149", "#39c5cf", "#e08b6a"]
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff
  return colors[Math.abs(h) % colors.length]
}

function inferName(prompt: string): string {
  const p = prompt.toLowerCase()
  if (p.includes("test")) return "test-writer"
  if (p.includes("lint") || p.includes("eslint")) return "linter"
  if (p.includes("format") || p.includes("prettier")) return "formatter"
  if (p.includes("git")) return "git-agent"
  if (p.includes("search") || p.includes("find") || p.includes("grep")) return "searcher"
  if (p.includes("refactor")) return "refactor-agent"
  if (p.includes("review")) return "code-reviewer"
  if (p.includes("debug") || p.includes("fix") || p.includes("error")) return "debugger"
  if (p.includes("build") || p.includes("compile")) return "build-agent"
  if (p.includes("doc")) return "doc-writer"
  return "agent"
}

function guessLang(output: string): string {
  if (output.startsWith("{") || output.startsWith("[")) return "json"
  if (output.includes("error[E") || output.includes("warning:")) return "rust"
  if (output.match(/^\s*(import|export|const|let|function)/m)) return "typescript"
  if (output.match(/^\s*(def |class |import )/m)) return "python"
  if (output.match(/^(On branch|Changes|Untracked|diff --git)/m)) return "diff"
  return "shell"
}

function buildCmd(prompt: string): string {
  const esc = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
  const p = prompt.toLowerCase()
  if (p.includes("git log")) return "git log --oneline -20"
  if (p.includes("git diff")) return "git diff --stat"
  if (p.includes("git status")) return "git status"
  if (p.startsWith("grep ") || p.startsWith("find ") || p.startsWith("ls ") || p.startsWith("cat ")) return prompt
  if (p.includes("lint")) return "npx eslint . --max-warnings 20 2>&1 | head -60 || cargo clippy 2>&1 | head -60"
  if (p.includes("format")) return "npx prettier --write . 2>&1 | tail -10 || cargo fmt 2>&1"
  if (p.includes("test")) return "bun test 2>&1 | tail -40 || npm test 2>&1 | tail -40 || cargo test 2>&1 | tail -40"
  if (p.includes("search") || p.includes("find")) {
    const words = prompt.split(/\s+/).filter(w => w.length > 2)
    return `grep -rn --color=never ${esc(words[words.length - 1] ?? prompt)} . 2>/dev/null | head -80`
  }
  return prompt
}

// Monaco output viewer — read-only, themed
function MonacoOutput(props: { value: string; lang: string }) {
  let container!: HTMLDivElement
  let editor: Monaco.editor.IStandaloneCodeEditor | null = null
  let monacoRef: typeof Monaco | null = null

  onMount(async () => {
    const monaco = await loader.init()
    monacoRef = monaco

    monaco.editor.defineTheme("reimagined-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0a0d12",
        "editor.foreground": "#e6edf3",
        "editorLineNumber.foreground": "#30363d",
        "editor.selectionBackground": "#264f78",
        "editorCursor.foreground": "#58a6ff",
        "scrollbar.shadow": "#00000000",
        "scrollbarSlider.background": "#ffffff1a",
        "scrollbarSlider.hoverBackground": "#ffffff2e",
      },
    })

    editor = monaco.editor.create(container, {
      value: props.value,
      language: props.lang,
      theme: "reimagined-dark",
      readOnly: true,
      minimap: { enabled: false },
      lineNumbers: "off",
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 12,
      fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      glyphMargin: false,
      folding: false,
      renderLineHighlight: "none",
      scrollbar: { vertical: "auto", horizontal: "hidden", alwaysConsumeMouseWheel: false },
      overviewRulerLanes: 0,
      padding: { top: 8, bottom: 8 },
      contextmenu: false,
    })
  })

  onCleanup(() => editor?.dispose())

  return <div ref={container} style={{ width: "100%", height: "100%", "min-height": "80px" }} />
}

export default function AgentPanel(props: { projectPath: string }) {
  const [tasks, setTasks] = createSignal<AgentTask[]>([])
  const [prompt, setPrompt] = createSignal("")
  const [agentName, setAgentName] = createSignal("")
  const [selected, setSelected] = createSignal<string | null>(null)

  const active = () => tasks().find(t => t.id === selected())
  const running = () => tasks().filter(t => t.status === "running").length

  const dispatch = async () => {
    const p = prompt().trim()
    if (!p) return
    const id = crypto.randomUUID()
    const name = agentName().trim() || inferName(p)
    const task: AgentTask = { id, name, prompt: p, status: "running", output: "", lang: "shell" }
    setTasks(t => [...t, task])
    setSelected(id)
    setPrompt("")

    const cmd = buildCmd(p)
    const out = await invoke<string>("shell_exec", { cmd, cwd: props.projectPath || "." }).catch((e: unknown) => `Error: ${e}`)
    const lang = guessLang(out)
    setTasks(t => t.map(x => x.id === id ? { ...x, status: "done", output: out, lang } : x))
  }

  const remove = (id: string, e: MouseEvent) => {
    e.stopPropagation()
    setTasks(t => t.filter(x => x.id !== id))
    if (selected() === id) setSelected(null)
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", overflow: "hidden" }}>

      {/* Task list */}
      <div style={{ flex: "0 0 auto", overflow: "auto", "max-height": "45%", "border-bottom": "1px solid rgba(255,255,255,0.07)" }}>
        <Show when={tasks().length === 0}>
          <div style={{ padding: "28px 14px", "text-align": "center", color: "rgba(230,237,243,0.2)", "font-size": "12px", "line-height": "1.6" }}>
            <div style={{ "font-size": "22px", "margin-bottom": "8px", opacity: "0.2" }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ margin: "0 auto", display: "block" }}>
                <circle cx="14" cy="9" r="4" stroke="currentColor" stroke-width="1.5"/>
                <path d="M6 26c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <circle cx="21" cy="6" r="2.5" stroke="currentColor" stroke-width="1.3"/>
                <path d="M21 8.5v2M19.5 7.5l1 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
            </div>
            Agents spawn on demand.<br/>Name them or leave blank.
          </div>
        </Show>
        <For each={tasks()}>
          {(task) => (
            <div
              onClick={() => setSelected(s => s === task.id ? null : task.id)}
              style={{
                display: "flex", "align-items": "center", gap: "8px",
                padding: "8px 10px", cursor: "pointer",
                background: selected() === task.id ? "rgba(88,166,255,0.08)" : "transparent",
                "border-left": `2px solid ${selected() === task.id ? agentColor(task.name) : "transparent"}`,
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { if (selected() !== task.id) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)" }}
              onMouseLeave={(e) => { if (selected() !== task.id) (e.currentTarget as HTMLElement).style.background = "transparent" }}
            >
              <Show
                when={task.status === "running"}
                fallback={<div style={{ width: "6px", height: "6px", "border-radius": "50%", "flex-shrink": 0, background: task.status === "done" ? "#3fb950" : task.status === "failed" ? "#f85149" : "rgba(255,255,255,0.2)" }} />}
              >
                <span style={{ "font-size": "10px", animation: "spin 1s linear infinite", "flex-shrink": 0, color: "#58a6ff" }}>↻</span>
              </Show>
              <div style={{ flex: 1, "min-width": 0 }}>
                <div style={{ "font-size": "12px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", color: "rgba(230,237,243,0.8)" }}>{task.prompt}</div>
                <div style={{ "font-size": "10px", color: agentColor(task.name), "font-weight": 600, "margin-top": "1px" }}>{task.name}</div>
              </div>
              <button
                onClick={(e) => remove(task.id, e)}
                style={{ background: "transparent", border: "none", color: "rgba(230,237,243,0.2)", cursor: "pointer", "font-size": "11px", padding: "2px 4px", "border-radius": "3px", "flex-shrink": 0 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#f85149" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(230,237,243,0.2)" }}
              >✕</button>
            </div>
          )}
        </For>
      </div>

      {/* Monaco output pane */}
      <div style={{ flex: 1, overflow: "hidden", "min-height": 0, background: "#0a0d12" }}>
        <Show
          when={active()}
          fallback={
            <div style={{ height: "100%", display: "flex", "align-items": "center", "justify-content": "center", color: "rgba(230,237,243,0.15)", "font-size": "11px" }}>
              Select a task to view output
            </div>
          }
        >
          {(task) => (
            <Show
              when={task().status !== "running"}
              fallback={
                <div style={{ height: "100%", display: "flex", "align-items": "center", "justify-content": "center", gap: "8px", color: "rgba(230,237,243,0.3)", "font-size": "11px" }}>
                  <span style={{ animation: "spin 1s linear infinite" }}>↻</span> Running {task().name}…
                </div>
              }
            >
              <MonacoOutput value={task().output} lang={task().lang} />
            </Show>
          )}
        </Show>
      </div>

      {/* Composer */}
      <div style={{ "flex-shrink": 0, padding: "10px 10px 10px", "border-top": "1px solid rgba(255,255,255,0.07)", background: "rgba(13,17,23,0.5)" }}>
        <input
          type="text"
          placeholder="Agent name (auto-inferred if blank)"
          value={agentName()}
          onInput={(e) => setAgentName(e.currentTarget.value)}
          style={{
            width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            "border-radius": "5px", color: "rgba(230,237,243,0.5)", "font-size": "11px",
            padding: "5px 8px", outline: "none", "margin-bottom": "6px",
          }}
        />
        <textarea
          value={prompt()}
          onInput={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); dispatch() } }}
          placeholder="Describe the task… (⌘↵ to run)"
          rows={3}
          style={{
            width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)",
            "border-radius": "5px", color: "rgba(230,237,243,0.85)", "font-size": "12px",
            padding: "7px 8px", resize: "none", outline: "none",
            "font-family": "'SF Mono', 'Fira Code', monospace",
          }}
        />
        <div style={{ display: "flex", gap: "6px", "margin-top": "6px" }}>
          <Show when={running() > 0}>
            <span style={{ "font-size": "10px", color: "#58a6ff", background: "rgba(88,166,255,0.1)", padding: "3px 8px", "border-radius": "10px", "align-self": "center" }}>
              {running()} running
            </span>
          </Show>
          <div style={{ flex: 1 }} />
          <button
            onClick={dispatch}
            disabled={!prompt().trim()}
            style={{
              background: prompt().trim() ? "rgba(88,166,255,0.2)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${prompt().trim() ? "rgba(88,166,255,0.35)" : "rgba(255,255,255,0.08)"}`,
              color: prompt().trim() ? "#58a6ff" : "rgba(230,237,243,0.2)",
              "border-radius": "5px", padding: "5px 14px", cursor: prompt().trim() ? "pointer" : "default",
              "font-size": "12px", "font-weight": 500, transition: "all 0.12s",
            }}
          >
            Run
          </button>
        </div>
      </div>
    </div>
  )
}
