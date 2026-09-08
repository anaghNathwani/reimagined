use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct LspMessage {
    pub language: String,
    pub message: Value,
}

struct Server {
    stdin: ChildStdin,
    _child: Child,
}

pub struct LspManager {
    servers: Arc<Mutex<HashMap<String, Server>>>,
}

impl LspManager {
    pub fn new() -> Self {
        Self { servers: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// Spawn a language server for `language`. Returns true if started, false if already running.
    pub fn start(&self, language: &str, root_uri: &str, app: AppHandle) -> Result<bool, String> {
        {
            if self.servers.lock().unwrap().contains_key(language) {
                return Ok(false);
            }
        }

        let (exe, args) = server_command(language).ok_or_else(|| format!("No LSP for {language}"))?;

        let mut child = Command::new(&exe)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn {exe}: {e}"))?;

        let stdout = child.stdout.take().unwrap();
        let stdin = child.stdin.take().unwrap();
        let lang = language.to_string();
        let servers = self.servers.clone();

        // Background reader thread — parses Content-Length framed JSON-RPC
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                // Read Content-Length header
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                let line = line.trim();
                if !line.starts_with("Content-Length:") {
                    continue;
                }
                let len: usize = line["Content-Length:".len()..].trim().parse().unwrap_or(0);
                if len == 0 {
                    continue;
                }

                // Skip blank line separator
                let mut blank = String::new();
                if reader.read_line(&mut blank).unwrap_or(0) == 0 {
                    break;
                }

                // Read exactly `len` bytes of JSON
                let mut buf = vec![0u8; len];
                let mut total = 0;
                while total < len {
                    match std::io::Read::read(&mut reader, &mut buf[total..]) {
                        Ok(0) => break,
                        Ok(n) => total += n,
                        Err(_) => break,
                    }
                }
                if total < len {
                    break;
                }

                let Ok(msg) = serde_json::from_slice::<Value>(&buf) else { continue };
                let _ = app.emit("lsp-message", LspMessage { language: lang.clone(), message: msg });
            }
            // Clean up when server exits
            servers.lock().unwrap().remove(&lang);
        });

        self.servers.lock().unwrap().insert(
            language.to_string(),
            Server { stdin, _child: child },
        );

        // Send initialize
        let root = root_uri.to_string();
        self.send_raw(
            language,
            &serde_json::json!({
                "jsonrpc": "2.0",
                "id": 0,
                "method": "initialize",
                "params": {
                    "processId": std::process::id(),
                    "rootUri": format!("file://{root}"),
                    "workspaceFolders": [{"uri": format!("file://{root}"), "name": "workspace"}],
                    "capabilities": {
                        "textDocument": {
                            "synchronization": {"dynamicRegistration": false, "didSave": true},
                            "completion": {
                                "completionItem": {
                                    "snippetSupport": true,
                                    "documentationFormat": ["markdown", "plaintext"],
                                    "resolveSupport": {"properties": ["documentation","detail","additionalTextEdits"]}
                                }
                            },
                            "hover": {"contentFormat": ["markdown", "plaintext"]},
                            "definition": {"linkSupport": false},
                            "references": {},
                            "documentSymbol": {"hierarchicalDocumentSymbolSupport": true},
                            "publishDiagnostics": {"relatedInformation": true}
                        },
                        "workspace": {"workspaceFolders": true}
                    }
                }
            }),
        )?;

        Ok(true)
    }

    pub fn send(&self, language: &str, message: Value) -> Result<(), String> {
        self.send_raw(language, &message)
    }

    fn send_raw(&self, language: &str, message: &Value) -> Result<(), String> {
        let json = serde_json::to_string(message).map_err(|e| e.to_string())?;
        let frame = format!("Content-Length: {}\r\n\r\n{}", json.len(), json);
        let mut servers = self.servers.lock().unwrap();
        let server = servers.get_mut(language).ok_or("LSP server not running")?;
        server.stdin.write_all(frame.as_bytes()).map_err(|e| e.to_string())?;
        server.stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn stop(&self, language: &str) {
        self.servers.lock().unwrap().remove(language);
    }

    pub fn running(&self) -> Vec<String> {
        self.servers.lock().unwrap().keys().cloned().collect()
    }
}

/// Map language id → (executable, args)
fn server_command(language: &str) -> Option<(String, Vec<String>)> {
    match language {
        "rust" => {
            // Try user's cargo bin, then PATH
            let candidates = [
                format!("{}/.cargo/bin/rust-analyzer", std::env::var("HOME").unwrap_or_default()),
                "rust-analyzer".into(),
            ];
            for c in &candidates {
                if std::path::Path::new(c).exists() || which(c) {
                    return Some((c.clone(), vec![]));
                }
            }
            None
        }
        "python" => {
            for cmd in &["pylsp", "pyright-langserver", "jedi-language-server"] {
                if which(cmd) {
                    let args = if *cmd == "pyright-langserver" {
                        vec!["--stdio".into()]
                    } else {
                        vec![]
                    };
                    return Some((cmd.to_string(), args));
                }
            }
            None
        }
        "go" => {
            if which("gopls") { Some(("gopls".into(), vec![])) } else { None }
        }
        "typescript" | "javascript" => {
            for cmd in &["typescript-language-server", "tsserver"] {
                if which(cmd) {
                    return Some((cmd.to_string(), vec!["--stdio".into()]));
                }
            }
            None
        }
        _ => None,
    }
}

fn which(cmd: &str) -> bool {
    // Fast PATH check
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':') {
            if std::path::Path::new(dir).join(cmd).exists() {
                return true;
            }
        }
    }
    false
}
