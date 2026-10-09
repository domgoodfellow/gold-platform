import { getPublicDb } from "@/lib/db/public";
import { PublicCommunicationWidget } from "./public-widget";

/** The published site's deployment projection supplies public display data only. */
export async function PublicSiteCommunication({ siteId }: { siteId: string }) {
  const { data, error } = await getPublicDb().rpc("public_assistant_deployment", { p_site_id: siteId });
  if (error || !data) return null;
  const deployment = data as { displayName?: string; greeting?: string };
  if (!deployment.displayName || !deployment.greeting) return null;
  return <PublicCommunicationWidget siteId={siteId} name={deployment.displayName} greeting={deployment.greeting} />;
}
