/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "reimagined",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "cloudflare",
      providers: {
        aws: {
          version: "7.30.0",
          region: "us-east-1",
          profile: process.env.GITHUB_ACTIONS
            ? undefined
            : input.stage === "production"
              ? "reimagined-production"
              : "reimagined-dev",
        },
        random: "4.19.2",
        honeycomb: "0.49.0",
      },
    }
  },
  async run() {
    const stage = await import("./infra/stage.js")
    await import("./infra/app.js")
    if ($app.stage === "production" || $app.stage === "vimtor") {
      await import("./infra/monitoring.js")
    }

    return {
      AwsStage: stage.awsStage,
    }
  },
})
