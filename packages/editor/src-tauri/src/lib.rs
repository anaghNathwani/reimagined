mod lsp;
mod search;
mod terminal;

use lsp::LspManager;
use search::{FileDiff, SearchMatch};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use terminal::TerminalManager;

struct AppState {
    terminal: Mutex<TerminalManager>,
    lsp: Mutex<LspManager>,
}

// ── Terminal ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn terminal_spawn(id: String, cwd: String, cols: u16, rows: u16, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    state.terminal.lock().unwrap().spawn(&id, &cwd, cols, rows, app)
}

#[tauri::command]
fn terminal_write(id: String, data: String, state: State<AppState>) -> Result<(), String> {
    state.terminal.lock().unwrap().write(&id, &data)
}

#[tauri::command]
fn terminal_resize(id: String, cols: u16, rows: u16, state: State<AppState>) -> Result<(), String> {
    state.terminal.lock().unwrap().resize(&id, cols, rows)
}

#[tauri::command]
fn terminal_kill(id: String, state: State<AppState>) {
    state.terminal.lock().unwrap().kill(&id)
}

#[tauri::command]
fn new_session_id() -> String {
    terminal::new_session_id()
}

// ── LSP ──────────────────────────────────────────────────────────────────────

#[tauri::command]
fn lsp_start(language: String, root_path: String, state: State<AppState>, app: AppHandle) -> Result<bool, String> {
    state.lsp.lock().unwrap().start(&language, &root_path, app)
}

#[tauri::command]
fn lsp_send(language: String, message: Value, state: State<AppState>) -> Result<(), String> {
    state.lsp.lock().unwrap().send(&language, message)
}

#[tauri::command]
fn lsp_stop(language: String, state: State<AppState>) {
    state.lsp.lock().unwrap().stop(&language)
}

#[tauri::command]
fn lsp_running(state: State<AppState>) -> Vec<String> {
    state.lsp.lock().unwrap().running()
}

// ── Search ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn search_text(
    query: String,
    cwd: String,
    case_sensitive: bool,
    whole_word: bool,
    use_regex: bool,
) -> Result<Vec<SearchMatch>, String> {
    search::search_text(&query, &cwd, case_sensitive, whole_word, use_regex)
}

#[tauri::command]
fn find_files(cwd: String, pattern: String) -> Result<Vec<String>, String> {
    search::find_files(&cwd, &pattern)
}

#[tauri::command]
fn git_diff(cwd: String) -> Result<Vec<FileDiff>, String> {
    search::git_diff(&cwd)
}

// ── Shell exec ───────────────────────────────────────────────────────────────

#[tauri::command]
fn shell_exec(cmd: String, cwd: String) -> Result<String, String> {
    let output = std::process::Command::new("/bin/zsh")
        .args(["-l", "-c", &cmd])
        .current_dir(&cwd)
        .env("TERM", "xterm-256color")
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = [stdout.as_ref(), stderr.as_ref()]
        .iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join("\n");
    Ok(if combined.is_empty() { "(no output)".into() } else { combined })
}

// ── File I/O ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for entry in entries.flatten() {
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && !matches!(name.as_str(), ".env" | ".env.local" | ".eslintrc") {
            continue;
        }
        result.push(DirEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
        });
    }
    result.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(result)
}

#[derive(serde::Serialize)]
struct DirEntry { name: String, path: String, is_dir: bool }

// ── App entry ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            terminal: Mutex::new(TerminalManager::new()),
            lsp: Mutex::new(LspManager::new()),
        })
        .invoke_handler(tauri::generate_handler![
            terminal_spawn, terminal_write, terminal_resize, terminal_kill, new_session_id,
            lsp_start, lsp_send, lsp_stop, lsp_running,
            search_text, find_files, git_diff,
            shell_exec,
            read_file, write_file, list_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error running OC Editor");
}
