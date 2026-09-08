import { createSignal, For, Show, createEffect } from "solid-js"
import { invoke } from "@tauri-apps/api/core"

interface SearchMatch {
  file: string
  line: number
  col: number
  text: string
}

interface GroupedResult {
  file: string
  matches: SearchMatch[]
}

interface Props {
  projectPath: string
  onJump: (file: string, line: number, col: number) => void
}

export default function SearchPanel(props: Props) {
  const [query, setQuery] = createSignal("")
  const [caseSensitive, setCaseSensitive] = createSignal(false)
  const [wholeWord, setWholeWord] = createSignal(false)
  const [useRegex, setUseRegex] = createSignal(false)
  const [results, setResults] = createSignal<GroupedResult[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())

  let debounceTimer: ReturnType<typeof setTimeout>

  const search = async (q: string) => {
    if (!q.trim()) { setResults([]); setError(""); return }
    setLoading(true)
    setError("")
    try {
      const matches = await invoke<SearchMatch[]>("search_text", {
        query: q,
        cwd: props.projectPath || ".",
        caseSensitive: caseSensitive(),
        wholeWord: wholeWord(),
        useRegex: useRegex(),
      })
      // Group by file
      const map = new Map<string, SearchMatch[]>()
      for (const m of matches) {
        if (!map.has(m.file)) map.set(m.file, [])
        map.get(m.file)!.push(m)
      }
      setResults([...map.entries()].map(([file, ms]) => ({ file, matches: ms })))
    } catch (e: any) {
      setError(e?.toString() ?? "Search error")
      setResults([])
    }
    setLoading(false)
  }

  createEffect(() => {
    const q = query()
    const _cs = caseSensitive(); const _ww = wholeWord(); const _rx = useRegex()
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => search(q), 300)
  })

  const totalMatches = () => results().reduce((n, g) => n + g.matches.length, 0)
  const toggleCollapsed = (file: string) =>
    setCollapsed(s => { const n = new Set(s); n.has(file) ? n.delete(file) : n.add(file); return n })

  const highlight = (text: string, q: string) => {
    if (!q || useRegex()) return text
    try {
      const idx = text.toLowerCase().indexOf(q.toLowerCase())
      if (idx === -1) return text
      return text.slice(0, idx) + "〈" + text.slice(idx, idx + q.length) + "〉" + text.slice(idx + q.length)
    } catch { return text }
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", overflow: "hidden" }}>
      {/* Search input */}
      <div style={{ padding: "10px 10px 8px", "flex-shrink": 0 }}>
        <div style={{ display: "flex", "align-items": "center", gap: "4px", background: "rgba(255,255,255,0.07)", "border-radius": "6px", padding: "5px 8px", border: "1px solid rgba(255,255,255,0.1)" }}>
          <span style={{ color: "rgba(255,255,255,0.35)", "font-size": "12px" }}>🔍</span>
          <input
            type="text"
            placeholder="Search in files…"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "rgba(255,255,255,0.88)", "font-size": "12px", "font-family": "inherit" }}
          />
          <Show when={loading()}>
            <span style={{ "font-size": "10px", color: "rgba(255,255,255,0.3)", animation: "spin 1s linear infinite" }}>↻</span>
          </Show>
        </div>

        {/* Options row */}
        <div style={{ display: "flex", gap: "4px", "margin-top": "6px" }}>
          {[
            ["Aa", "Case sensitive", caseSensitive, setCaseSensitive],
            ["\\b", "Whole word", wholeWord, setWholeWord],
            [".*", "Regex", useRegex, setUseRegex],
          ].map(([label, title, get, set]) => (
            <button
              title={title as string}
              onClick={() => (set as any)((v: boolean) => !v)}
              style={{
                background: (get as any)() ? "rgba(86,156,214,0.25)" : "rgba(255,255,255,0.06)",
                border: `1px solid ${(get as any)() ? "rgba(86,156,214,0.5)" : "rgba(255,255,255,0.1)"}`,
                color: (get as any)() ? "#9cdcfe" : "rgba(255,255,255,0.45)",
                "border-radius": "4px", padding: "2px 7px", "font-size": "11px",
                cursor: "pointer", transition: "all 0.15s", "font-family": "monospace",
              }}
            >{label as string}</button>
          ))}
          <div style={{ flex: 1 }} />
          <Show when={totalMatches() > 0}>
            <span style={{ "font-size": "10px", color: "rgba(255,255,255,0.3)", "align-self": "center" }}>
              {totalMatches()} result{totalMatches() !== 1 ? "s" : ""}
            </span>
          </Show>
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <Show when={error()}>
          <div style={{ padding: "12px", color: "#f44747", "font-size": "11px" }}>{error()}</div>
        </Show>
        <Show when={!query().trim()}>
          <div style={{ padding: "24px 16px", "text-align": "center", color: "rgba(255,255,255,0.2)", "font-size": "12px" }}>
            Type to search across all files
          </div>
        </Show>
        <Show when={query().trim() && !loading() && results().length === 0 && !error()}>
          <div style={{ padding: "24px 16px", "text-align": "center", color: "rgba(255,255,255,0.25)", "font-size": "12px" }}>No results</div>
        </Show>

        <For each={results()}>
          {(group) => {
            const isCollapsed = () => collapsed().has(group.file)
            const filename = group.file.split("/").pop()!
            const dir = group.file.split("/").slice(0, -1).join("/")

            return (
              <div style={{ "border-bottom": "1px solid rgba(255,255,255,0.05)" }}>
                {/* File header */}
                <div
                  onClick={() => toggleCollapsed(group.file)}
                  style={{
                    display: "flex", "align-items": "center", gap: "6px",
                    padding: "5px 10px", cursor: "pointer",
                    background: "rgba(255,255,255,0.04)",
                    position: "sticky", top: 0,
                  }}
                >
                  <span style={{ "font-size": "9px", color: "rgba(255,255,255,0.4)", transition: "transform 0.15s", transform: isCollapsed() ? "rotate(-90deg)" : "" }}>▾</span>
                  <span style={{ "font-size": "12px", "font-weight": 600, color: "rgba(255,255,255,0.8)" }}>{filename}</span>
                  <Show when={dir}>
                    <span style={{ "font-size": "10px", color: "rgba(255,255,255,0.3)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap", flex: 1 }}>{dir}</span>
                  </Show>
                  <span style={{ "font-size": "10px", color: "rgba(86,156,214,0.7)", "flex-shrink": 0 }}>{group.matches.length}</span>
                </div>

                {/* Match lines */}
                <Show when={!isCollapsed()}>
                  <For each={group.matches}>
                    {(match) => (
                      <div
                        onClick={() => {
                          const full = props.projectPath ? `${props.projectPath}/${match.file}` : match.file
                          props.onJump(full, match.line, match.col)
                        }}
                        style={{
                          display: "flex", gap: "8px", padding: "3px 10px 3px 24px",
                          cursor: "pointer", "font-size": "12px",
                          "font-family": "monospace",
                          transition: "background 0.08s",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(86,156,214,0.1)" }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent" }}
                      >
                        <span style={{ "flex-shrink": 0, color: "rgba(255,255,255,0.25)", "min-width": "30px", "text-align": "right", "user-select": "none" }}>{match.line}</span>
                        <span style={{ flex: 1, color: "rgba(255,255,255,0.65)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                          {match.text}
                        </span>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            )
          }}
        </For>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
