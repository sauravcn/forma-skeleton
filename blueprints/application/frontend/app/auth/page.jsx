import { requireAuthPage } from "../../src/identity-server.mjs";
import { AuthPage } from "../../src/identity-client.jsx";
export const dynamic = "force-dynamic";
export default async function Page() {
  await requireAuthPage();
  return <AuthPage />;
}
