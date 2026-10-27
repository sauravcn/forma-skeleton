import config from "../src/foundation.config.js";
import { requirePageAccess } from "@forma/standalone-identity/next";
import App from "../src/main.jsx";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePageAccess(config);
  return <App />;
}
