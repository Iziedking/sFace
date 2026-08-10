export type SecurityHeaders = Record<string, string>;

export function apiSecurityHeaders(): SecurityHeaders {
  return {
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cross-origin-resource-policy': 'same-origin',
  };
}
