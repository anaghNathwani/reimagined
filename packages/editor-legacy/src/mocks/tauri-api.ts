export async function invoke(cmd: string, args?: Record<string, unknown>): Promise<any> {
  console.warn(`[Electron] tauri invoke("${cmd}") not available — stub returned`)
  // Return sensible stubs per command so UI doesn't crash
  if (cmd === "list_dir") return []
  if (cmd === "read_file") return ""
  if (cmd === "find_files") return []
  if (cmd === "search_text") return []
  if (cmd === "git_diff") return { added: [], modified: [], deleted: [] }
  if (cmd === "check_update") return { available: false, version: null }
  if (cmd === "lsp_running") return false
  if (cmd === "shell_exec") return "(shell not available in Electron dev mode)"
  throw new Error(`${cmd} not available in Electron dev mode`)
}
