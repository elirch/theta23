import { Workspace } from "@/components/Workspace";
import { loadAppState } from "@/server/state";

// Always render from current data; never serve a cached copy of someone's session.
export const dynamic = "force-dynamic";

export default async function Page() {
  const state = await loadAppState();
  return <Workspace initial={state} />;
}
