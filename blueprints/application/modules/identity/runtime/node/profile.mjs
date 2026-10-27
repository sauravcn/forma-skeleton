/** The authenticated source profile is fixed at generation time. */
export const SECURITY_PROFILE = "password-totp-v1";
export function assertIdentityProfile(config) {
  if (
    config?.auth?.mode !== "password" ||
    !Array.isArray(config.auth.providers) ||
    config.auth.providers.length ||
    config.auth.twoFactor !== true
  )
    throw new Error(
      "Generated identity requires its password-TOTP source profile",
    );
  if (
    typeof config.id !== "string" ||
    !/^[a-z][a-z0-9-]{1,63}$/.test(config.id)
  )
    throw new Error("Explicit generated app ID required");
  return SECURITY_PROFILE;
}
