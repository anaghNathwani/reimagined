import type * as Monaco from "monaco-editor"
import { LspClient } from "./client"

/**
 * Register Monaco providers (completion, hover, definition, references)
 * that delegate to an LspClient.
 */
export function registerLspProviders(
  monaco: typeof Monaco,
  client: LspClient,
  languageId: string,
): Monaco.IDisposable[] {
  const selector = { language: languageId }
  const disposables: Monaco.IDisposable[] = []

  // Completion
  disposables.push(
    monaco.languages.registerCompletionItemProvider(selector, {
      triggerCharacters: [".", ":", ">", "(", '"', "'", "/"],
      async provideCompletionItems(model: Monaco.editor.ITextModel, position: Monaco.Position) {
        if (!client.ready) return { suggestions: [] }
        try {
          const result = await client.completion(model.uri.toString(), position.lineNumber - 1, position.column - 1)
          if (!result) return { suggestions: [] }
          const items = Array.isArray(result) ? result : result.items ?? []
          return {
            suggestions: items.map((item: any) => lspCompletionToMonaco(monaco, item, model, position)),
          }
        } catch {
          return { suggestions: [] }
        }
      },
    }),
  )

  // Hover
  disposables.push(
    monaco.languages.registerHoverProvider(selector, {
      async provideHover(model: Monaco.editor.ITextModel, position: Monaco.Position) {
        if (!client.ready) return null
        try {
          const result = await client.hover(model.uri.toString(), position.lineNumber - 1, position.column - 1)
          if (!result?.contents) return null
          const contents = Array.isArray(result.contents)
            ? result.contents
            : [result.contents]
          return {
            contents: contents.map((c: any) => ({
              value: typeof c === "string" ? c : c.value ?? "",
            })),
            range: result.range ? lspRangeToMonaco(result.range) : undefined,
          }
        } catch {
          return null
        }
      },
    }),
  )

  // Go-to-Definition
  disposables.push(
    monaco.languages.registerDefinitionProvider(selector, {
      async provideDefinition(model: Monaco.editor.ITextModel, position: Monaco.Position) {
        if (!client.ready) return null
        try {
          const result = await client.definition(model.uri.toString(), position.lineNumber - 1, position.column - 1)
          if (!result) return null
          const locations = Array.isArray(result) ? result : [result]
          return locations.map((loc: any) => ({
            uri: monaco.Uri.parse(loc.uri ?? loc.targetUri),
            range: lspRangeToMonaco(loc.range ?? loc.targetRange),
          }))
        } catch {
          return null
        }
      },
    }),
  )

  // References
  disposables.push(
    monaco.languages.registerReferenceProvider(selector, {
      async provideReferences(model: Monaco.editor.ITextModel, position: Monaco.Position) {
        if (!client.ready) return null
        try {
          const result = await client.references(model.uri.toString(), position.lineNumber - 1, position.column - 1)
          if (!Array.isArray(result)) return null
          return result.map((loc: any) => ({
            uri: monaco.Uri.parse(loc.uri),
            range: lspRangeToMonaco(loc.range),
          }))
        } catch {
          return null
        }
      },
    }),
  )

  return disposables
}

// ── Conversion helpers ───────────────────────────────────────────────────────

function lspRangeToMonaco(r: any): Monaco.IRange {
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  }
}

function lspCompletionToMonaco(
  monaco: typeof Monaco,
  item: any,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): Monaco.languages.CompletionItem {
  const kind = lspCompletionKind(monaco, item.kind)
  const range = item.textEdit?.range
    ? lspRangeToMonaco(item.textEdit.range)
    : {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      }

  return {
    label: item.label,
    kind,
    detail: item.detail,
    documentation: item.documentation
      ? { value: typeof item.documentation === "string" ? item.documentation : item.documentation.value ?? "" }
      : undefined,
    insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
    insertTextRules: item.insertTextFormat === 2
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    range,
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect,
    tags: item.deprecated ? [1] : undefined,
  }
}

function lspCompletionKind(monaco: typeof Monaco, k?: number): Monaco.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind
  const map: Record<number, Monaco.languages.CompletionItemKind> = {
    1: K.Text, 2: K.Method, 3: K.Function, 4: K.Constructor,
    5: K.Field, 6: K.Variable, 7: K.Class, 8: K.Interface,
    9: K.Module, 10: K.Property, 11: K.Unit, 12: K.Value,
    13: K.Enum, 14: K.Keyword, 15: K.Snippet, 16: K.Color,
    17: K.File, 18: K.Reference, 19: K.Folder, 20: K.EnumMember,
    21: K.Constant, 22: K.Struct, 23: K.Event, 24: K.Operator,
    25: K.TypeParameter,
  }
  return map[k ?? 0] ?? K.Text
}
