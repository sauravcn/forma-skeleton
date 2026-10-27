import config from "../../src/foundation.config.js";
import { requireAuthPage } from "@forma/standalone-identity/next";
import IdentityScreen from "../../src/identity-screen.jsx";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requireAuthPage(config);
  return <IdentityScreen />;
}
