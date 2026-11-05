import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@contagxt/axa-core", "@contagxt/axa-proto"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
