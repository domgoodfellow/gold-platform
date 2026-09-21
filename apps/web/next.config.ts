import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship as TypeScript source, not a prebuilt dist (D13: no build
  // orchestrator until a second consumer earns one) -- Next has to run its own compiler over
  // them itself rather than treating them as pre-built node_modules.
  transpilePackages: ["@gold/ui", "@gold/types", "@gold/schemas", "@gold/config"],
  // `/account` was a second, orphaned settings surface. Personal settings has one address
  // (`lib/route/personal-settings.ts`); an old link or bookmark lands there.
  async redirects() {
    return [
      { source: "/account", destination: "/settings/account", permanent: true },
      // Ask was a workspace of its own; the Agent rail on every workspace replaced it. A
      // bookmark lands on Today, and the assistant capability is untouched.
      { source: "/organizations/:organizationId/ask", destination: "/organizations/:organizationId/today", permanent: false },
    ];
  },
};

export default nextConfig;
