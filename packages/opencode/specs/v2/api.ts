// @ts-nocheck

import { Reimagined } from "@reimagined-ai/core"
import { ReadTool } from "@reimagined-ai/core/tools"

const reimagined = Reimagined.make({})

reimagined.tool.add(ReadTool)

reimagined.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

reimagined.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

reimagined.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await reimagined.session.create({
  agent: "build",
})

reimagined.subscribe((event) => {
  console.log(event)
})

await reimagined.session.prompt({
  sessionID,
  text: "hey what is up",
})

await reimagined.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await reimagined.session.wait()

console.log(await reimagined.session.messages(sessionID))
