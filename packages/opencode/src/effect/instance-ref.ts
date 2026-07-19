import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@reimagined-ai/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~reimagined/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~reimagined/WorkspaceRef", {
  defaultValue: () => undefined,
})
