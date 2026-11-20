import { afterEach, describe, expect, it, vi } from 'vitest'

import { getOidcProviderId } from '../oauth-config'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getOidcProviderId', () => {
  it('defaults to "oidc"', () => {
    expect(getOidcProviderId()).toBe('oidc')
  })

  it('reads and trims OIDC_PROVIDER_ID', () => {
    vi.stubEnv('OIDC_PROVIDER_ID', '  corporate-idp  ')
    expect(getOidcProviderId()).toBe('corporate-idp')
  })

  it('accepts every character the callback path allows', () => {
    vi.stubEnv('OIDC_PROVIDER_ID', 'corp.Id-1:$ok')
    expect(getOidcProviderId()).toBe('corp.Id-1:$ok')
  })

  it('rejects characters outside the callback charset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('OIDC_PROVIDER_ID', 'corp/idp')

    expect(() => getOidcProviderId()).toThrow(/Invalid OIDC_PROVIDER_ID/)
    expect(warn).not.toHaveBeenCalled()
  })

  it('rejects ids over 128 characters', () => {
    vi.stubEnv('OIDC_PROVIDER_ID', 'a'.repeat(129))

    expect(() => getOidcProviderId()).toThrow(/Invalid OIDC_PROVIDER_ID/)
  })
})

describe('Acuity unified login env', () => {
  it('reads ACUITY_OIDC_* when OIDC_* is unset and defaults the provider id to "acuity"', async () => {
    const m = await import('../oauth-config')
    vi.stubEnv('OIDC_ISSUER', '')
    vi.stubEnv('OIDC_CLIENT_ID', '')
    vi.stubEnv('OIDC_CLIENT_SECRET', '')
    vi.stubEnv('ACUITY_OIDC_ISSUER', 'https://auth.acuity.institute/api/auth/')
    vi.stubEnv('ACUITY_OIDC_CLIENT_ID', 'cid')
    vi.stubEnv('ACUITY_OIDC_CLIENT_SECRET', 'secret')
    expect(m.isOidcConfigured()).toBe(true)
    expect(m.getOidcIssuer()).toBe('https://auth.acuity.institute/api/auth')
    expect(m.getOidcProviderId()).toBe('acuity')
    expect(m.getOidcProviderName()).toBe('Acuity')
  })

  it('prefers OIDC_* over ACUITY_OIDC_*', async () => {
    const m = await import('../oauth-config')
    vi.stubEnv('OIDC_ISSUER', 'https://idp.example.com')
    vi.stubEnv('ACUITY_OIDC_ISSUER', 'https://auth.acuity.institute/api/auth')
    expect(m.getOidcIssuer()).toBe('https://idp.example.com')
    expect(m.getOidcProviderId()).toBe('oidc')
  })

  it('keeps local login on unless explicitly disabled', async () => {
    const m = await import('../oauth-config')
    vi.stubEnv('AUTH_LOCAL_LOGIN_ENABLED', '')
    expect(m.isLocalLoginEnabled()).toBe(true)
    vi.stubEnv('AUTH_LOCAL_LOGIN_ENABLED', 'true')
    expect(m.isLocalLoginEnabled()).toBe(true)
    vi.stubEnv('AUTH_LOCAL_LOGIN_ENABLED', 'false')
    expect(m.isLocalLoginEnabled()).toBe(false)
  })
})
