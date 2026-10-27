// Presentation metadata never grants identity or MFA assurance.
export const socialProviderNames = Object.freeze({
  google: "Google",
  facebook: "Facebook",
  github: "GitHub",
  microsoft: "Microsoft",
  apple: "Apple",
});
export function configuredMockProviders(descriptor) {
  if (descriptor.providers === undefined) return [];
  if (!Array.isArray(descriptor.providers)) throw Error("identity.descriptor");
  const seen = new Set();
  return descriptor.providers.map((provider) => {
    if (
      !provider ||
      !Object.hasOwn(socialProviderNames, provider.id) ||
      provider.mode !== "mock" ||
      seen.has(provider.id)
    )
      throw Error("identity.descriptor");
    seen.add(provider.id);
    return {
      id: provider.id,
      mode: "mock",
      labelKey: "social" + provider.id[0].toUpperCase() + provider.id.slice(1),
    };
  });
}
export function consumeSocialResult(url) {
  if (!url.searchParams.has("error")) return null;
  return url.searchParams.get("error") === "access_denied"
    ? "cancelled"
    : "error";
}
export function mockRedirectURL(result, { origin, basePath = "", providerId }) {
  if (
    !Object.hasOwn(socialProviderNames, providerId) ||
    !result ||
    typeof result.url !== "string"
  )
    throw Error("identity.redirect");
  const url = new URL(result.url);
  if (
    url.origin !== origin ||
    url.pathname !== `${basePath}/__mock-oauth/${providerId}/authorize` ||
    url.username ||
    url.password ||
    url.hash
  )
    throw Error("identity.redirect");
  return url.href;
}
