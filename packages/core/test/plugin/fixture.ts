import { AgentV2 } from "@reimagined-ai/core/agent"
import { AISDK } from "@reimagined-ai/core/aisdk"
import { Catalog } from "@reimagined-ai/core/catalog"
import { CommandV2 } from "@reimagined-ai/core/command"
import { Credential } from "@reimagined-ai/core/credential"
import { AppNodeBuilder } from "@reimagined-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@reimagined-ai/core/effect/app-node-platform"
import { LayerNode } from "@reimagined-ai/core/effect/layer-node"
import { EventV2 } from "@reimagined-ai/core/event"
import { FileSystem } from "@reimagined-ai/core/filesystem"
import { FSUtil } from "@reimagined-ai/core/fs-util"
import { Integration } from "@reimagined-ai/core/integration"
import { Location } from "@reimagined-ai/core/location"
import { Npm } from "@reimagined-ai/core/npm"
import { PluginV2 } from "@reimagined-ai/core/plugin"
import { Reference } from "@reimagined-ai/core/reference"
import { SkillV2 } from "@reimagined-ai/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
