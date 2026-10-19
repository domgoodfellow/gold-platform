import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship as TypeScript source, not a prebuilt dist (the source-package rule: no build
  // orchestrator until a second consumer earns one) -- Next has to run its own compiler over
  // them itself rather than treating them as pre-built node_modules.
  // A file attached to an Agent question arrives as a server action's body. Files are capped at 1 MB
  // (`ATTACHMENT_MAX_BYTES`); the default 1 MB body limit would refuse one at the cap, so this leaves
  // room for the request around it.
  // An email's files also arrive as a server action's body, up to 25 MB across all of them (`MAX_ATTACHMENT_TOTAL_BYTES`);
  // the limit leaves room for the form around that. Each surface still enforces its own, smaller cap.
  experimental: { serverActions: { bodySizeLimit: "30mb" } },
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md into this folder whenever it sees an agent.
  // The repository's agent contract lives in the root CLAUDE.md.
  agentRules: false,
  transpilePackages: ["@gold/ui", "@gold/types", "@gold/schemas", "@gold/config"],
  // `/account` was a second, orphaned settings surface. Personal settings has one address
  // (`lib/route/personal-settings.ts`); an old link or bookmark lands there.
  // The application may not be framed by another site — except the one fragment made to be: a
  // published form at `/embed/forms/{key}`, which shows only what the hosted page already shows.
  async headers() {
    return [
      { source: "/embed/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
      { source: "/((?!embed/).*)", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
    ];
  },
  async redirects() {
    return [
      { source: "/account", destination: "/settings/account", permanent: true },
      // Ask was a workspace of its own; the Agent rail on every workspace replaced it. A
      // bookmark lands on Home, and the assistant capability is untouched.
      { source: "/organizations/:organizationId/ask", destination: "/organizations/:organizationId/home", permanent: false },
      // Today was the narrow first version of Home. Query strings pass through a redirect.
      { source: "/organizations/:organizationId/today", destination: "/organizations/:organizationId/home", permanent: true },
      // Text messages and Email were two pages over two halves of one thing; the Inbox is one list of every
      // conversation. An old link or bookmark lands on the Inbox, already narrowed to the channel it meant.
      { source: "/organizations/:organizationId/comms/messages", destination: "/organizations/:organizationId/comms/inbox?channel=sms", permanent: false },
      { source: "/organizations/:organizationId/comms/email", destination: "/organizations/:organizationId/comms/inbox?channel=email", permanent: false },
      // Reports became one view of Insights; a saved dashboard opens on Insights' overview.
      { source: "/organizations/:organizationId/reports", has: [{ type: "query", key: "dashboard" }], destination: "/organizations/:organizationId/insights", permanent: true },
      { source: "/organizations/:organizationId/reports", destination: "/organizations/:organizationId/insights/reports", permanent: true },
    ];
  },
};

export default nextConfig;
