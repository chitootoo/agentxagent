import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@axa/core", "@axa/proto"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
