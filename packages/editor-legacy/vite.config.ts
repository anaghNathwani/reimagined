import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

const host = process.env.TAURI_DEV_HOST
const isElectron = process.env.ELECTRON_DEV === "true"

export default defineConfig({
  plugins: [solid()],
  clearScreen: false,
  server: {
    port: isElectron ? 4200 : 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  resolve: {
    alias: isElectron ? {
      "@tauri-apps/api/core": "/src/mocks/tauri-api.ts",
      "@tauri-apps/plugin-dialog": "/src/mocks/tauri-dialog.ts",
      "@tauri-apps/plugin-updater": "/src/mocks/tauri-updater.ts",
    } : {},
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
