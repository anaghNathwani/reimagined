use base64::{engine::general_purpose::STANDARD as B64, Engine};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Serialize, Clone)]
pub struct TerminalOutput {
    pub id: String,
    pub data: String, // base64-encoded bytes
}

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    _child: Box<dyn Child + Send + Sync>,
}

type Sessions = Arc<Mutex<HashMap<String, Session>>>;

pub struct TerminalManager {
    sessions: Sessions,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self { sessions: Arc::new(Mutex::new(HashMap::new())) }
    }

    pub fn spawn(
        &self,
        id: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        app: AppHandle,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        cmd.arg("-i");
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("LANG", "en_US.UTF-8");

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);

        // Take the writer before handing master to the session
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        // Clone reader for background read loop
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let session_id = id.to_string();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let encoded = B64.encode(&buf[..n]);
                        let _ = app.emit(
                            "terminal-output",
                            TerminalOutput { id: session_id.clone(), data: encoded },
                        );
                    }
                }
            }
        });

        self.sessions.lock().unwrap().insert(
            id.to_string(),
            Session { writer, master: pair.master, _child: child },
        );

        Ok(())
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(id) {
            session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get(id) {
            session
                .master
                .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn kill(&self, id: &str) {
        self.sessions.lock().unwrap().remove(id);
    }
}

pub fn new_session_id() -> String {
    Uuid::new_v4().to_string()
}
