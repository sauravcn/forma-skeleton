import { proxyRecords } from "../../../../src/identity-server.mjs";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function PATCH(request, context) {
  const { id } = await context.params;
  return proxyRecords(request, `records/${id}`);
}
