import { run as runTui, type TuiInput } from "@reimagined-ai/tui"
import { Global } from "@reimagined-ai/core/global"
import { AppNodeBuilder } from "@reimagined-ai/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
