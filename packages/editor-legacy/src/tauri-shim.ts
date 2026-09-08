// Shim for running outside Tauri (e.g. Electron dev mode)
// Overrides @tauri-apps/api/core so invoke calls fail gracefully
;(window as any).__TAURI_INTERNALS__ = (window as any).__TAURI_INTERNALS__ ?? {}
;(window as any).__tauriShim = true
