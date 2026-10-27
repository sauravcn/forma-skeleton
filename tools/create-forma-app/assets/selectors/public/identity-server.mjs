export { proxyRecords } from "./server/records.mjs";
export function assertProfile(config) {
  if (
    config.auth.mode !== "none" ||
    config.auth.twoFactor ||
    config.auth.providers.length
  )
    throw new Error(
      "Generated public source profile cannot enable authentication",
    );
}
export async function requirePageAccess() {}
export async function requireAuthPage() {
  const { notFound } = await import("next/navigation");
  notFound();
}
