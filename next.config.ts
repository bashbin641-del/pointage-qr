import type { NextConfig } from "next";

const appVersion =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
  process.env.VERCEL_DEPLOYMENT_ID ??
  process.env.VERCEL_URL ??
  "development";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
