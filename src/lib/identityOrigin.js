export function configuredIdentityOrigin(value) {
  try {
    const origin = new URL(value).origin
    if (origin.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)) return origin
  } catch {
    // Fall through to the production identity origin.
  }
  return 'https://ieltsist.com'
}

export const SHARED_IDENTITY_ORIGIN = configuredIdentityOrigin(import.meta.env?.VITE_IELTSIST_ORIGIN || 'https://ieltsist.com')
