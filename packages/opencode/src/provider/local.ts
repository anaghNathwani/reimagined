/**
 * Local open-weight inference provider using node-llama-cpp (https://github.com/withcatai/node-llama-cpp)
 *
 * Runs GGUF models directly in-process — no Ollama, no server, no cloud.
 * Models are downloaded from HuggingFace automatically on first use.
 *
 * Heavy models (F16 / BF16) are automatically compressed via oc-quant — a thin
 * C program that links against the libllama shared library shipped by
 * node-llama-cpp and calls llama_model_quantize() for maximum speed.
 */

import path from "path"
import fs from "fs/promises"
import { execFile } from "child_process"
import { promisify } from "util"
import os from "os"
import { Global } from "@reimagined-ai/core/global"
import type { LanguageModelV3, LanguageModelV3StreamPart, LanguageModelV3CallOptions } from "@ai-sdk/provider"
import { ensureOcQuantBuilt, OC_QUANT_BIN } from "./native/build.js"

const execFileAsync = promisify(execFile)

// ── Model catalog ──────────────────────────────────────────────────────────────

/** Stream-mode types are processed by oc-quant's own SIMD engine (fast, O(tensor) RAM).
 *  K-quant types delegate to llama_model_quantize for importance-matrix-aware scaling. */
export type QuantType =
  | "Q4_0"    // stream — fastest, ~2.1× smaller than F16, lowest quality
  | "Q8_0"    // stream — near-lossless, ~2× smaller than F16, very fast
  | "Q2_K"    // K-quant — smallest, most lossy
  | "Q3_K_M"  // K-quant
  | "Q4_K_M"  // K-quant — best quality/size tradeoff (default)
  | "Q5_K_M"  // K-quant
  | "Q6_K"    // K-quant — near-lossless K-quant

export interface LocalModelDef {
  id: string
  name: string
  repo: string      // HuggingFace repo id
  file: string      // filename inside the repo — for split GGUFs, the first shard
  contextK: number  // context window in thousands of tokens
  ramGb: number     // approximate RAM after quantization
  license: string
  source: string
  /**
   * If set, the downloaded file is full-precision (F16/BF16) and will be
   * automatically compressed to this quant type via oc-quant before first use.
   * ramGbRaw is the size on disk during the initial download.
   */
  compress?: QuantType
  ramGbRaw?: number
  /**
   * Minimum system RAM (GB) required to run this model at all.
   * Models with this field set are hidden from the catalog on machines that
   * don't meet the threshold — avoids offering impossible downloads.
   */
  minRamGb?: number
  /** Total parameter count in billions (informational). */
  paramsBillion?: number
}

export const LOCAL_MODELS: LocalModelDef[] = [
  // ── Lightweight models (pre-quantized GGUF from HuggingFace) ───────────────
  {
    // IQ3_M: ~3.0GB vs Q3_K_M: 3.56GB — importance-matrix quant, better quality/size ratio
    id: "qwen2.5-coder-7b",
    name: "Qwen 2.5 Coder 7B",
    repo: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    file: "qwen2.5-coder-7b-instruct-q3_k_m.gguf",
    contextK: 32,
    ramGb: 3.0,
    license: "Apache 2.0",
    source: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
  },
  {
    // IQ2_M: ~1.1GB vs IQ3_M: 1.6GB — smallest practical model
    id: "llama3.2-3b",
    name: "Llama 3.2 3B",
    repo: "bartowski/Llama-3.2-3B-Instruct-GGUF",
    file: "Llama-3.2-3B-Instruct-IQ2_M.gguf",
    contextK: 128,
    ramGb: 1.1,
    license: "Llama 3.2 Community",
    source: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF",
  },
  {
    // Q2_K: ~1.7GB vs Q3_K_L: 2.24GB — saves 540MB
    id: "phi4-mini",
    name: "Phi-4 Mini 3.8B",
    repo: "lmstudio-community/Phi-4-mini-instruct-GGUF",
    file: "Phi-4-mini-instruct-Q2_K.gguf",
    contextK: 16,
    ramGb: 1.7,
    license: "MIT",
    source: "https://huggingface.co/lmstudio-community/Phi-4-mini-instruct-GGUF",
  },
  {
    // Q2_K: ~1.6GB vs Q3_K_L: 2.23GB — saves 630MB
    id: "gemma3-4b",
    name: "Gemma 3 4B",
    repo: "lmstudio-community/gemma-3-4b-it-GGUF",
    file: "gemma-3-4b-it-Q2_K.gguf",
    contextK: 128,
    ramGb: 1.6,
    license: "Gemma ToU",
    source: "https://huggingface.co/lmstudio-community/gemma-3-4b-it-GGUF",
  },
  {
    // IQ3_M: ~3.0GB vs Q3_K_M: 3.28GB — importance-matrix quant
    id: "mistral-7b",
    name: "Mistral 7B v0.3",
    repo: "bartowski/Mistral-7B-Instruct-v0.3-GGUF",
    file: "Mistral-7B-Instruct-v0.3-IQ3_M.gguf",
    contextK: 32,
    ramGb: 3.0,
    license: "Apache 2.0",
    source: "https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF",
  },
  {
    // IQ3_M: ~3.0GB vs Q3_K_M: 3.56GB — saves 560MB
    id: "deepseek-r1-7b",
    name: "DeepSeek R1 7B",
    repo: "bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF",
    file: "DeepSeek-R1-Distill-Qwen-7B-IQ3_M.gguf",
    contextK: 128,
    ramGb: 3.0,
    license: "MIT",
    source: "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF",
  },
  {
    // IQ3_M: ~5.8GB vs Q3_K_M: 6.84GB — saves 1GB
    id: "deepseek-r1-14b",
    name: "DeepSeek R1 14B",
    repo: "bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF",
    file: "DeepSeek-R1-Distill-Qwen-14B-IQ3_M.gguf",
    contextK: 128,
    ramGb: 5.8,
    license: "MIT",
    source: "https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF",
  },
  {
    // IQ3_M: ~3.0GB vs Q3_K_M: 3.56GB — saves 560MB
    id: "qwen2.5-7b",
    name: "Qwen 2.5 7B",
    repo: "bartowski/Qwen2.5-7B-Instruct-GGUF",
    file: "Qwen2.5-7B-Instruct-IQ3_M.gguf",
    contextK: 32,
    ramGb: 3.0,
    license: "Apache 2.0",
    source: "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF",
  },

  // ── Heavy models — downloaded as F16, auto-compressed via oc-quant (C/llama.cpp) ──
  {
    // GLM-4-9B: strong bilingual (EN/ZH) model, long context.
    // Downloaded as F16 GGUF (~18 GB), compressed to Q4_K_M (~5.5 GB) on first use
    // by oc-quant (C/llama.cpp). Users with ≥16 GB RAM can skip compression.
    id: "glm4-9b",
    name: "GLM-4 9B",
    repo: "bartowski/glm-4-9b-chat-GGUF",
    file: "glm-4-9b-chat-F16.gguf",
    contextK: 128,
    ramGb: 5.5,
    ramGbRaw: 18,
    license: "GLM-4 Model License",
    source: "https://huggingface.co/bartowski/glm-4-9b-chat-GGUF",
    compress: "Q4_K_M",
  },
  {
    // Qwen2.5-14B: excellent mid-size model, strong at coding and reasoning.
    // Pre-quantized Q4_K_M GGUF available from bartowski.
    id: "qwen2.5-14b",
    name: "Qwen 2.5 14B",
    repo: "bartowski/Qwen2.5-14B-Instruct-GGUF",
    file: "Qwen2.5-14B-Instruct-Q4_K_M.gguf",
    contextK: 128,
    ramGb: 8.9,
    license: "Apache 2.0",
    source: "https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF",
  },
  {
    // Mistral-Small-22B: best open-weight 22B, strong at instruction following.
    // Pre-quantized Q4_K_M available.
    id: "mistral-small-22b",
    name: "Mistral Small 22B",
    repo: "bartowski/Mistral-Small-3.1-22B-Instruct-2503-GGUF",
    file: "Mistral-Small-3.1-22B-Instruct-2503-Q4_K_M.gguf",
    contextK: 128,
    ramGb: 13.5,
    license: "Apache 2.0",
    source: "https://huggingface.co/bartowski/Mistral-Small-3.1-22B-Instruct-2503-GGUF",
  },
  {
    // Phi-4 14B: Microsoft's strongest small model, excellent for reasoning.
    // Pre-quantized Q4_K_M GGUF from lmstudio-community.
    id: "phi4-14b",
    name: "Phi-4 14B",
    repo: "lmstudio-community/phi-4-GGUF",
    file: "phi-4-Q4_K_M.gguf",
    contextK: 16,
    ramGb: 8.5,
    license: "MIT",
    source: "https://huggingface.co/lmstudio-community/phi-4-GGUF",
  },

  // ── Frontier-scale model (server / high-RAM workstation only) ─────────────
  {
    // GLM-5.2: Z.ai's 744B MoE flagship (40B active params), 1M-token context.
    // UD-Q2_K_XL is the smallest practical quant (~200 GB, 7 shards).
    // Hidden on machines with <220 GB RAM via minRamGb guard.
    // oc-quant is NOT used here — unsloth ships pre-quantized Dynamic GGUFs
    // that are already heavily optimised (importance-matrix aware).
    id: "glm5.2",
    name: "GLM-5.2 (744B MoE)",
    repo: "unsloth/GLM-5.2-GGUF",
    file: "UD-Q2_K_XL/GLM-5.2-UD-Q2_K_XL-00001-of-00007.gguf",
    contextK: 1000,
    ramGb: 210,
    license: "GLM Model License",
    source: "https://huggingface.co/unsloth/GLM-5.2-GGUF",
    minRamGb: 220,
    paramsBillion: 744,
  },
]

// ── Catalog helpers ────────────────────────────────────────────────────────────

const systemRamGb = os.totalmem() / 1024 / 1024 / 1024

/**
 * Models available on this machine — filters out entries that exceed
 * available system RAM (via minRamGb).
 */
export const AVAILABLE_MODELS: LocalModelDef[] = LOCAL_MODELS.filter(
  (m) => m.minRamGb === undefined || systemRamGb >= m.minRamGb,
)

// ── Paths ──────────────────────────────────────────────────────────────────────

export function modelDir(def: LocalModelDef): string {
  return path.join(Global.Path.data, "local-models", def.id)
}

// Resolved paths are cached after the first successful download/scan.
const resolvedPaths = new Map<string, string>()
// Models confirmed absent at last check — cleared when a download completes.
const absentModels = new Set<string>()

export async function resolvedModelPath(def: LocalModelDef): Promise<string | undefined> {
  const cached = resolvedPaths.get(def.id)
  if (cached) return cached
  if (absentModels.has(def.id)) return undefined

  // Scan the model dir for any .gguf file.
  // Prefer the quantized output (contains the quant suffix) over the raw F16 file
  // so that a partially-completed compression doesn't accidentally load the huge source.
  const dir = modelDir(def)
  try {
    const entries = await fs.readdir(dir)
    const quantSuffix = def.compress ? `-${def.compress}.gguf` : null
    const gguf =
      (quantSuffix ? entries.find((e) => e.endsWith(quantSuffix)) : undefined) ??
      entries.find((e) => e.endsWith(".gguf") && !e.includes("-F16"))
    if (gguf) {
      const p = path.join(dir, gguf)
      resolvedPaths.set(def.id, p)
      absentModels.delete(def.id)
      return p
    }
  } catch {
    // dir doesn't exist yet
  }
  absentModels.add(def.id)
  return undefined
}

export async function isModelDownloaded(def: LocalModelDef): Promise<boolean> {
  return (await resolvedModelPath(def)) !== undefined
}

// ── Download ───────────────────────────────────────────────────────────────────

/** Alias kept for compatibility with provider.ts imports. */
export const modelPath = resolvedModelPath

// Track in-progress downloads so concurrent requests share one download.
const downloadPromises = new Map<string, Promise<void>>()

export async function downloadModel(
  def: LocalModelDef,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  const existing = downloadPromises.get(def.id)
  if (existing) return existing

  const promise = (async () => {
    const { createModelDownloader } = await import("node-llama-cpp")
    const dir = modelDir(def)
    await fs.mkdir(dir, { recursive: true })

    const downloader = await createModelDownloader({
      modelUri: `hf:${def.repo}/${def.file}`,
      dirPath: dir,
      onProgress: onProgress
        ? (status) => onProgress(status.downloadedSize, status.totalSize)
        : undefined,
    })

    await downloader.download()
    const downloaded = path.join(dir, downloader.entrypointFilename)

    // If the model needs local compression, run oc-quant (C/llama.cpp) now.
    if (def.compress) {
      const quantized = downloaded.replace(/\.gguf$/, `-${def.compress}.gguf`)
      await quantizeModel(downloaded, quantized, def.compress)
      // Remove the raw F16 file to reclaim disk space.
      await fs.unlink(downloaded).catch(() => {})
      resolvedPaths.set(def.id, quantized)
    } else {
      resolvedPaths.set(def.id, downloaded)
    }
    absentModels.delete(def.id)
  })()

  downloadPromises.set(def.id, promise)
  promise.finally(() => downloadPromises.delete(def.id))
  return promise
}

// ── Native quantization (C/llama.cpp via oc-quant) ────────────────────────────

export interface QuantizeResult {
  bytesIn: number
  bytesOut: number
  ratio: number
  elapsedSec: number
}

/**
 * Compress a GGUF file using the oc-quant native binary (C/llama.cpp).
 * - Writes atomically (tmp → rename) so an interrupted run leaves no partial file.
 * - Uses nCPU-1 threads by default; pass `threads` to override.
 * - Progress lines (stderr from oc-quant) are forwarded to `onProgress`.
 * - Returns a summary with before/after sizes and compression ratio.
 */
export async function quantizeModel(
  inputPath: string,
  outputPath: string,
  quantType: QuantType = "Q4_K_M",
  opts: { threads?: number; pure?: boolean; onProgress?: (line: string) => void } = {},
): Promise<QuantizeResult> {
  await ensureOcQuantBuilt()

  const args: string[] = []
  if (opts.threads != null) args.push("--threads", String(opts.threads))
  if (opts.pure)            args.push("--pure")
  args.push(inputPath, outputPath, quantType)

  return new Promise<QuantizeResult>((resolve, reject) => {
    const proc = execFile(OC_QUANT_BIN, args)
    let summaryLine = ""

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      // oc-quant emits one machine-readable line: "ok bytes_in=... bytes_out=... ratio=... elapsed=..."
      for (const line of text.split("\n")) {
        if (line.startsWith("ok ")) summaryLine = line
      }
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      if (opts.onProgress) {
        for (const line of text.split("\n")) {
          const trimmed = line.trim()
          if (trimmed) opts.onProgress(trimmed)
        }
      }
    })

    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`oc-quant exited with code ${code}`))
        return
      }
      // Parse summary: "ok bytes_in=N bytes_out=N ratio=N elapsed=N"
      const get = (key: string) => {
        const m = summaryLine.match(new RegExp(`${key}=([\\d.]+)`))
        return m ? parseFloat(m[1]) : 0
      }
      resolve({
        bytesIn:    get("bytes_in"),
        bytesOut:   get("bytes_out"),
        ratio:      get("ratio"),
        elapsedSec: get("elapsed"),
      })
    })
  })
}

/**
 * Re-quantize an already-downloaded model to a different (lower) bit depth.
 * Useful when the user wants to free RAM by further compressing a model.
 */
export async function recompressModel(
  def: LocalModelDef,
  targetQuant: QuantType,
  opts: { threads?: number; onProgress?: (line: string) => void } = {},
): Promise<QuantizeResult> {
  const current = await resolvedModelPath(def)
  if (!current) throw new Error(`Model "${def.name}" is not downloaded`)

  const out = path.join(modelDir(def), `${def.id}-${targetQuant}.gguf`)
  const result = await quantizeModel(current, out, targetQuant, { ...opts })

  if (current !== out) await fs.unlink(current).catch(() => {})
  resolvedPaths.set(def.id, out)
  absentModels.delete(def.id)
  return result
}

/**
 * Pick the best quantization level for the current machine's available RAM.
 * Called automatically before downloading a heavy model (compress: true).
 */
export function recommendedQuant(def: LocalModelDef): QuantType {
  const freeMb = os.freemem() / 1024 / 1024
  const freeGb = freeMb / 1024

  // If the user has plenty of RAM, prefer higher quality.
  if (freeGb >= def.ramGb * 1.5) return "Q5_K_M"
  if (freeGb >= def.ramGb)       return "Q4_K_M"
  if (freeGb >= def.ramGb * 0.8) return "Q3_K_M"
  return "Q2_K"
}

// ── Inference session cache ────────────────────────────────────────────────────

interface CachedModel {
  session: import("node-llama-cpp").LlamaChatSession
  model: import("node-llama-cpp").LlamaModel
  ctx: import("node-llama-cpp").LlamaContext
  modelDef: LocalModelDef
}

// Single shared llama instance — initializing llama.cpp is expensive (~100ms).
let llamaPromise: Promise<import("node-llama-cpp").Llama> | undefined

async function getLlamaOnce(): Promise<import("node-llama-cpp").Llama> {
  if (!llamaPromise) {
    llamaPromise = (async () => {
      const { getLlama, LlamaLogLevel } = await import("node-llama-cpp")
      return getLlama({ gpu: "auto", logLevel: LlamaLogLevel.error })
    })()
    llamaPromise.catch(() => { llamaPromise = undefined })
  }
  return llamaPromise
}

// Only one model is kept in RAM at a time — swapping evicts the previous model.
// Loading two 7B models simultaneously would need 6+ GB; this keeps peak usage
// at the weight size of whichever model is active.
let activeModel: CachedModel | undefined
let activeModelId: string | undefined

async function getSession(def: LocalModelDef): Promise<CachedModel> {
  if (activeModelId === def.id && activeModel) return activeModel

  // Evict the previous model before loading a new one.
  if (activeModel) {
    try { activeModel.ctx.dispose() } catch {}
    try { activeModel.model.dispose() } catch {}
    activeModel = undefined
    activeModelId = undefined
  }

  const { LlamaChatSession } = await import("node-llama-cpp")
  const llama = await getLlamaOnce()
  const mp = await resolvedModelPath(def)
  if (!mp) throw new Error(`Model "${def.name}" is not downloaded`)

  const model = await llama.loadModel({
    modelPath: mp,
    defaultContextFlashAttention: true,
    useMmap: true,
    useMlock: false,
  })
  const ctx = await model.createContext({
    contextSize: Math.min(def.contextK * 1000, 16384),
    flashAttention: true,
    swaFullCache: true,
    // Small batch — reduces peak RAM during prompt processing.
    batchSize: 256,
  })
  const session = new LlamaChatSession({ contextSequence: ctx.getSequence() })
  activeModel = { session, model, ctx, modelDef: def }
  activeModelId = def.id
  return activeModel
}

// ── Prompt helpers ─────────────────────────────────────────────────────────────


function extractPrompt(options: LanguageModelV3CallOptions): { system: string; prompt: string } {
  const systemMsg = options.prompt.find((m) => m.role === "system")
  let system = ""
  if (systemMsg) {
    const c = systemMsg.content
    if (typeof c === "string") {
      system = c
    } else if (Array.isArray(c)) {
      system = c
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n")
    }
  }

  const lastUser = [...options.prompt].reverse().find((m) => m.role === "user")
  let prompt = ""
  if (lastUser) {
    const c = lastUser.content
    if (typeof c === "string") {
      prompt = c
    } else if (Array.isArray(c)) {
      prompt = c
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n")
    }
  }

  return { system, prompt }
}

function fmtBytes(n: number): string {
  return `${(n / 1e9).toFixed(2)} GB`
}

// Pre-computed prefix/suffix strings for the progress bar so we never
// allocate via String.repeat() on every download callback tick.
const BAR_FILLED = Array.from({ length: 21 }, (_, i) => "█".repeat(i))
const BAR_EMPTY  = Array.from({ length: 21 }, (_, i) => "░".repeat(i))

// ── Web search (direct HTTP, no API key required) ──────────────────────────────

async function callWebSearch(query: string): Promise<string> {
  try {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "web_search",
        arguments: {
          objective: query,
          search_queries: [query],
        },
      },
    })

    const res = await fetch("https://search.parallel.ai/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body,
      signal: AbortSignal.timeout(25_000),
    })

    const text = await res.text()

    // Parse MCP response — may be direct JSON or SSE lines
    for (const candidate of [text, ...text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6))]) {
      try {
        const parsed = JSON.parse(candidate.trim())
        const content = parsed?.result?.content
        if (Array.isArray(content)) {
          const hit = content.find((c: any) => c.text)
          if (hit?.text) return hit.text as string
        }
      } catch {}
    }

    return "No results found."
  } catch (err: any) {
    return `Web search failed: ${err?.message ?? "unknown error"}`
  }
}

// Build a node-llama-cpp ChatSessionModelFunctions map from AI SDK tool definitions.
// Only websearch has a real handler; other tools return a polite refusal so the model
// can tell the user the capability isn't available locally.
function buildFunctions(
  tools: Array<{ type: string; name: string; description?: string; inputSchema: any }>,
): Record<string, { description?: string; params?: any; handler: (p: any) => any }> {
  const fns: Record<string, { description?: string; params?: any; handler: (p: any) => any }> = {}

  for (const tool of tools) {
    if (tool.type !== "function") continue

    if (tool.name === "websearch") {
      fns[tool.name] = {
        description: tool.description,
        params: tool.inputSchema,
        handler: async (params: any) => callWebSearch(params.query ?? params.objective ?? ""),
      }
    } else {
      fns[tool.name] = {
        description: tool.description,
        params: tool.inputSchema,
        handler: async (_params: any) =>
          `The "${tool.name}" tool is not available in local model mode. Inform the user and answer using your knowledge only.`,
      }
    }
  }

  return fns
}

// ── AI SDK LanguageModelV3 adapter ────────────────────────────────────────────

export function createLocalLanguageModel(def: LocalModelDef): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "local",
    modelId: def.id,
    defaultObjectGenerationMode: "json",
    supportsImageUrls: false,

    async doGenerate(options) {
      if (!(await isModelDownloaded(def))) {
        await downloadModel(def)
      }

      const { session } = await getSession(def)
      const { system, prompt } = extractPrompt(options)
      session.setChatHistory([{ type: "system", text: system ?? "" }])

      const startTime = Date.now()
      const tools = (options.tools ?? []) as Array<{
        type: string; name: string; description?: string; inputSchema: any
      }>
      const functions = tools.length > 0 ? buildFunctions(tools) : undefined
      const { responseText: text } = await session.promptWithMeta(prompt, {
        functions,
        maxTokens: options.maxTokens ?? 4096,
        // Lower temperature → more focused, accurate responses.
        temperature: typeof options.temperature === "number" ? options.temperature : 0.4,
        // minP filters tokens below 5% of the top token's probability — removes
        // noise at the tail without hard top-k truncation.
        minP: 0.05,
        // Penalise repeating the same tokens — prevents looping outputs.
        repeatPenalty: { penalty: 1.1, lastTokens: 64 },
        stopOnAbortSignal: options.abortSignal ?? undefined,
      })

      const inTok = Math.ceil(prompt.length / 4)
      const outTok = Math.ceil(text.length / 4)

      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: { total: inTok, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: outTok, text: outTok, reasoning: undefined },
        },
        rawCall: { rawPrompt: prompt, rawSettings: {} },
        response: { id: `local-${def.id}-${Date.now()}`, timestamp: new Date(startTime), modelId: def.id },
        request: { body: "" },
        warnings: [],
      }
    },

    async doStream(options) {
      const startTime = Date.now()
      const { system, prompt } = extractPrompt(options)
      let inputTokens = Math.ceil(prompt.length / 4)
      let outputTokens = 0

      const textId = `text-0`

      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "text-start", id: textId })
          const emit = (delta: string) => controller.enqueue({ type: "text-delta", id: textId, delta })

          try {
            // ── Auto-download (+ auto-compress) if needed ───────────────────
            if (!(await isModelDownloaded(def))) {
              const dlSizeGb = def.ramGbRaw ?? def.ramGb
              emit(`⬇️ Downloading **${def.name}** (~${dlSizeGb} GB) — this is a one-time download.\n\n`)

              // Throttle progress to 2% steps — llama-cpp fires callbacks very
              // frequently; flooding the stream causes backpressure and churn.
              let lastPct = -1
              let lastEmitMs = 0
              await downloadModel(def, (downloaded, total) => {
                if (total === 0) return
                const pct = Math.floor((downloaded / total) * 100)
                const now = Date.now()
                if (pct < lastPct + 2 && now - lastEmitMs < 500) return
                lastPct = pct
                lastEmitMs = now
                const filled = Math.floor(pct / 5)
                const bar = BAR_FILLED[filled] + BAR_EMPTY[20 - filled]
                emit(`\r[${bar}] ${pct}% (${fmtBytes(downloaded)} / ${fmtBytes(total)})`)
              })

              if (def.compress) {
                emit(`\n\n🔧 Compressing to ${def.compress} (~${def.ramGb} GB) using oc-quant (llama.cpp C engine)...\n`)
              }

              emit(`\n\n✅ Ready. Loading model...\n\n`)
              getLlamaOnce().catch(() => {})
            }

            // ── Load model into memory ───────────────────────────────────────
            const { session } = await getSession(def)
            session.setChatHistory([{ type: "system", text: system ?? "" }])

            // ── Stream inference ─────────────────────────────────────────────
            const tools = (options.tools ?? []) as Array<{
              type: string; name: string; description?: string; inputSchema: any
            }>
            const functions = tools.length > 0 ? buildFunctions(tools) : undefined

            await session.promptWithMeta(prompt, {
              functions,
              maxTokens: options.maxTokens ?? 4096,
              temperature: typeof options.temperature === "number" ? options.temperature : 0.4,
              minP: 0.05,
              repeatPenalty: { penalty: 1.1, lastTokens: 64 },
              stopOnAbortSignal: options.abortSignal ?? undefined,
              onTextChunk(chunk) {
                outputTokens += Math.ceil(chunk.length / 4)
                emit(chunk)
              },
            })

            controller.enqueue({ type: "text-end", id: textId })
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop" as const, raw: "stop" },
              usage: {
                inputTokens: { total: inputTokens, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
              },
            })
          } catch (err: any) {
            controller.enqueue({ type: "error", error: err })
          } finally {
            controller.close()
          }
        },
      })

      return {
        stream,
        rawCall: { rawPrompt: prompt, rawSettings: {} },
        request: { body: "" },
        warnings: [],
        response: { id: `local-${def.id}-${Date.now()}`, timestamp: new Date(startTime), modelId: def.id },
      }
    },
  }
}

export function findModelDef(id: string): LocalModelDef | undefined {
  return LOCAL_MODELS.find((m) => m.id === id)
}
