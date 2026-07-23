import { createSignal, For, Show, onMount, onCleanup, createEffect } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import loader from "@monaco-editor/loader"
import type * as Monaco from "monaco-editor"

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  error?: boolean
}

interface AgentTask {
  id: string
  name: string
  prompt: string
  status: "pending" | "running" | "done" | "failed"
  output: string
  lang: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function agentColor(name: string): string {
  const colors = ["#4fc1ff", "#4ec9b0", "#c586c0", "#dcdcaa", "#f44747", "#569cd6", "#ce9178"]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff
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

// ── MonacoOutput (for agent tasks) ────────────────────────────────────────────

function MonacoOutput(props: { value: string; lang: string }) {
  let container!: HTMLDivElement
  let editor: Monaco.editor.IStandaloneCodeEditor | null = null

  onMount(async () => {
    const monaco = await loader.init()

    monaco.editor.defineTheme("vsc-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#1e1e1e",
        "editor.foreground": "#d4d4d4",
        "editorLineNumber.foreground": "#454545",
        "editor.selectionBackground": "#264f78",
        "editorCursor.foreground": "#aeafad",
        "scrollbar.shadow": "#00000000",
        "scrollbarSlider.background": "#42424266",
        "scrollbarSlider.hoverBackground": "#55555566",
      },
    })

    editor = monaco.editor.create(container, {
      value: props.value,
      language: props.lang,
      theme: "vsc-dark",
      readOnly: true,
      minimap: { enabled: false },
      lineNumbers: "off",
      scrollBeyondLastLine: false,
      wordWrap: "on",
      fontSize: 12,
      fontFamily: "'Consolas', 'Courier New', monospace",
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

// ── SparkleIcon ────────────────────────────────────────────────────────────────

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z" stroke="#007acc" stroke-width="1.5" stroke-linejoin="round" fill="#007acc" fill-opacity="0.3"/>
      <path d="M19 2L19.75 4.25L22 5L19.75 5.75L19 8L18.25 5.75L16 5L18.25 4.25L19 2Z" stroke="#4fc1ff" stroke-width="1" stroke-linejoin="round" fill="#4fc1ff" fill-opacity="0.4"/>
      <path d="M5 16L5.5 17.5L7 18L5.5 18.5L5 20L4.5 18.5L3 18L4.5 17.5L5 16Z" stroke="#4fc1ff" stroke-width="1" stroke-linejoin="round" fill="#4fc1ff" fill-opacity="0.4"/>
    </svg>
  )
}

// ── AIPanel ────────────────────────────────────────────────────────────────────

export default function AIPanel(props: { projectPath: string }) {
  const [messages, setMessages] = createSignal<ChatMessage[]>([])
  const [inputText, setInputText] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [showAgents, setShowAgents] = createSignal(true)
  const [tasks, setTasks] = createSignal<AgentTask[]>([])
  const [agentPrompt, setAgentPrompt] = createSignal("")
  const [selectedTask, setSelectedTask] = createSignal<string | null>(null)
  let messagesEnd!: HTMLDivElement
  let textareaRef!: HTMLTextAreaElement
  let agentInputRef!: HTMLInputElement

  const activeTask = () => tasks().find(t => t.id === selectedTask())
  const runningCount = () => tasks().filter(t => t.status === "running").length

  const scrollToBottom = () => {
    messagesEnd?.scrollIntoView({ behavior: "smooth" })
  }

  createEffect(() => {
    messages()
    setTimeout(scrollToBottom, 50)
  })

  const sendMessage = async () => {
    const text = inputText().trim()
    if (!text || sending()) return

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text }
    setMessages(m => [...m, userMsg])
    setInputText("")
    setSending(true)

    // Reset textarea height
    if (textareaRef) textareaRef.style.height = "auto"

    try {
      const escaped = JSON.stringify(text)
      const out = await invoke<string>("shell_exec", {
        cmd: `echo ${escaped} | reimagined chat --stdin`,
        cwd: props.projectPath || ".",
      })
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: out || "(no response)" }
      setMessages(m => [...m, assistantMsg])
    } catch {
      const errMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Start the Reimagined server to enable AI chat.",
        error: true,
      }
      setMessages(m => [...m, errMsg])
    }

    setSending(false)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleInput = (e: Event) => {
    const el = e.currentTarget as HTMLTextAreaElement
    setInputText(el.value)
    el.style.height = "auto"
    const maxH = 5 * 20 + 16
    el.style.height = Math.min(el.scrollHeight, maxH) + "px"
  }

  const newConversation = () => {
    setMessages([])
    setInputText("")
  }

  const dispatchAgent = async () => {
    const p = agentPrompt().trim()
    if (!p) return
    const id = crypto.randomUUID()
    const name = inferName(p)
    const task: AgentTask = { id, name, prompt: p, status: "running", output: "", lang: "shell" }
    setTasks(t => [...t, task])
    setSelectedTask(id)
    setAgentPrompt("")

    const cmd = buildCmd(p)
    const out = await invoke<string>("shell_exec", { cmd, cwd: props.projectPath || "." }).catch((e: unknown) => `Error: ${e}`)
    const lang = guessLang(out)
    setTasks(t => t.map(x => x.id === id ? { ...x, status: "done", output: out, lang } : x))
  }

  const removeTask = (id: string, e: MouseEvent) => {
    e.stopPropagation()
    setTasks(t => t.filter(x => x.id !== id))
    if (selectedTask() === id) setSelectedTask(null)
  }

  return (
    <div style={{
      display: "flex", "flex-direction": "column", height: "100%", overflow: "hidden",
      background: "var(--vsc-sidebar-bg)", color: "var(--vsc-text)",
    }}>

      {/* ── Header ── */}
      <div style={{
        "flex-shrink": 0,
        display: "flex", "align-items": "center", gap: "8px",
        padding: "10px 12px 8px",
        "border-bottom": "1px solid var(--vsc-border)",
      }}>
        <SparkleIcon />
        <div style={{ flex: 1, "min-width": 0 }}>
          <div style={{ "font-size": "11px", "font-weight": 600, color: "var(--vsc-text)", "letter-spacing": "0.02em" }}>
            Reimagined AI
          </div>
          <div style={{ "font-size": "10px", color: "var(--vsc-text-muted)", "margin-top": "1px" }}>
            Powered by your selected model
          </div>
        </div>
        <button
          title="New conversation"
          onClick={newConversation}
          style={{
            background: "transparent", border: "none", color: "var(--vsc-text-muted)",
            cursor: "pointer", padding: "3px 5px", "border-radius": "3px",
            "font-size": "11px", display: "flex", "align-items": "center", gap: "4px",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--vsc-hover)"; (e.currentTarget as HTMLElement).style.color = "var(--vsc-text)" }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--vsc-text-muted)" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New
        </button>
      </div>

      {/* ── Conversation ── */}
      <div style={{
        flex: 1, "min-height": 0, overflow: "auto",
        padding: "8px 0",
        display: "flex", "flex-direction": "column", gap: "2px",
      }}>
        <Show when={messages().length === 0}>
          <div style={{
            display: "flex", "flex-direction": "column", "align-items": "center",
            "justify-content": "center", height: "100%", gap: "12px",
            color: "var(--vsc-text-muted)", "text-align": "center", padding: "0 20px",
          }}>
            <SparkleIcon />
            <div>
              <div style={{ "font-size": "13px", "font-weight": 500, color: "var(--vsc-text-muted)", "margin-bottom": "4px" }}>
                Reimagined AI
              </div>
              <div style={{ "font-size": "12px", color: "var(--vsc-text-dim)", "line-height": "1.5" }}>
                Ask me anything about your code. I can help you understand, refactor, debug, and more.
              </div>
            </div>
          </div>
        </Show>

        <For each={messages()}>
          {(msg) => (
            <div style={{
              display: "flex",
              "flex-direction": msg.role === "user" ? "row-reverse" : "row",
              padding: "2px 10px",
              gap: "8px",
              "align-items": "flex-start",
            }}>
              <Show when={msg.role === "assistant"}>
                <div style={{
                  "flex-shrink": 0, width: "20px", height: "20px",
                  display: "flex", "align-items": "center", "justify-content": "center",
                  "margin-top": "2px",
                }}>
                  <SparkleIcon />
                </div>
              </Show>
              <div style={{
                "max-width": "85%",
                background: msg.role === "user"
                  ? "var(--vsc-highlight)"
                  : msg.error ? "rgba(244,71,71,0.1)" : "#2a2d2e",
                border: msg.role === "assistant"
                  ? msg.error ? "1px solid rgba(244,71,71,0.3)" : "1px solid var(--vsc-border)"
                  : "none",
                "border-radius": msg.role === "user" ? "8px 8px 2px 8px" : "2px 8px 8px 8px",
                padding: "7px 10px",
                "font-size": "12px",
                "line-height": "1.55",
                color: msg.error ? "#f44747" : "var(--vsc-text)",
                "white-space": "pre-wrap",
                "word-break": "break-word",
              }}>
                {msg.content}
              </div>
            </div>
          )}
        </For>

        <Show when={sending()}>
          <div style={{ display: "flex", padding: "4px 10px", gap: "8px", "align-items": "center" }}>
            <div style={{ "flex-shrink": 0, width: "20px", height: "20px", display: "flex", "align-items": "center", "justify-content": "center" }}>
              <SparkleIcon />
            </div>
            <div style={{ display: "flex", gap: "4px", "align-items": "center" }}>
              {[0, 1, 2].map(i => (
                <div style={{
                  width: "5px", height: "5px", "border-radius": "50%",
                  background: "var(--vsc-text-muted)",
                  animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        </Show>

        <div ref={messagesEnd} />
      </div>

      {/* ── Input area ── */}
      <div style={{
        "flex-shrink": 0,
        "border-top": "1px solid var(--vsc-border)",
        padding: "8px 10px",
        background: "var(--vsc-editor-bg)",
      }}>
        <div style={{
          border: "1px solid var(--vsc-border)",
          "border-radius": "4px",
          background: "#3c3c3c",
          overflow: "hidden",
        }}>
          <textarea
            ref={textareaRef}
            value={inputText()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask Reimagined AI... (Ctrl+Enter to send)"
            rows={2}
            style={{
              width: "100%", background: "transparent", border: "none", outline: "none",
              color: "var(--vsc-text)", "font-size": "12px", padding: "8px 10px",
              resize: "none", "font-family": "inherit", "line-height": "1.5",
              "min-height": "52px", "max-height": "120px",
            }}
          />
          <div style={{
            display: "flex", "align-items": "center", "justify-content": "flex-end",
            padding: "4px 8px", gap: "8px",
            "border-top": "1px solid var(--vsc-border)",
          }}>
            <span style={{ "font-size": "10px", color: "var(--vsc-text-muted)" }}>
              {"⌘"}+Enter to send
            </span>
            <button
              onClick={sendMessage}
              disabled={!inputText().trim() || sending()}
              style={{
                background: inputText().trim() && !sending() ? "#007acc" : "#3c3c3c",
                border: "none", color: "#ffffff", "border-radius": "2px",
                padding: "3px 10px", "font-size": "11px", cursor: inputText().trim() && !sending() ? "pointer" : "default",
                transition: "background 0.1s",
              }}
            >
              {sending() ? "..." : "Send"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Agents section ── */}
      <div style={{
        "flex-shrink": 0,
        "border-top": "1px solid var(--vsc-border)",
      }}>
        {/* Agents header */}
        <div
          onClick={() => setShowAgents(v => !v)}
          style={{
            display: "flex", "align-items": "center", gap: "4px",
            padding: "5px 10px", cursor: "pointer",
            background: "var(--vsc-sidebar-bg)",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--vsc-hover)" }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--vsc-sidebar-bg)" }}
        >
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            style={{ transform: showAgents() ? "rotate(90deg)" : "", transition: "transform 0.15s", color: "var(--vsc-text-muted)" }}
          >
            <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span style={{ "font-size": "11px", "font-weight": 700, color: "var(--vsc-text-muted)", "text-transform": "uppercase", "letter-spacing": "0.08em", flex: 1 }}>
            Agents
          </span>
          <Show when={runningCount() > 0}>
            <span style={{ "font-size": "10px", color: "#007acc", background: "rgba(0,122,204,0.15)", padding: "1px 6px", "border-radius": "10px" }}>
              {runningCount()} running
            </span>
          </Show>
          <button
            title="New agent task"
            onClick={(e) => { e.stopPropagation(); setShowAgents(true); setTimeout(() => agentInputRef?.focus(), 50) }}
            style={{
              background: "transparent", border: "none", color: "var(--vsc-text-muted)",
              cursor: "pointer", padding: "1px 4px", "border-radius": "2px", "font-size": "14px", "line-height": 1,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--vsc-text)" }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--vsc-text-muted)" }}
          >+</button>
        </div>

        <Show when={showAgents()}>
          {/* Task list */}
          <div style={{ "max-height": "180px", overflow: "auto", background: "var(--vsc-editor-bg)" }}>
            <Show when={tasks().length === 0}>
              <div style={{ padding: "12px 14px", "font-size": "11px", color: "var(--vsc-text-muted)", "text-align": "center" }}>
                No agent tasks. Use + to spawn one.
              </div>
            </Show>
            <For each={tasks()}>
              {(task) => (
                <div
                  onClick={() => setSelectedTask(s => s === task.id ? null : task.id)}
                  style={{
                    display: "flex", "align-items": "center", gap: "8px",
                    padding: "5px 10px", cursor: "pointer",
                    background: selectedTask() === task.id ? "var(--vsc-highlight)" : "transparent",
                    "border-left": `2px solid ${selectedTask() === task.id ? agentColor(task.name) : "transparent"}`,
                  }}
                  onMouseEnter={(e) => { if (selectedTask() !== task.id) (e.currentTarget as HTMLElement).style.background = "var(--vsc-hover)" }}
                  onMouseLeave={(e) => { if (selectedTask() !== task.id) (e.currentTarget as HTMLElement).style.background = "transparent" }}
                >
                  <Show
                    when={task.status === "running"}
                    fallback={<div style={{ width: "6px", height: "6px", "border-radius": "50%", "flex-shrink": 0, background: task.status === "done" ? "#4ec9b0" : "#f44747" }} />}
                  >
                    <span style={{ "font-size": "10px", animation: "spin 1s linear infinite", "flex-shrink": 0, color: "#007acc" }}>&#8635;</span>
                  </Show>
                  <div style={{ flex: 1, "min-width": 0 }}>
                    <div style={{ "font-size": "11px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", color: "var(--vsc-text)" }}>{task.prompt}</div>
                    <div style={{ "font-size": "10px", color: agentColor(task.name), "margin-top": "1px" }}>{task.name}</div>
                  </div>
                  <button
                    onClick={(e) => removeTask(task.id, e)}
                    style={{ background: "transparent", border: "none", color: "var(--vsc-text-muted)", cursor: "pointer", "font-size": "11px", padding: "1px 3px", "border-radius": "2px" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#f44747" }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--vsc-text-muted)" }}
                  >
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                  </button>
                </div>
              )}
            </For>
          </div>

          {/* Monaco output for selected task */}
          <Show when={activeTask()}>
            {(task) => (
              <div style={{ height: "140px", overflow: "hidden", "border-top": "1px solid var(--vsc-border)" }}>
                <Show
                  when={task().status !== "running"}
                  fallback={
                    <div style={{ height: "100%", display: "flex", "align-items": "center", "justify-content": "center", gap: "6px", color: "var(--vsc-text-muted)", "font-size": "11px" }}>
                      <span style={{ animation: "spin 1s linear infinite" }}>&#8635;</span> Running {task().name}...
                    </div>
                  }
                >
                  <MonacoOutput value={task().output} lang={task().lang} />
                </Show>
              </div>
            )}
          </Show>

          {/* Agent input */}
          <div style={{ padding: "8px 10px", "border-top": "1px solid var(--vsc-border)", background: "var(--vsc-sidebar-bg)" }}>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                ref={agentInputRef}
                type="text"
                placeholder="Agent task (Enter to run)..."
                value={agentPrompt()}
                onInput={(e) => setAgentPrompt(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); dispatchAgent() } }}
                style={{
                  flex: 1, background: "#3c3c3c", border: "1px solid var(--vsc-border)",
                  "border-radius": "2px", color: "var(--vsc-text)", "font-size": "11px",
                  padding: "4px 8px", outline: "none",
                }}
              />
              <button
                onClick={dispatchAgent}
                disabled={!agentPrompt().trim()}
                style={{
                  background: agentPrompt().trim() ? "#007acc" : "#3c3c3c",
                  border: "none", color: "#ffffff", "border-radius": "2px",
                  padding: "4px 10px", "font-size": "11px", cursor: agentPrompt().trim() ? "pointer" : "default",
                }}
              >
                Run
              </button>
            </div>
          </div>
        </Show>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
