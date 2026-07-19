const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://reimagined.ai" : `https://${stage}.reimagined.ai`,
  console: stage === "production" ? "https://reimagined.ai/auth" : `https://${stage}.reimagined.ai/auth`,
  email: "help@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/reimagined",
  discord: "https://reimagined.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
