import bluesky from '../../brands/bluesky/brand'
import coseeker from '../../brands/coseeker/brand'
import k4m2a from '../../brands/k4m2a/brand'
import mdparivaar from '../../brands/mdparivaar/brand'
import {type Brand} from './types'

/**
 * The set of registered brands. Add a new brand by importing it here.
 * Keys must match the directory name under `brands/`.
 */
export const brands: Record<string, Brand> = {
  bluesky,
  coseeker,
  k4m2a,
  mdparivaar,
}

/**
 * Brand used for any hostname not listed in `resolve.web.ts`. Mirrored by
 * `defaultBrandID` in `bskyweb/cmd/bskyweb/brand.go` - if the two disagree,
 * unlisted hosts get SSR metadata and splash colors for one brand and then
 * hydrate into another. `brand_test.go` fails the Go build if they diverge.
 */
export const DEFAULT_BRAND_ID = 'coseeker'

export function getBrandById(id: string | undefined): Brand {
  if (id && brands[id]) return brands[id]
  return brands[DEFAULT_BRAND_ID]
}
