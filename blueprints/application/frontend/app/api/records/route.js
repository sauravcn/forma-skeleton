import { proxyRecords } from "../../../src/identity-server.mjs";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function GET(request) {
  return proxyRecords(request);
}
export function POST(request) {
  return proxyRecords(request);
}
