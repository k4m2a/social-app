import {DEFAULT_BRAND_ID, getBrandById} from './registry'
import {type Brand} from './types'

/**
 * Map a hostname to a brand id. Add deployment hostnames here as new
 * communities come online. Subdomains and root domains are matched
 * verbatim; anything not listed falls back to the default brand.
 *
 * Mirrored by `hostnameToBrandID` in `bskyweb/cmd/bskyweb/brand.go` for SSR.
 * Keep both in sync - `brand_test.go` fails the Go build if they diverge.
 */
const HOSTNAME_TO_BRAND_ID: Record<string, string> = {
  'k4m2a.app': 'k4m2a',
  'www.k4m2a.app': 'k4m2a',
  'maanav.net': 'maanav',
  'www.maanav.net': 'maanav',
  /*
   * Legacy hosts from before the Maanav rename. The reverse proxy 301s these
   * to maanav.net, so the app should never see them - these entries only
   * keep the brand correct if a redirect is ever missed, rather than
   * silently falling back to the default brand.
   */
  'mdparivaar.com': 'maanav',
  'www.mdparivaar.com': 'maanav',
  'coseeker.app': 'coseeker',
  'www.coseeker.app': 'coseeker',
  /*
   * coseeker.com is deliberately absent: the domain was lost in Aug 2026 and
   * its DNS now points at a parking page we do not control. Unlike the
   * mdparivaar entries above there is nothing to redirect - traffic never
   * reaches us - so listing it would only imply an association we no longer
   * have.
   */
}

/**
 * Web: brand is resolved at boot from `window.location.hostname`. Build-time
 * EXPO_PUBLIC_BRAND is honored as an override when present (useful for
 * single-tenant web deploys and for `yarn web` local dev).
 */
export function resolveBrand(): Brand {
  const envOverride = process.env.EXPO_PUBLIC_BRAND
  if (envOverride) return getBrandById(envOverride)

  const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
  const id = HOSTNAME_TO_BRAND_ID[hostname] ?? DEFAULT_BRAND_ID
  return getBrandById(id)
}
