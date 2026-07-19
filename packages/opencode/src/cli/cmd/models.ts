import { EOL } from "os"
import { Effect } from "effect"
import { ModelsDev } from "@reimagined-ai/core/models-dev"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { ProviderV2 } from "@reimagined-ai/core/provider"
import { LOCAL_MODELS, downloadModel, isModelDownloaded, findModelDef } from "@/provider/local"

export const ModelsCommand = effectCmd({
  command: "models [provider]",
  describe: "list all available models",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      })
      .option("download", {
        describe: "download a local open-weight model by ID (e.g. qwen2.5-coder-7b)",
        type: "string",
      })
      .option("local", {
        describe: "list available local open-weight models and their download status",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.models")(function* (args) {
    const { Provider } = yield* Effect.promise(() => import("@/provider/provider"))

    // ── Download a local model ───────────────────────────────────────────────
    if (args.download) {
      const def = findModelDef(args.download)
      if (!def) {
        const ids = LOCAL_MODELS.map((m) => `  ${m.id}  (${m.name})`).join(EOL)
        return yield* fail(`Unknown local model: "${args.download}". Available models:${EOL}${ids}`)
      }
      const already = yield* Effect.promise(() => isModelDownloaded(def))
      if (already) {
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ ${def.name} is already downloaded` + UI.Style.TEXT_NORMAL)
        return
      }
      UI.println(`Downloading ${def.name} (~${def.ramGb}GB) from HuggingFace...`)
      UI.println(`Source: ${def.source}`)
      UI.println(`License: ${def.license}`)
      UI.println("")
      let lastPct = -1
      yield* Effect.promise(() =>
        downloadModel(def, (downloaded, total) => {
          if (total === 0) return
          const pct = Math.floor((downloaded / total) * 100)
          if (pct !== lastPct) {
            lastPct = pct
            process.stdout.write(`\r  ${pct}% (${(downloaded / 1e9).toFixed(2)} / ${(total / 1e9).toFixed(2)} GB)`)
          }
        }),
      )
      process.stdout.write(EOL)
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ Downloaded ${def.name}` + UI.Style.TEXT_NORMAL)
      UI.println(`Run with: reimagined --model local-openweight/${def.id}`)
      return
    }

    // ── List local models ────────────────────────────────────────────────────
    if (args.local) {
      UI.println(UI.Style.TEXT_BOLD + "Local Open-Weight Models (node-llama-cpp)" + UI.Style.TEXT_NORMAL)
      UI.println("These run entirely on your device — no API key, no cloud, no cost.")
      UI.println("")
      for (const def of LOCAL_MODELS) {
        const downloaded = yield* Effect.promise(() => isModelDownloaded(def))
        const status = downloaded
          ? UI.Style.TEXT_SUCCESS_BOLD + "✓ downloaded" + UI.Style.TEXT_NORMAL
          : "  not downloaded"
        UI.println(`  ${def.id.padEnd(22)} ${def.name}`)
        UI.println(`    RAM: ~${def.ramGb}GB  Context: ${def.contextK}K  License: ${def.license}`)
        UI.println(`    Status: ${status}`)
        if (!downloaded) UI.println(`    Install: reimagined models --download ${def.id}`)
        UI.println("")
      }
      return
    }

    if (args.refresh) {
      yield* ModelsDev.Service.use((s) => s.refresh(true))
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
    }

    const provider = yield* Provider.Service
    const providers = yield* provider.list()

    const print = (providerID: ProviderV2.ID, verbose?: boolean) => {
      const p = providers[providerID]
      const sorted = Object.entries(p.models).sort(([a], [b]) => a.localeCompare(b))
      for (const [modelID, model] of sorted) {
        process.stdout.write(`${providerID}/${modelID}`)
        process.stdout.write(EOL)
        if (verbose) {
          process.stdout.write(JSON.stringify(model, null, 2))
          process.stdout.write(EOL)
        }
      }
    }

    if (args.provider) {
      const providerID = ProviderV2.ID.make(args.provider)
      if (!providers[providerID]) return yield* fail(`Provider not found: ${args.provider}`)
      print(providerID, args.verbose)
      return
    }

    const ids = Object.keys(providers).sort((a, b) => {
      const aIsLocal = a === "local-openweight" || a === "ollama"
      const bIsLocal = b === "local-openweight" || b === "ollama"
      if (aIsLocal && !bIsLocal) return -1
      if (!aIsLocal && bIsLocal) return 1
      const aIsOpencode = a.startsWith("reimagined")
      const bIsOpencode = b.startsWith("reimagined")
      if (aIsOpencode && !bIsOpencode) return -1
      if (!aIsOpencode && bIsOpencode) return 1
      return a.localeCompare(b)
    })

    for (const providerID of ids) print(ProviderV2.ID.make(providerID), args.verbose)
  }),
})
