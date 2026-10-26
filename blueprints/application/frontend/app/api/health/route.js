import { proxyRecords } from "../../../src/server/records.mjs";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function GET(request) {
  return proxyRecords(request, "health");
}
