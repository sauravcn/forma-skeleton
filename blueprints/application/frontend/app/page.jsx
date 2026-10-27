import { requirePageAccess } from "../src/identity-server.mjs";
import Starter from "../src/Starter.jsx";
export default async function Page() {
  await requirePageAccess();
  return <Starter page="overview" />;
}
