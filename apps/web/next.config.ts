import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship as TypeScript source, not a prebuilt dist (D13: no build
  // orchestrator until a second consumer earns one) -- Next has to run its own compiler over
  // them itself rather than treating them as pre-built node_modules.
  transpilePackages: ["@gold/ui", "@gold/types", "@gold/schemas", "@gold/config"],
};

export default nextConfig;
