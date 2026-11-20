/**
 * OAuth configuration utilities that are safe to use in client components.
 * This file must not import server-only modules like next/headers.
 */

/**
 * The character superclass the provider-callback path may contain, used to
 * validate OIDC_PROVIDER_ID (mirrors the callback allowlist rules).
 */
export const OIDC_PROVIDER_ID_PATTERN = /^[A-Za-z0-9_.:$-]{1,128}$/

/**
 * Check if OIDC is fully configured.
 * Returns true if all required OIDC environment variables are set.
 *
 * Required variables:
 * - OIDC_ISSUER
 * - OIDC_CLIENT_ID
 * - OIDC_CLIENT_SECRET
 *
 * OIDC_SCOPE is optional and defaults to 'openid profile email'.
 */
export function isOidcConfigured(): boolean {
  return !!(getOidcIssuer() && getOidcClientId() && getOidcClientSecret())
}

/**
 * Acuity unified login: the Acuity identity provider (auth.acuity.institute)
 * is configured with ACUITY_OIDC_* names shared across the Acuity apps. The
 * upstream Morphic OIDC_* names still work and take precedence when set.
 */
function envFirst(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
}

export function getOidcIssuer(): string {
  return envFirst('OIDC_ISSUER', 'ACUITY_OIDC_ISSUER').replace(/\/+$/, '')
}

export function getOidcClientId(): string {
  return envFirst('OIDC_CLIENT_ID', 'ACUITY_OIDC_CLIENT_ID')
}

export function getOidcClientSecret(): string {
  return envFirst('OIDC_CLIENT_SECRET', 'ACUITY_OIDC_CLIENT_SECRET')
}

/**
 * Local email/password sign-in stays available as a fallback while unified
 * login is rolled out. Default ON; only an explicit "false"/"0"/"off"
 * disables it, so a missing variable never locks anyone out.
 */
export function isLocalLoginEnabled(): boolean {
  const raw = process.env.AUTH_LOCAL_LOGIN_ENABLED?.trim().toLowerCase()
  return !(raw === 'false' || raw === '0' || raw === 'off' || raw === 'no')
}

/**
 * When the identity provider itself enforces the sign-up policy (the Acuity
 * IdP does: invite/closed/allowlist in its admin portal), an invite-only
 * Search may create a local account for a new IdP identity — but only when
 * the IdP asserts email_verified. Default OFF (upstream behaviour).
 */
export function idpEnforcesSignup(): boolean {
  const raw = process.env.OIDC_IDP_ENFORCES_SIGNUP?.trim().toLowerCase()
  return raw === 'true' || raw === '1'
}

/**
 * The provider id the generic OAuth/OIDC plugin registers and that the
 * callback URL is derived from:
 *
 *   <BETTER_AUTH_URL>/api/auth/callback/<OIDC_PROVIDER_ID>
 *
 * The OIDC `sub` claim is only unique per issuer, so accounts are keyed by
 * (providerId, sub): changing OIDC_ISSUER must come with a new provider id,
 * otherwise identities from the two issuers collide in the account table.
 */
export function getOidcProviderId(): string {
  const raw =
    process.env.OIDC_PROVIDER_ID?.trim() ||
    (process.env.ACUITY_OIDC_ISSUER?.trim() && !process.env.OIDC_ISSUER?.trim()
      ? 'acuity'
      : 'oidc')
  if (!OIDC_PROVIDER_ID_PATTERN.test(raw)) {
    throw new Error(
      `Invalid OIDC_PROVIDER_ID "${process.env.OIDC_PROVIDER_ID}". ` +
        'Use 1-128 characters of letters, digits or "_.:$-".'
    )
  }
  return raw
}

/**
 * Get the display name for the OIDC provider.
 * Returns the value of OIDC_PROVIDER_NAME or 'OIDC' as default.
 */
export function getOidcProviderName(): string {
  return (
    process.env.OIDC_PROVIDER_NAME?.trim() ||
    (getOidcProviderId() === 'acuity' ? 'Acuity' : 'OIDC')
  )
}
