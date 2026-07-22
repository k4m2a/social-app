# Brand-config system - review follow-ups

Findings from the pre-merge review of the `4-brand-config-system` branch
(PR #5) that were intentionally deferred. Two findings from that review were
fixed before merge and are NOT listed here:

- The unconditional community-membership write on account creation was removed
  entirely (`src/lib/community.ts` deleted, `writeMembershipRecord` calls
  dropped from `src/state/session/agent.ts`).
- The production (bskyweb) splash was made brand-aware for background color and
  `mask-icon` color, and the hardcoded Bluesky butterfly is now gated to the
  `bluesky` brand only (see the partial follow-up under "Production splash"
  below for what remains).

Ordered roughly by impact.

## 1. Default `<Logo>` fill changed from brand color to theme text color

`src/view/icons/Logo.tsx` - the default `_fill` went from
`t.palette.primary_500` to `t.atoms.text.color`. Every `<Logo>` call site that
does not pass an explicit `fill` (bottom tab bar, nav signup card, etc.) now
renders in the theme text color (black/white) instead of the brand primary. For
the `bluesky` brand this is a visible regression vs upstream (the butterfly was
always blue). Decide whether the new behavior is intended for the monochrome
brands; if so, drive it from a per-brand logo `tint` so `bluesky` keeps
`primary_500`.

## 2. Production splash: brand mark not server-rendered

`bskyweb/templates/base.html` - background + `mask-icon` color are now
brand-aware, and only `bluesky` inlines its mark. Other brands show a
correctly-colored blank splash until the JS bundle hydrates and `boot.ts`
paints the brand mark. To get a pixel-perfect first paint for the other brands
we need small, optimized per-brand splash SVGs (the `k4m2a`/`coseeker` earth
mark is ~2.17 MB and cannot be inlined into every SSR response) wired through
the Go `Brand` struct. The favicon `<link>` PNGs are also still Bluesky's;
`boot.ts` swaps them client-side post-hydration, but a brand-correct
pre-hydration favicon needs per-brand favicon assets in `static/`.

## 3. Large brand SVGs eagerly imported into every bundle

`src/brand/registry.ts` statically imports all four brands.
`brands/shared/earthMark.svg.ts` is ~2.17 MB and `maanav/logoIcon.svg.ts`
is ~118 KB, so every deployment - including the native single-tenant build
where the brand is fixed at compile time - ships ~2.3 MB of SVG it never
renders. `SvgXml` also re-parses these strings on every render of the tab
bar/splash. Code-split per active brand (dynamic import keyed on
`EXPO_PUBLIC_BRAND` / hostname), move large marks to lazily-loaded assets, and
run the SVGs through SVGO.

## 4. `defaultFeeds` discover/timeline contract is positional and unchecked

`src/lib/constants.ts` - `DISCOVER_SAVED_FEED` / `TIMELINE_SAVED_FEED` read
`brand.defaultFeeds[0]` / `[1]`. The discover-then-timeline ordering is enforced
only by a length check in `src/brand/boot.ts`. A brand author who lists feeds in
another order silently mislabels feeds. Make it a named shape, e.g.
`defaultFeeds: {discover, timeline, extra?[]}`, so the contract is structural.

## 5. Web hostname resolution silently falls back to the default brand

`src/brand/resolve.web.ts` - `HOSTNAME_TO_BRAND_ID` matches
`window.location.hostname` verbatim. Any unlisted host (staging, preview URL,
Lightsail default domain, `localhost` without `EXPO_PUBLIC_BRAND`) renders as
the default brand with the wrong PDS/feeds and no error surfaced. Consider a
louder fallback in dev, and/or derive the map from each brand's `webHost`.

> Updated: this item originally read "falls back to `bluesky`", which was true
> when written. `61a2d7f54` changed `DEFAULT_BRAND_ID` to `coseeker`, so the
> concern is now about the silence of the fallback, not which brand it lands on.

## 6. Hostname->brand map + brand identity duplicated across TS and Go

`src/brand/resolve.web.ts` <-> `bskyweb/cmd/bskyweb/brand.go`. The hostname
mapping, per-brand metadata, and now the splash background/primary colors are
hand-mirrored in two languages (the Go comments say "mirrors ...").

**This has already happened once.** `61a2d7f54` changed `DEFAULT_BRAND_ID` from
`bluesky` to `coseeker` in `src/brand/registry.ts` and touched no Go file, so
`defaultBrandID` in `brand.go` stayed `bluesky`. Every hostname absent from both
maps was served Bluesky OG/Twitter cards and Bluesky pre-hydration splash colors
and then hydrated into CoSeeker - a visible flash of the wrong background plus
wrong link previews. Fixed by setting `defaultBrandID = "coseeker"`.

`bskyweb/cmd/bskyweb/brand_test.go` now parses the TS sources and asserts the
default, the brand id set, and the hostname map all agree. That closes the
regression but is still a mirror-checker, not a single source of truth: it only
covers the three things it knows to compare, and per-brand copy (`Description`,
`TwitterHandle`, `DefaultOGImage`, `AppleItunesApp`) and the splash colors
remain hand-maintained and unchecked.

The durable fix is a generated manifest. The pieces are already in place:

- `brands/<id>/brand.js` is plain JS precisely so non-TS toolchains can read it
  (`app.config.js` does, at native build time) and already carries `webHost`.
- The Dockerfile builds the web bundle in a pnpm stage *before* the Go stage and
  does `COPY --from=web-build /app/bskyweb ./bskyweb`, and `post-web-build.js`
  already writes into `bskyweb/`. A generated `bskyweb/brands.json` would flow
  through with no new build stages.
- `bskyweb/static.go` and `templates.go` already use `//go:embed`.

Two constraints to design around:

- `BgDark`/`BgDim` are *derived*, not copied - they are the inverted
  `contrast_1000` of the dark ramps via `invertPalette` in `src/alf/themes.ts`.
  The generator has to run that derivation rather than read literals.
- `webHost` is a single host, but the maps carry `www.` variants too. Either
  emit both from the generator or widen `brand.js` to a `hosts: string[]`.

Check the manifest in and have CI assert it is not stale, so a bare
`go run ./cmd/bskyweb` still works without a Node toolchain. Once the Go side
reads the manifest, `brand_test.go` can be deleted.

## 7. Trending is gated in three places despite a single-chokepoint comment

`src/state/service-config.tsx` claims gating `useTrendingConfig().enabled`
covers every consumer, but `src/screens/Search/modules/ExploreTrendingVideos.tsx`
and `src/view/com/posts/PostFeed.tsx` re-check `brand.features.showTrending`
directly because the video surfaces do not route through `useTrendingConfig`.
Route the video interstitial / Explore module through `useTrendingConfig().enabled`
(the way `trendingTopics` is filtered) so `showTrending` funnels through one
boolean, and fix the comment.

## 8. i18n conventions on touched strings

Per `CLAUDE.md`: touched `_(msg`...`)` strings (e.g.
`src/components/dialogs/Signin.tsx`, `src/screens/Signup/StepInfo/Policies.tsx`,
`src/components/NewskieDialog.tsx`) should be refactored to the `l` macro, and
`src/lib/strings/headings.ts` joins page + brand with a bare em dash (`—`)
instead of a non-breaking space + en dash.

## 9. Duplicated brand config data

`brands/coseeker/brand.ts` - the palette ramps (~180 lines) are a verbatim copy
of `brands/k4m2a/brand.ts`, with variables still named `k4m2a*`. The `links`
and `blogUrls` blocks are also copy-pasted Bluesky values across all four
brands. Extract shared ramps/defaults (e.g. `brands/shared/`) so a brand only
declares what it overrides.
