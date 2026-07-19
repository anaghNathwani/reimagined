import { createSignal, For, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"

interface AgentTask {
  id: string
  prompt: string
  status: "pending" | "running" | "done" | "failed"
  output: string
  agentType: string
}

const AGENTS = [
  { id: "shell",  name: "Shell",     desc: "Run shell commands" },
  { id: "search", name: "Search",    desc: "Search files for patterns" },
  { id: "git",    name: "Git",       desc: "Git status / diff / log" },
  { id: "format", name: "Formatter", desc: "Auto-format code" },
  { id: "lint",   name: "Linter",    desc: "Run linters" },
]

const AGENT_COLORS: Record<string, string> = {
  shell: "#6a9153", search: "#569cd6", git: "#f44747", format: "#c586c0", lint: "#d7ba7d",
}

export default function AgentPanel(props: { projectPath: string }) {
  const [tasks, setTasks] = createSignal<AgentTask[]>([])
  const [prompt, setPrompt] = createSignal("")
  const [selectedAgent, setSelectedAgent] = createSignal("shell")
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())

  const running = () => tasks().filter(t => t.status === "running").length

  const dispatch = async () => {
    const p = prompt().trim()
    if (!p) return
    const id = crypto.randomUUID()
    const agentType = selectedAgent()
    setTasks(t => [...t, { id, prompt: p, status: "running", output: "", agentType }])
    setPrompt("")

    const output = await runAgent(agentType, p, props.projectPath)
    setTasks(t => t.map(task => task.id === id ? { ...task, status: "done", output } : task))
  }

  const toggle = (id: string) =>
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "10px 14px", "border-bottom": "1px solid rgba(255,255,255,0.07)", "flex-shrink": 0, display: "flex", "align-items": "center", gap: "8px" }}>
        <span style={{ "font-size": "13px", "font-weight": 600, flex: 1 }}>Agents</span>
        <Show when={running() > 0}>
          <span style={{ "font-size": "10px", color: "#569cd6", background: "rgba(86,156,214,0.15)", padding: "2px 7px", "border-radius": "10px" }}>
            {running()} active
          </span>
        </Show>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px" }}>
        <Show when={tasks().length === 0}>
          <div style={{ padding: "32px 16px", "text-align": "center", color: "rgba(255,255,255,0.25)", "font-size": "12px" }}>
            <div style={{ "font-size": "28px", "margin-bottom": "8px", opacity: "0.3" }}>⚡</div>
            No tasks yet
          </div>
        </Show>
        <For each={tasks()}>
          {(task) => (
            <div
              onClick={() => toggle(task.id)}
              style={{
                background: "rgba(255,255,255,0.05)", "border-radius": "8px", padding: "10px",
                "margin-bottom": "6px", cursor: "pointer",
                border: "0.5px solid rgba(255,255,255,0.08)", transition: "background 0.1s",
              }}
            >
              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <Show
                  when={task.status === "running"}
                  fallback={
                    <div style={{ width: "7px", height: "7px", "border-radius": "50%", "flex-shrink": 0, background: statusColor(task.status) }} />
                  }
                >
                  <div style={{ width: "14px", height: "14px", "flex-shrink": 0, display: "flex", "align-items": "center", "justify-content": "center" }}>
                    <span style={{ "font-size": "10px", animation: "spin 1s linear infinite" }}>↻</span>
                  </div>
                </Show>
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div style={{ "font-size": "12px", "font-weight": 500, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                    {task.prompt}
                  </div>
                  <div style={{ display: "flex", gap: "5px", "margin-top": "2px", "align-items": "center" }}>
                    <span style={{ "font-size": "10px", color: statusColor(task.status) }}>{task.status}</span>
                    <span style={{ "font-size": "10px", color: "rgba(255,255,255,0.3)" }}>·</span>
                    <span style={{ "font-size": "10px", color: AGENT_COLORS[task.agentType] ?? "rgba(255,255,255,0.3)" }}>{task.agentType}</span>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setTasks(t => t.filter(x => x.id !== task.id)) }}
                  style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", "font-size": "12px", padding: "0 4px" }}
                >
                  ✕
                </button>
              </div>
              <Show when={expanded().has(task.id) && task.output}>
                <pre style={{
                  "margin-top": "8px", "font-size": "10px", "font-family": "monospace",
                  color: "#6a9153", background: "rgba(0,0,0,0.4)", "border-radius": "5px",
                  padding: "6px", overflow: "auto", "max-height": "140px", "white-space": "pre-wrap",
                  "word-break": "break-all",
                }}>{task.output}</pre>
              </Show>
            </div>
          )}
        </For>
      </div>

      {/* Composer */}
      <div style={{ padding: "10px 12px", "border-top": "1px solid rgba(255,255,255,0.07)", "flex-shrink": 0 }}>
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "6px" }}>
          <span style={{ "font-size": "11px", "font-weight": 600, color: "rgba(255,255,255,0.4)", "text-transform": "uppercase", "letter-spacing": "0.05em" }}>Assign Task</span>
          <select
            value={selectedAgent()}
            onChange={(e) => setSelectedAgent(e.currentTarget.value)}
            style={{ background: "rgba(255,255,255,0.07)", border: "none", color: "rgba(255,255,255,0.7)", "font-size": "11px", "border-radius": "4px", padding: "2px 5px", cursor: "pointer" }}
          >
            <For each={AGENTS}>{(a) => <option value={a.id}>{a.name}</option>}</For>
          </select>
        </div>
        <textarea
          value={prompt()}
          onInput={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); dispatch() } }}
          placeholder="Describe task…"
          rows={3}
          style={{
            width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            "border-radius": "6px", color: "rgba(255,255,255,0.85)", "font-size": "12px",
            padding: "7px 9px", resize: "none", "font-family": "inherit", outline: "none",
          }}
        />
        <button
          onClick={dispatch}
          disabled={!prompt().trim()}
          style={{
            "margin-top": "6px", width: "100%",
            background: prompt().trim() ? "rgba(86,156,214,0.25)" : "rgba(255,255,255,0.05)",
            border: `1px solid ${prompt().trim() ? "rgba(86,156,214,0.4)" : "rgba(255,255,255,0.08)"}`,
            color: prompt().trim() ? "#9cdcfe" : "rgba(255,255,255,0.25)",
            "border-radius": "6px", padding: "6px", cursor: prompt().trim() ? "pointer" : "default",
            "font-size": "12px", "font-weight": 500, transition: "all 0.15s",
          }}
        >
          ⬆ Dispatch  <span style={{ "font-size": "10px", opacity: "0.6" }}>⌘↵</span>
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function statusColor(status: string): string {
  return { pending: "rgba(255,255,255,0.4)", running: "#569cd6", done: "#6a9153", failed: "#f44747" }[status] ?? "#808080"
}

async function runAgent(agentId: string, prompt: string, cwd: string): Promise<string> {
  const cmd = buildCmd(agentId, prompt)
  return invoke<string>("shell_exec", { cmd, cwd }).catch((e) => `Error: ${e}`)
}

function buildCmd(agentId: string, prompt: string): string {
  const esc = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
  switch (agentId) {
    case "search": return `grep -rn --color=never ${esc(prompt)} . 2>/dev/null | head -80`
    case "git":
      if (prompt.toLowerCase().includes("log")) return "git log --oneline -20"
      if (prompt.toLowerCase().includes("diff")) return "git diff --stat"
      return "git status && echo '---' && git log --oneline -5"
    case "format": return "npx prettier --write . 2>&1 | tail -10 || gofmt -w . 2>&1 || cargo fmt 2>&1 || echo 'No formatter found'"
    case "lint": return "npx eslint . --max-warnings 20 2>&1 | head -60 || cargo clippy 2>&1 | head -60 || go vet ./... 2>&1 || echo 'No linter found'"
    default: return prompt
  }
}
