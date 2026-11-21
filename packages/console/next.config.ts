import type { NextConfig } from "next";

const devOrigins = (process.env.AXA_DEV_ORIGINS ?? "**.ts.net,localhost,127.0.0.1")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  transpilePackages: ["@contagxt/axa-core", "@contagxt/axa-proto"],
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: devOrigins,
};

export default nextConfig;
