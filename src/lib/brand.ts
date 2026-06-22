/**
 * Centralized Brand Configuration System
 * This file serves as the single source of truth for all branding-related
 * strings, domains, URLs, and external assets in the application.
 *
 * Consolidating these configuration values enables clean downstream maintenance
 * and rebranding, preventing hardcoded values from scattering across the codebase.
 */

export const BRAND_NAME = 'CoSeeker'
export const BRAND_DOMAIN = 'coseeker.org'
export const BRAND_HOST = `https://${BRAND_DOMAIN}`

export const BRAND_URLS = {
  website: BRAND_HOST,
  support: `${BRAND_HOST}/support`,
  feedback: `${BRAND_HOST}/feedback`,
  tos: `${BRAND_HOST}/tos`,
  privacy: `${BRAND_HOST}/privacy`,
  community: `${BRAND_HOST}/community-guidelines`,
  download: `${BRAND_HOST}/download`,
}
