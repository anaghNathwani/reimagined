import { createSignal, For, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"

interface AgentTask {
  id: string
  name: string
  prompt: string
  status: "pending" | "running" | "done" | "failed"
  output: string
}

function agentColor(name: string): string {
  const colors = ["#569cd6", "#6a9153", "#c586c0", "#d7ba7d", "#f44747", "#4ec9b0", "#ce9178"]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff
  return colors[Math.abs(hash) % colors.length]
}

export default function AgentPanel(props: { projectPath: string }) {
  const [tasks, setTasks] = createSignal<AgentTask[]>([])
  const [prompt, setPrompt] = createSignal("")
  const [agentName, setAgentName] = createSignal("")
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())

  const running = () => tasks().filter(t => t.status === "running").length

  const dispatch = async () => {
    const p = prompt().trim()
    if (!p) return
    const id = crypto.randomUUID()
    const name = agentName().trim() || inferAgentName(p)
    setTasks(t => [...t, { id, name, prompt: p, status: "running", output: "" }])
    setPrompt("")

    const cmd = buildCmd(p)
    const output = await invoke<string>("shell_exec", { cmd, cwd: props.projectPath }).catch((e: unknown) => `Error: ${e}`)
    setTasks(t => t.map(task => task.id === id ? { ...task, status: "done", output } : task))
  }

  const remove = (id: string) => setTasks(t => t.filter(x => x.id !== id))
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
            Describe a task — agents are created on demand
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
                  fallback={<div style={{ width: "7px", height: "7px", "border-radius": "50%", "flex-shrink": 0, background: statusColor(task.status) }} />}
                >
                  <span style={{ "font-size": "10px", animation: "spin 1s linear infinite", "flex-shrink": 0 }}>↻</span>
                </Show>
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div style={{ "font-size": "12px", "font-weight": 500, overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                    {task.prompt}
                  </div>
                  <div style={{ display: "flex", gap: "5px", "margin-top": "2px", "align-items": "center" }}>
                    <span style={{ "font-size": "10px", color: statusColor(task.status) }}>{task.status}</span>
                    <span style={{ "font-size": "10px", color: "rgba(255,255,255,0.3)" }}>·</span>
                    <span style={{ "font-size": "10px", color: agentColor(task.name), "font-weight": 600 }}>{task.name}</span>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); remove(task.id) }}
                  style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", "font-size": "12px", padding: "0 4px" }}
                >✕</button>
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
        <input
          type="text"
          placeholder="Agent name (optional — inferred if blank)"
          value={agentName()}
          onInput={(e) => setAgentName(e.currentTarget.value)}
          style={{
            width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
            "border-radius": "6px", color: "rgba(255,255,255,0.6)", "font-size": "11px",
            padding: "5px 9px", "font-family": "inherit", outline: "none", "margin-bottom": "6px",
            "box-sizing": "border-box",
          }}
        />
        <textarea
          value={prompt()}
          onInput={(e) => setPrompt(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); dispatch() } }}
          placeholder="Describe the task…"
          rows={3}
          style={{
            width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
            "border-radius": "6px", color: "rgba(255,255,255,0.85)", "font-size": "12px",
            padding: "7px 9px", resize: "none", "font-family": "inherit", outline: "none",
            "box-sizing": "border-box",
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
          ⬆ Dispatch <span style={{ "font-size": "10px", opacity: "0.6" }}>⌘↵</span>
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function statusColor(status: string): string {
  return { pending: "rgba(255,255,255,0.4)", running: "#569cd6", done: "#6a9153", failed: "#f44747" }[status] ?? "#808080"
}

function inferAgentName(prompt: string): string {
  const p = prompt.toLowerCase()
  if (p.includes("test")) return "test-writer"
  if (p.includes("lint") || p.includes("eslint") || p.includes("clippy")) return "linter"
  if (p.includes("format") || p.includes("prettier")) return "formatter"
  if (p.includes("git") || p.includes("diff") || p.includes("commit")) return "git-agent"
  if (p.includes("search") || p.includes("find") || p.includes("grep")) return "searcher"
  if (p.includes("refactor")) return "refactor-agent"
  if (p.includes("review")) return "code-reviewer"
  if (p.includes("debug") || p.includes("fix") || p.includes("error")) return "debugger"
  if (p.includes("build") || p.includes("compile")) return "build-agent"
  if (p.includes("doc")) return "doc-writer"
  return "agent"
}

function buildCmd(prompt: string): string {
  const esc = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
  const p = prompt.toLowerCase()
  if (p.includes("git log")) return "git log --oneline -20"
  if (p.includes("git diff")) return "git diff --stat"
  if (p.includes("git status")) return "git status"
  if (p.startsWith("grep ") || p.startsWith("find ") || p.startsWith("ls ")) return prompt
  if (p.includes("lint")) return "npx eslint . --max-warnings 20 2>&1 | head -60 || cargo clippy 2>&1 | head -60 || go vet ./... 2>&1"
  if (p.includes("format")) return "npx prettier --write . 2>&1 | tail -10 || cargo fmt 2>&1 || gofmt -w . 2>&1"
  if (p.includes("test")) return "bun test 2>&1 | tail -40 || npm test 2>&1 | tail -40 || cargo test 2>&1 | tail -40"
  if (p.includes("search") || p.includes("find")) {
    const words = prompt.split(/\s+/).filter(w => w.length > 2)
    const term = words[words.length - 1] ?? prompt
    return `grep -rn --color=never ${esc(term)} . 2>/dev/null | head -80`
  }
  return prompt
}
