import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type * as Monaco from "monaco-editor"

type Disposable = { dispose(): void }

interface LspMessage {
  language: string
  message: any
}

type Notification = (params: any) => void

export class LspClient {
  private nextId = 1
  private pending = new Map<number, { resolve: (r: any) => void; reject: (e: any) => void }>()
  private notifications = new Map<string, Notification[]>()
  private unlisten?: UnlistenFn
  public ready = false
  public diagnostics = new Map<string, Monaco.editor.IMarkerData[]>() // uri → markers

  constructor(
    public readonly language: string,
    private readonly onDiagnostics?: (uri: string, markers: Monaco.editor.IMarkerData[]) => void,
  ) {}

  async start(rootPath: string): Promise<void> {
    this.unlisten = await listen<LspMessage>("lsp-message", (event) => {
      if (event.payload.language === this.language) {
        this.handleMessage(event.payload.message)
      }
    })

    const started = await invoke<boolean>("lsp_start", { language: this.language, rootPath })
    if (!started) {
      // Already running — just mark ready
      this.ready = true
      return
    }
    // Wait for initialize response
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("LSP init timeout")), 10_000)
      this.once("initialize", () => { clearTimeout(timeout); resolve() })
    })
  }

  private once(method: string, cb: () => void) {
    const handlers = this.notifications.get(method) ?? []
    const wrapper = (params: any) => {
      cb()
      const list = this.notifications.get(method) ?? []
      this.notifications.set(method, list.filter(h => h !== wrapper))
    }
    handlers.push(wrapper)
    this.notifications.set(method, handlers)
  }

  private handleMessage(msg: any) {
    if (msg.id != null) {
      const pending = this.pending.get(msg.id)
      if (pending) {
        this.pending.delete(msg.id)
        if (msg.error) pending.reject(msg.error)
        else pending.resolve(msg.result)

        // First response (id=0) is initialize result
        if (msg.id === 0) {
          this.sendNotification("initialized", {})
          this.ready = true
          this.notifications.get("initialize")?.forEach(fn => fn(msg.result))
        }
      }
    } else if (msg.method) {
      // Notification from server
      const handlers = this.notifications.get(msg.method)
      if (handlers) handlers.forEach(fn => fn(msg.params))

      if (msg.method === "textDocument/publishDiagnostics") {
        this.handleDiagnostics(msg.params)
      }
    }
  }

  private handleDiagnostics(params: { uri: string; diagnostics: any[] }) {
    const markers: Monaco.editor.IMarkerData[] = params.diagnostics.map(d => ({
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      message: d.message,
      severity: lspSeverityToMonaco(d.severity),
      source: d.source ?? this.language,
      code: d.code?.toString(),
    }))
    this.diagnostics.set(params.uri, markers)
    this.onDiagnostics?.(params.uri, markers)
  }

  request(method: string, params: any): Promise<any> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      invoke("lsp_send", {
        language: this.language,
        message: { jsonrpc: "2.0", id, method, params },
      }).catch(reject)
    })
  }

  sendNotification(method: string, params: any): void {
    invoke("lsp_send", {
      language: this.language,
      message: { jsonrpc: "2.0", method, params },
    }).catch(() => {})
  }

  // ── Document sync ────────────────────────────────────────────────────────

  didOpen(uri: string, languageId: string, version: number, text: string) {
    this.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId, version, text },
    })
  }

  didChange(uri: string, version: number, text: string) {
    this.sendNotification("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    })
  }

  didSave(uri: string, text: string) {
    this.sendNotification("textDocument/didSave", {
      textDocument: { uri },
      text,
    })
  }

  didClose(uri: string) {
    this.sendNotification("textDocument/didClose", { textDocument: { uri } })
  }

  // ── LSP requests ─────────────────────────────────────────────────────────

  async completion(uri: string, line: number, character: number): Promise<any> {
    return this.request("textDocument/completion", {
      textDocument: { uri },
      position: { line, character },
      context: { triggerKind: 1 },
    })
  }

  async hover(uri: string, line: number, character: number): Promise<any> {
    return this.request("textDocument/hover", {
      textDocument: { uri },
      position: { line, character },
    })
  }

  async definition(uri: string, line: number, character: number): Promise<any> {
    return this.request("textDocument/definition", {
      textDocument: { uri },
      position: { line, character },
    })
  }

  async references(uri: string, line: number, character: number): Promise<any> {
    return this.request("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    })
  }

  async documentSymbols(uri: string): Promise<any> {
    return this.request("textDocument/documentSymbol", { textDocument: { uri } })
  }

  async formatting(uri: string): Promise<any> {
    return this.request("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true, trimTrailingWhitespace: true },
    })
  }

  dispose() {
    this.unlisten?.()
    invoke("lsp_stop", { language: this.language }).catch(() => {})
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function lspSeverityToMonaco(s?: number): Monaco.MarkerSeverity {
  // LSP: 1=Error, 2=Warning, 3=Information, 4=Hint
  // Monaco: Error=8, Warning=4, Info=2, Hint=1
  switch (s) {
    case 1: return 8   // Error
    case 2: return 4   // Warning
    case 3: return 2   // Info
    default: return 1  // Hint
  }
}

/** Map file extension to LSP language id */
export function extToLanguage(ext: string): string | null {
  const map: Record<string, string> = {
    rs: "rust", py: "python", go: "go",
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  }
  return map[ext.toLowerCase()] ?? null
}

/** Language ids that have external LSP servers (not Monaco's built-in TS service) */
export function needsExternalLsp(lang: string): boolean {
  return !["typescript", "javascript"].includes(lang)
}
