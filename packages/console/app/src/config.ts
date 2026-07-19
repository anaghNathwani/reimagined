/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://reimagined.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/anomalyco/reimagined",
    starsFormatted: {
      compact: "160K",
      full: "160,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/reimagined",
    discord: "https://discord.gg/reimagined",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "900",
    commits: "13,000",
    monthlyUsers: "7.5M",
  },
} as const
