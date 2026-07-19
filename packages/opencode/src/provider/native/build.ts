/**
 * build.ts — compile oc-quant.c against the libllama dylib shipped by node-llama-cpp.
 *
 * Called automatically from local.ts before first use.
 * Skips the build if the binary already exists and is up-to-date.
 */

import path from "path"
import fs from "fs/promises"
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(new URL(import.meta.url).pathname)

export const OC_QUANT_BIN = path.join(__dirname, "oc-quant")
const OC_QUANT_SRC = path.join(__dirname, "oc-quant.c")

/**
 * Locate the directory that contains libllama*.dylib (or libllama*.so on Linux).
 * node-llama-cpp ships platform-specific binaries under node_modules.
 */
async function findLlamaBinsDir(): Promise<string | undefined> {
  // Walk up from this file's directory to the repo root, then search node_modules.
  let dir = __dirname
  for (let i = 0; i < 10; i++) {
    const nm = path.join(dir, "node_modules", ".bun")
    try {
      await fs.access(nm)
      // Search for the dylib/so
      const candidates = await findFiles(nm, /libllama.*\.(dylib|so)$/, 6)
      if (candidates.length > 0) return path.dirname(candidates[0])
    } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

async function findFiles(root: string, pattern: RegExp, maxDepth: number): Promise<string[]> {
  const results: string[] = []
  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return
    let entries: import("fs").Dirent[]
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full, depth + 1)
      else if (pattern.test(e.name)) results.push(full)
    }
  }
  await walk(root, 0)
  return results
}

function detectLibName(dir: string, entries: string[]): { llama: string; ggml: string } | undefined {
  const llama = entries.find((e) => /libllama.*\.(dylib|so)$/.test(e))
  const ggml  = entries.find((e) => /libggml.*\.(dylib|so)$/.test(e))
  if (!llama) return undefined
  return {
    llama: path.basename(llama).replace(/^lib/, "").replace(/\.(dylib|so)$/, ""),
    ggml:  ggml ? path.basename(ggml).replace(/^lib/, "").replace(/\.(dylib|so)$/, "") : "",
  }
}

let buildPromise: Promise<void> | undefined

export async function ensureOcQuantBuilt(): Promise<void> {
  if (buildPromise) return buildPromise
  buildPromise = _build()
  buildPromise.catch(() => { buildPromise = undefined })
  return buildPromise
}

async function _build(): Promise<void> {
  // Already compiled and source hasn't changed
  try {
    const [binStat, srcStat] = await Promise.all([fs.stat(OC_QUANT_BIN), fs.stat(OC_QUANT_SRC)])
    if (binStat.mtimeMs >= srcStat.mtimeMs) return
  } catch {
    // binary doesn't exist yet — proceed with build
  }

  const binsDir = await findLlamaBinsDir()
  if (!binsDir) throw new Error("Could not locate node-llama-cpp native binaries directory")

  const entries = await fs.readdir(binsDir)
  const libs = detectLibName(binsDir, entries)
  if (!libs) throw new Error(`No libllama library found in ${binsDir}`)

  const compiler = process.platform === "win32" ? "cl" : "clang"
  const args: string[] = []

  if (process.platform === "win32") {
    // MSVC — not supported yet
    throw new Error("Windows build of oc-quant is not yet supported")
  } else {
    args.push(
      "-O3",
      "-march=native",   // use all CPU features (NEON on ARM, AVX2 on x86)
      "-o", OC_QUANT_BIN,
      OC_QUANT_SRC,
      `-L${binsDir}`,
      `-Wl,-rpath,${binsDir}`,
      `-l${libs.llama}`,
      "-lm",
      "-lpthread",
    )
    if (libs.ggml) args.push(`-l${libs.ggml}`)
  }

  await execFileAsync(compiler, args)
}
