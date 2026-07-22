// @ts-check
/**
 * Maanav brand — Madhyasth Darshan community.
 * Visual brand: saffron `#CD7233` from the MD icon SVG, monochrome
 * white-on-saffron mark.
 *
 * @type {import('../types').BrandConfig}
 */
const brand = {
  id: 'maanav',
  name: 'Maanav',
  slug: 'maanav',
  scheme: 'maanav',
  spokenName: 'Maanav',
  // TODO: real EAS owner once the build is wired up
  owner: 'TODO-eas-owner',
  // TODO: register a unique iOS bundle id and Android package
  bundleId: 'TODO.maanav.app',
  androidPackage: 'TODO.maanav.app',
  iosAppGroup: 'group.TODO.maanav',
  // Saffron primary (sampled from the icon background); splash matches the
  // logo's white-on-saffron design.
  primaryColor: '#CD7233',
  splashColor: '#FFFFFF',
  splashColorDark: '#150D0A',
  // Deep-link / universal-link host
  webHost: 'maanav.net',
  associatedDomains: [
    // TODO: 'applinks:TODO.maanav.example',
  ],
  contactsPermission:
    'I agree to allow Maanav to use my contacts for friend discovery until I opt out.',
  appExtensions: [
    // TODO: include the share extension once the native target exists.
    // {
    //   targetName: 'Share-with-Maanav',
    //   bundleSuffix: 'Share-with-Maanav',
    //   includeAppGroupEntitlement: true,
    // },
  ],
  useTextJoinLabel: true,
}

module.exports = brand
