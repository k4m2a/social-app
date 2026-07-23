package main

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

// Brand carries the per-brand identity that the SSR layer needs to inject
// into OG / Twitter Card metadata. The runtime web bundle resolves its own
// brand from window.location.hostname (src/brand/resolve.web.ts); this is
// the server-side mirror used by the Pongo2 templates.
//
// Field names are exported because Pongo2 reads them via Go reflection.
type Brand struct {
	ID             string
	Name           string
	SiteName       string
	Description    string
	TwitterHandle  string
	DefaultOGImage string
	AppleItunesApp string
	CanonicalHost  string

	// Pre-hydration splash styling. These let the SSR shell paint the
	// correct brand background before the JS bundle loads, so a first-time
	// visitor to a branded host does not see the default-brand background.
	// The values mirror the brand palettes consumed by src/alf/themes.ts:
	// BgLight is palette.default.contrast_0, BgDark/BgDim are the inverted
	// contrast_1000 of the (dark) default/subdued ramps (see src/brand/boot.ts).
	BgLight      string
	BgDark       string
	BgDim        string
	PrimaryColor string
}

const brandContextKey = "brand"

var brands = map[string]Brand{
	"bluesky": {
		ID:             "bluesky",
		Name:           "Bluesky",
		SiteName:       "Bluesky Social",
		Description:    "Social media as it should be. Find your community among millions of users, unleash your creativity, and have some fun again.",
		TwitterHandle:  "@bluesky",
		DefaultOGImage: "https://bsky.app/static/social-card-default-gradient.png",
		AppleItunesApp: "app-id=xyz.blueskyweb.app, app-clip-bundle-id=xyz.blueskyweb.app.AppClip, app-clip-display=card",
		CanonicalHost:  "bsky.app",
		BgLight:        "#FFFFFF",
		BgDark:         "#000000",
		BgDim:          "#151D28",
		PrimaryColor:   "#006AFF",
	},
	"k4m2a": {
		ID:            "k4m2a",
		Name:          "k4m2a",
		SiteName:      "k4m2a",
		Description:   "Join the conversation on k4m2a.",
		CanonicalHost: "k4m2a.app",
		BgLight:       "#FFFFFF",
		BgDark:        "#0D0D0D",
		BgDim:         "#121212",
		PrimaryColor:  "#000000",
	},
	"maanav": {
		ID:            "maanav",
		Name:          "Maanav",
		SiteName:      "Maanav",
		Description:   "Madhyasth Darshan community on Maanav.",
		CanonicalHost: "maanav.net",
		BgLight:       "#FFFFFF",
		BgDark:        "#150D0A",
		BgDim:         "#1E1410",
		PrimaryColor:  "#CD7233",
	},
	"coseeker": {
		ID:            "coseeker",
		Name:          "CoSeeker",
		SiteName:      "CoSeeker",
		Description:   "Join the conversation on CoSeeker.",
		CanonicalHost: "coseeker.com",
		BgLight:       "#FFFFFF",
		BgDark:        "#0D0D0D",
		BgDim:         "#121212",
		PrimaryColor:  "#000000",
	},
}

// hostnameToBrandID mirrors HOSTNAME_TO_BRAND_ID in src/brand/resolve.web.ts;
// TestHostnameMapMatchesTypeScript enforces that the two agree. Add entries as
// production hostnames come online. Anything not listed falls back to the
// default brand.
var hostnameToBrandID = map[string]string{
	"k4m2a.app":      "k4m2a",
	"www.k4m2a.app":  "k4m2a",
	"maanav.net":     "maanav",
	"www.maanav.net": "maanav",
	// Legacy hosts from before the Maanav rename. The reverse proxy 301s
	// these to maanav.net, so the app should never see them; these entries
	// only keep the brand correct if a redirect is ever missed, rather than
	// silently falling back to the default brand.
	"mdparivaar.com":     "maanav",
	"www.mdparivaar.com": "maanav",
	"coseeker.com":       "coseeker",
	"www.coseeker.com":   "coseeker",
}

// defaultBrandID must match DEFAULT_BRAND_ID in src/brand/registry.ts. If the
// two disagree, an unlisted host gets SSR metadata and splash colors for one
// brand and then hydrates into another. See TestDefaultBrandMatchesTypeScript.
const defaultBrandID = "coseeker"

// legacyHostRedirects maps retired hostnames to the canonical host that
// replaced them. A request to a legacy host is 301'd to the same path on the
// canonical host. DNS for these still points here and they remain in
// hostnameToBrandID as a brand-resolution safety net, but the redirect is the
// intended behavior - a legacy host should not serve content of its own.
var legacyHostRedirects = map[string]string{
	"mdparivaar.com":     "maanav.net",
	"www.mdparivaar.com": "maanav.net",
}

// LegacyHostRedirectMiddleware 301s any request whose Host is a retired
// hostname to the same path and query on its canonical replacement. It runs
// before brand resolution so retired hosts never render a page. Doing this in
// the app rather than in Traefik keeps it version-controlled and survives
// Coolify regenerating its own router labels on every deploy.
func LegacyHostRedirectMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			host := strings.ToLower(c.Request().Host)
			if i := strings.IndexByte(host, ':'); i >= 0 {
				host = host[:i]
			}
			target, ok := legacyHostRedirects[host]
			if !ok {
				return next(c)
			}
			u := *c.Request().URL
			u.Scheme = "https"
			u.Host = target
			return c.Redirect(http.StatusMovedPermanently, u.String())
		}
	}
}

// ResolveBrand picks a brand from a Host header. Strips the port,
// lowercases, and falls back to the default brand on unknown hosts.
func ResolveBrand(host string) Brand {
	host = strings.ToLower(host)
	if i := strings.IndexByte(host, ':'); i >= 0 {
		host = host[:i]
	}
	id, ok := hostnameToBrandID[host]
	if !ok {
		id = defaultBrandID
	}
	b, ok := brands[id]
	if !ok {
		b = brands[defaultBrandID]
	}
	return b
}

// BrandMiddleware resolves the brand once per request from the Host
// header and stashes it on the echo context so handlers can read it
// via brandFromContext() without re-parsing.
func BrandMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set(brandContextKey, ResolveBrand(c.Request().Host))
			return next(c)
		}
	}
}

// brandFromContext returns the brand attached by BrandMiddleware, or the
// default brand if the middleware didn't run (e.g. error paths before
// routing).
func brandFromContext(c echo.Context) Brand {
	if c == nil {
		return brands[defaultBrandID]
	}
	if b, ok := c.Get(brandContextKey).(Brand); ok {
		return b
	}
	if req := c.Request(); req != nil {
		return ResolveBrand(req.Host)
	}
	return brands[defaultBrandID]
}
