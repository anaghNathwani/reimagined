import { createSignal, createEffect, onCleanup, onMount, For, Show } from "solid-js"
import { invoke } from "@tauri-apps/api/core"
import loader from "@monaco-editor/loader"
import type * as Monaco from "monaco-editor"
import { LspClient, extToLanguage, needsExternalLsp } from "../lsp/client"
import { registerLspProviders } from "../lsp/providers"
import StatusBar from "./StatusBar"

loader.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs" } })

interface Tab {
  path: string
  label: string
  model: Monaco.editor.ITextModel
  viewState: Monaco.editor.ICodeEditorViewState | null
  dirty: boolean
  version: number
}

interface GitGutter {
  added: [number, number][]
  modified: [number, number][]
  deleted: number[]
}

interface Props {
  filePath: string | null
  projectPath: string
  onCursorChange?: (line: number, col: number) => void
  onLanguageChange?: (lang: string) => void
  onDiagnosticsChange?: (markers: Monaco.editor.IMarkerData[]) => void
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  swift: "swift", py: "python", rs: "rust", go: "go", java: "java",
  c: "c", cpp: "cpp", cs: "csharp", json: "json", yaml: "yaml", yml: "yaml",
  md: "markdown", html: "html", css: "css", scss: "scss", sh: "shell",
  toml: "toml", sql: "sql", rb: "ruby", php: "php", kt: "kotlin", xml: "xml",
  svelte: "html", vue: "html",
}

let monaco: typeof Monaco
let editor: Monaco.editor.IStandaloneCodeEditor
const tabs = new Map<string, Tab>()
let activeTabPath: string | null = null

// LSP clients indexed by language
const lspClients = new Map<string, LspClient>()
const providerDisposables: Monaco.IDisposable[] = []

export default function EditorPane(props: Props) {
  let container!: HTMLDivElement
  const [openTabs, setOpenTabs] = createSignal<Tab[]>([])
  const [activeTab, setActiveTab] = createSignal<string | null>(null)
  const [cursorPos, setCursorPos] = createSignal({ line: 1, col: 1 })
  const [language, setLanguage] = createSignal("")
  const [lspStatus, setLspStatus] = createSignal<"off"|"starting"|"ready"|"error">("off")
  const [diagnostics, setDiagnostics] = createSignal<Monaco.editor.IMarkerData[]>([])
  const [gutterDecorations, setGutterDecorations] = createSignal<Monaco.editor.IEditorDecorationsCollection | null>(null)
  let saveTimer: ReturnType<typeof setTimeout>

  onMount(async () => {
    monaco = await loader.init()
    setupMonaco()
    editor = createEditor()
    setupEditorEvents()
    setupCommands()
  })

  function setupMonaco() {
    // Glass theme
    monaco.editor.defineTheme("oc-dark", {
      base: "vs-dark", inherit: true,
      rules: [
        { token: "comment",  foreground: "6A9955", fontStyle: "italic" },
        { token: "keyword",  foreground: "569CD6", fontStyle: "bold" },
        { token: "string",   foreground: "CE9178" },
        { token: "number",   foreground: "B5CEA8" },
        { token: "type",     foreground: "4EC9B0" },
        { token: "function", foreground: "DCDCAA" },
        { token: "variable", foreground: "9CDCFE" },
        { token: "constant", foreground: "4FC1FF" },
        { token: "decorator",foreground: "C586C0" },
        { token: "regexp",   foreground: "D16969" },
      ],
      colors: {
        "editor.background":              "#00000000",
        "editor.foreground":              "#D4D4D4",
        "editor.lineHighlightBackground": "#FFFFFF09",
        "editor.selectionBackground":     "#264F78AA",
        "editor.inactiveSelectionBackground": "#3A3D4166",
        "editorLineNumber.foreground":    "#FFFFFF22",
        "editorLineNumber.activeForeground": "#FFFFFF55",
        "editorCursor.foreground":        "#AEAFAD",
        "editorIndentGuide.background1":  "#FFFFFF10",
        "editorIndentGuide.activeBackground1": "#FFFFFF25",
        "editorBracketMatch.background":  "#0064001A",
        "editorBracketMatch.border":      "#888888",
        "scrollbarSlider.background":     "#FFFFFF10",
        "scrollbarSlider.hoverBackground":"#FFFFFF1A",
        "scrollbarSlider.activeBackground":"#FFFFFF25",
        "scrollbar.shadow":               "#00000000",
        "editorGutter.background":        "#00000000",
        // Git gutter colors
        "editorGutter.addedBackground":   "#3fb95088",
        "editorGutter.modifiedBackground":"#c2a20088",
        "editorGutter.deletedBackground": "#c2303088",
        // Suggest widget
        "editorSuggestWidget.background": "#1c1c24ee",
        "editorSuggestWidget.border":     "#3a3a4a",
        "editorSuggestWidget.selectedBackground": "#264F7855",
        // Hover
        "editorHoverWidget.background":   "#1c1c24ee",
        "editorHoverWidget.border":       "#3a3a4a",
      },
    })

    // TypeScript compiler options for better IntelliSense
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.languages.typescript.JsxEmit.Preserve,
      strict: true,
      noEmit: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      experimentalDecorators: true,
      lib: ["ESNext", "DOM", "DOM.Iterable"],
    })

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    })

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      checkJs: true,
      allowJs: true,
    })
  }

  function createEditor(): Monaco.editor.IStandaloneCodeEditor {
    return monaco.editor.create(container, {
      theme: "oc-dark",
      automaticLayout: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "SF Mono", Monaco, Consolas, monospace',
      fontLigatures: true,
      lineHeight: 22,
      letterSpacing: 0.2,
      // Minimap
      minimap: { enabled: true, scale: 1, renderCharacters: false, maxColumn: 120 },
      // Scroll
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      fastScrollSensitivity: 5,
      // Cursor
      cursorBlinking: "phase",
      cursorSmoothCaretAnimation: "on",
      cursorStyle: "line",
      multiCursorModifier: "alt",
      // Rendering
      renderLineHighlight: "all",
      renderWhitespace: "selection",
      roundedSelection: true,
      padding: { top: 12, bottom: 12 },
      // Intellisense
      suggest: { showIcons: true, insertMode: "replace", filterGraceful: true, showKeywords: true },
      quickSuggestions: { other: true, comments: false, strings: false },
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: "smart",
      tabCompletion: "on",
      // Code intelligence
      parameterHints: { enabled: true, cycle: true },
      inlayHints: { enabled: "offUnlessPressed" },
      codeLens: true,
      // Formatting
      formatOnType: false,
      formatOnPaste: true,
      autoIndent: "full",
      // Brackets
      bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
      guides: { bracketPairs: true, indentation: true, highlightActiveIndentation: true },
      matchBrackets: "always",
      // Folding
      folding: true,
      foldingHighlight: true,
      showFoldingControls: "mouseover",
      // Gutter
      glyphMargin: true,
      lineNumbers: "on",
      lineNumbersMinChars: 4,
      lineDecorationsWidth: 8,
      // Sticky scroll (breadcrumbs)
      stickyScroll: { enabled: true, maxLineCount: 5 },
      // Scrollbar
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
      // Word wrap
      wordWrap: "off",
      wrappingIndent: "indent",
      // Diff (used for inline git decorations)
      showDeprecated: true,
      "semanticHighlighting.enabled": true,
    })
  }

  function setupEditorEvents() {
    // Cursor position
    editor.onDidChangeCursorPosition((e) => {
      setCursorPos({ line: e.position.lineNumber, col: e.position.column })
      props.onCursorChange?.(e.position.lineNumber, e.position.column)
    })

    // Track dirty state and notify LSP of changes
    editor.onDidChangeModelContent(() => {
      const path = activeTabPath
      if (!path) return
      const tab = tabs.get(path)
      if (!tab) return
      tab.dirty = true
      tab.version++
      setOpenTabs(prev => prev.map(t => t.path === path ? { ...t, dirty: true } : t))

      // Notify LSP
      const lang = tab.model.getLanguageId()
      const client = lspClients.get(lang)
      if (client?.ready) {
        client.didChange(`file://${path}`, tab.version, tab.model.getValue())
      }

      // Auto-save after 800ms idle
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => saveFile(path), 800)
    })

    // Update diagnostics in status bar when markers change
    monaco.editor.onDidChangeMarkers((uris: readonly Monaco.Uri[]) => {
      const path = activeTabPath
      if (!path) return
      const uri = monaco.Uri.parse("file://" + path)
      if (uris.some((u: Monaco.Uri) => u.toString() === uri.toString())) {
        const markers = monaco.editor.getModelMarkers({ resource: uri })
        setDiagnostics(markers)
        props.onDiagnosticsChange?.(markers)
      }
    })

    // Language change
    editor.onDidChangeModel(() => {
      const lang = editor.getModel()?.getLanguageId() ?? ""
      setLanguage(lang)
      props.onLanguageChange?.(lang)
    })
  }

  function setupCommands() {
    // Format: ⌘⇧F (mac) / Ctrl+Shift+I
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, async () => {
      const path = activeTabPath
      if (!path) return
      const lang = editor.getModel()?.getLanguageId() ?? ""
      // Try LSP format first
      const client = lspClients.get(lang)
      if (client?.ready) {
        try {
          const edits = await client.formatting(`file://${path}`)
          if (edits?.length) {
            applyTextEdits(edits)
            return
          }
        } catch {}
      }
      // Fallback to Monaco built-in
      editor.getAction("editor.action.formatDocument")?.run()
    })

    // Save: ⌘S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = activeTabPath
      if (path) saveFile(path)
    })

    // Go to definition: F12 (built-in) — already handled by Monaco / LSP providers

    // Close tab: ⌘W
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
      if (activeTabPath) closeTab(activeTabPath)
    })

    // Next/prev tab: Ctrl+Tab / Ctrl+Shift+Tab
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Tab, cycleTab(1))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Tab, cycleTab(-1))
  }

  function cycleTab(dir: 1 | -1) {
    return () => {
      const all = [...tabs.keys()]
      if (all.length < 2) return
      const idx = all.indexOf(activeTabPath ?? "")
      const next = all[(idx + dir + all.length) % all.length]
      switchTab(next)
    }
  }

  async function saveFile(path: string) {
    const tab = tabs.get(path)
    if (!tab) return
    const content = tab.model.getValue()
    await invoke("write_file", { path, content }).catch(() => {})
    tab.dirty = false
    setOpenTabs(prev => prev.map(t => t.path === path ? { ...t, dirty: false } : t))

    // Notify LSP of save
    const lang = tab.model.getLanguageId()
    const client = lspClients.get(lang)
    if (client?.ready) client.didSave(`file://${path}`, content)
  }

  function applyTextEdits(edits: any[]) {
    const model = editor.getModel()
    if (!model) return
    const ops = edits.map((e: any) => ({
      range: {
        startLineNumber: e.range.start.line + 1,
        startColumn: e.range.start.character + 1,
        endLineNumber: e.range.end.line + 1,
        endColumn: e.range.end.character + 1,
      },
      text: e.newText,
    }))
    model.applyEdits(ops)
  }

  // Open file effect
  createEffect(async () => {
    const path = props.filePath
    if (!path || !editor) return

    if (tabs.has(path)) {
      switchTab(path)
      return
    }

    const content = await invoke<string>("read_file", { path }).catch(() => "")
    const ext = path.split(".").pop()?.toLowerCase() ?? ""
    const lang = EXT_LANG[ext] ?? "plaintext"
    const label = path.split("/").pop() ?? path

    const uri = monaco.Uri.parse("file://" + path)
    let model = monaco.editor.getModel(uri)
    if (!model) model = monaco.editor.createModel(content, lang, uri)

    const tab: Tab = { path, label, model, viewState: null, dirty: false, version: 1 }
    tabs.set(path, tab)
    setOpenTabs(prev => [...prev, tab])

    switchTab(path)
    startLspForLanguage(lang, path)
  })

  // Git gutter effect — refresh when active file changes
  createEffect(async () => {
    const path = activeTab()
    if (!path || !editor) return
    refreshGitGutter()
  })

  // Refresh git gutter when projectPath changes
  createEffect(() => {
    const _p = props.projectPath
    refreshGitGutter()
  })

  async function refreshGitGutter() {
    const path = activeTabPath
    if (!path || !props.projectPath) return

    try {
      const diffs = await invoke<{ path: string; added: [number,number][]; modified: [number,number][]; deleted: number[] }[]>(
        "git_diff", { cwd: props.projectPath }
      )
      const relPath = path.startsWith(props.projectPath)
        ? path.slice(props.projectPath.length + 1)
        : path
      const fileDiff = diffs.find(d => d.path === relPath || d.path === path)

      const old = gutterDecorations()
      old?.clear()

      if (!fileDiff) { setGutterDecorations(null); return }

      const decorations: Monaco.editor.IModelDeltaDecoration[] = []

      const mkRange = (start: number, end: number): Monaco.IRange => ({
        startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: 1,
      })

      for (const [s, e] of fileDiff.added) {
        decorations.push({
          range: mkRange(s, e),
          options: {
            isWholeLine: false,
            linesDecorationsClassName: "gutter-added",
            overviewRuler: { color: "#3fb950", position: monaco.editor.OverviewRulerLane.Left },
          },
        })
      }
      for (const [s, e] of fileDiff.modified) {
        decorations.push({
          range: mkRange(s, e),
          options: {
            isWholeLine: false,
            linesDecorationsClassName: "gutter-modified",
            overviewRuler: { color: "#c2a200", position: monaco.editor.OverviewRulerLane.Left },
          },
        })
      }
      for (const ln of fileDiff.deleted) {
        decorations.push({
          range: mkRange(ln, ln),
          options: {
            isWholeLine: false,
            linesDecorationsClassName: "gutter-deleted",
            overviewRuler: { color: "#c23030", position: monaco.editor.OverviewRulerLane.Left },
          },
        })
      }

      const coll = editor.createDecorationsCollection(decorations)
      setGutterDecorations(coll)
    } catch { /* git not available */ }
  }

  function switchTab(path: string) {
    if (!editor) return
    // Save current view state
    if (activeTabPath && tabs.has(activeTabPath)) {
      tabs.get(activeTabPath)!.viewState = editor.saveViewState()
    }
    activeTabPath = path
    setActiveTab(path)
    const tab = tabs.get(path)!
    editor.setModel(tab.model)
    if (tab.viewState) editor.restoreViewState(tab.viewState)
    editor.focus()
    setLanguage(tab.model.getLanguageId())
    props.onLanguageChange?.(tab.model.getLanguageId())
    // Update diagnostics for this file
    const uri = monaco.Uri.parse("file://" + path)
    setDiagnostics(monaco.editor.getModelMarkers({ resource: uri }))
  }

  function closeTab(path: string) {
    tabs.get(path)?.model  // keep model alive in monaco registry
    tabs.delete(path)
    setOpenTabs(prev => prev.filter(t => t.path !== path))
    if (activeTabPath === path) {
      const remaining = [...tabs.keys()]
      if (remaining.length > 0) switchTab(remaining[remaining.length - 1])
      else { editor.setModel(null); activeTabPath = null; setActiveTab(null) }
    }
  }

  async function startLspForLanguage(lang: string, filePath: string) {
    if (!needsExternalLsp(lang)) { setLspStatus("off"); return }
    if (lspClients.has(lang)) {
      const client = lspClients.get(lang)!
      if (client.ready) {
        setLspStatus("ready")
        // Open document in existing client
        client.didOpen(`file://${filePath}`, lang, 1, tabs.get(filePath)?.model.getValue() ?? "")
      }
      return
    }

    setLspStatus("starting")
    const client = new LspClient(lang, (uri, markers) => {
      // Apply markers to Monaco model
      const monacoUri = monaco.Uri.parse(uri)
      monaco.editor.setModelMarkers(monaco.editor.getModel(monacoUri) ?? editor.getModel()!, lang, markers)
    })
    lspClients.set(lang, client)

    // Register Monaco providers for this language (once)
    const disposables = registerLspProviders(monaco, client, lang)
    providerDisposables.push(...disposables)

    try {
      await client.start(props.projectPath)
      setLspStatus("ready")
      // Open the initial file
      const tab = tabs.get(filePath)
      if (tab) {
        client.didOpen(`file://${filePath}`, lang, tab.version, tab.model.getValue())
      }
    } catch (e) {
      setLspStatus("error")
      console.warn("LSP start failed:", e)
    }
  }

  onCleanup(() => {
    clearTimeout(saveTimer)
    lspClients.forEach(c => c.dispose())
    lspClients.clear()
    providerDisposables.forEach(d => d.dispose())
    editor?.dispose()
  })

  // Expose jumpTo for external callers (search panel)
  ;(window as any).__editorJumpTo = (path: string, line: number, col: number) => {
    if (!tabs.has(path)) {
      // Will be opened by the filePath effect; then jump
      const interval = setInterval(() => {
        if (tabs.has(path) && activeTabPath === path) {
          clearInterval(interval)
          editor.revealLineInCenter(line)
          editor.setPosition({ lineNumber: line, column: col })
          editor.focus()
        }
      }, 50)
    } else {
      switchTab(path)
      editor.revealLineInCenter(line)
      editor.setPosition({ lineNumber: line, column: col })
      editor.focus()
    }
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", overflow: "hidden" }}>
      {/* Tab bar */}
      <div
        style={{
          display: "flex", "align-items": "center", "overflow-x": "auto",
          "border-bottom": "1px solid rgba(255,255,255,0.07)",
          background: "rgba(0,0,0,0.2)", "flex-shrink": 0, height: "35px",
          "scrollbar-width": "none",
        }}
      >
        <For each={openTabs()}>
          {(tab) => {
            const isActive = () => activeTab() === tab.path
            return (
              <div
                style={{
                  display: "flex", "align-items": "center", gap: "5px",
                  padding: "0 12px", height: "100%", cursor: "pointer",
                  "white-space": "nowrap", "flex-shrink": 0,
                  background: isActive() ? "rgba(255,255,255,0.07)" : "transparent",
                  "border-bottom": `2px solid ${isActive() ? "#569cd6" : "transparent"}`,
                  color: isActive() ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)",
                  "font-size": "12px", transition: "background 0.1s, color 0.1s",
                }}
                onClick={() => switchTab(tab.path)}
                onAuxClick={(e) => { if (e.button === 1) closeTab(tab.path) }}
              >
                <span>{tab.label}</span>
                <Show when={tab.dirty}>
                  <span style={{ color: "#569cd6", "font-size": "16px", "line-height": 1, "margin-top": "-2px" }}>●</span>
                </Show>
                <button
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.path) }}
                  style={{
                    background: "transparent", border: "none", color: "rgba(255,255,255,0.3)",
                    cursor: "pointer", "font-size": "12px", padding: "0 2px",
                    "border-radius": "3px", "line-height": 1,
                    display: isActive() ? "block" : "none",
                  }}
                >✕</button>
              </div>
            )
          }}
        </For>
        <Show when={openTabs().length === 0}>
          <div style={{ padding: "0 12px", color: "rgba(255,255,255,0.2)", "font-size": "12px", "align-self": "center" }}>
            No file open
          </div>
        </Show>
      </div>

      {/* Monaco container */}
      <div
        ref={container}
        style={{ flex: 1, "min-height": 0, position: "relative", background: "rgba(14,14,18,0.5)" }}
      />

      {/* Status bar */}
      <StatusBar
        filePath={activeTab()}
        line={cursorPos().line}
        col={cursorPos().col}
        language={language()}
        lspStatus={lspStatus()}
        diagnostics={diagnostics()}
        onClickDiagnostics={() => {}} // wired by App
        onClickLanguage={() => {}}
        indentSize={editor?.getModel()?.getOptions().tabSize ?? 2}
        encoding="UTF-8"
      />

      <style>{`
        .gutter-added    { border-left: 3px solid #3fb950; margin-left: 3px; }
        .gutter-modified { border-left: 3px solid #c2a200; margin-left: 3px; }
        .gutter-deleted  { border-left: 3px solid #c23030; margin-left: 3px; }
      `}</style>
    </div>
  )
}
