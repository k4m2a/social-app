package main

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

/*
 * The brand identity in this package is hand-mirrored from the TypeScript
 * brand registry (see the "mirrors" comments on brand.go and
 * src/brand/resolve.web.ts). Nothing in either build enforces that, and the
 * two have already drifted once: the TS default was changed from 'bluesky'
 * to 'coseeker' in 61a2d7f54 without touching brand.go, so every unlisted
 * host served Bluesky OG/Twitter metadata and Bluesky splash colors and then
 * hydrated into CoSeeker.
 *
 * These tests parse the TS sources directly so the mirror cannot drift again
 * without a build failure. They are a stopgap: the durable fix is to generate
 * both sides from one manifest (brands/REVIEW_FOLLOWUPS.md item 6).
 */

const (
	tsRegistryPath = "../../../src/brand/registry.ts"
	tsResolvePath  = "../../../src/brand/resolve.web.ts"
)

var (
	tsDefaultBrandRe = regexp.MustCompile(`export const DEFAULT_BRAND_ID\s*=\s*['"]([^'"]+)['"]`)
	tsBrandsBlockRe  = regexp.MustCompile(`export const brands:\s*Record<string,\s*Brand>\s*=\s*\{([^}]*)\}`)
	tsBrandKeyRe     = regexp.MustCompile(`(?m)^\s*(\w+)\s*,\s*$`)
	tsHostBlockRe    = regexp.MustCompile(`const HOSTNAME_TO_BRAND_ID:\s*Record<string,\s*string>\s*=\s*\{([^}]*)\}`)
	tsHostEntryRe    = regexp.MustCompile(`['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]`)
)

// readTS reads one of the TypeScript brand sources relative to this package.
func readTS(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		t.Fatalf("read %s: %v (these tests parse the TS brand registry; run them from the package dir)", path, err)
	}
	return string(b)
}

// submatch applies re to src and returns capture group 1, failing the test
// with a pointer at the source file if the shape no longer matches.
func submatch(t *testing.T, re *regexp.Regexp, src, path, what string) string {
	t.Helper()
	m := re.FindStringSubmatch(src)
	if m == nil {
		t.Fatalf("could not find %s in %s - the declaration was probably reshaped; update the regex in brand_test.go", what, path)
	}
	return m[1]
}

func TestDefaultBrandMatchesTypeScript(t *testing.T) {
	want := submatch(t, tsDefaultBrandRe, readTS(t, tsRegistryPath), tsRegistryPath, "DEFAULT_BRAND_ID")

	if defaultBrandID != want {
		t.Errorf("defaultBrandID = %q, but DEFAULT_BRAND_ID in %s is %q.\n"+
			"An unlisted host would be server-rendered as %q and hydrate as %q: "+
			"wrong link-preview cards and a flash of the wrong splash background.",
			defaultBrandID, tsRegistryPath, want, defaultBrandID, want)
	}
}

func TestDefaultBrandIsRegistered(t *testing.T) {
	if _, ok := brands[defaultBrandID]; !ok {
		t.Fatalf("defaultBrandID %q is not a key in brands; ResolveBrand would return a zero Brand "+
			"and the templates would render empty metadata", defaultBrandID)
	}
}

func TestBrandIDsMatchTypeScript(t *testing.T) {
	src := readTS(t, tsRegistryPath)
	block := submatch(t, tsBrandsBlockRe, src, tsRegistryPath, "the brands record")

	ts := map[string]bool{}
	for _, m := range tsBrandKeyRe.FindAllStringSubmatch(block, -1) {
		ts[m[1]] = true
	}
	if len(ts) == 0 {
		t.Fatalf("parsed zero brand ids out of %s; update the regex in brand_test.go", tsRegistryPath)
	}

	for id := range ts {
		if _, ok := brands[id]; !ok {
			t.Errorf("brand %q is registered in %s but missing from brands in brand.go; "+
				"SSR metadata and splash colors for it would fall back to %q",
				id, tsRegistryPath, defaultBrandID)
		}
	}
	for id := range brands {
		if !ts[id] {
			t.Errorf("brand %q exists in brand.go but not in %s; it was probably renamed or removed on the TS side",
				id, tsRegistryPath)
		}
	}
}

func TestHostnameMapMatchesTypeScript(t *testing.T) {
	src := readTS(t, tsResolvePath)
	block := submatch(t, tsHostBlockRe, src, tsResolvePath, "HOSTNAME_TO_BRAND_ID")

	ts := map[string]string{}
	for _, m := range tsHostEntryRe.FindAllStringSubmatch(block, -1) {
		ts[m[1]] = m[2]
	}
	if len(ts) == 0 {
		t.Fatalf("parsed zero hostnames out of %s; update the regex in brand_test.go", tsResolvePath)
	}

	for host, id := range ts {
		got, ok := hostnameToBrandID[host]
		if !ok {
			t.Errorf("hostname %q maps to %q in %s but is missing from hostnameToBrandID; "+
				"SSR would serve the %q brand for it", host, id, tsResolvePath, defaultBrandID)
			continue
		}
		if got != id {
			t.Errorf("hostname %q maps to %q in brand.go but %q in %s", host, got, id, tsResolvePath)
		}
	}
	for host, id := range hostnameToBrandID {
		if _, ok := ts[host]; !ok {
			t.Errorf("hostname %q maps to %q in brand.go but is missing from %s; "+
				"SSR and the hydrated bundle would disagree on it", host, id, tsResolvePath)
		}
	}
}

func TestResolveBrand(t *testing.T) {
	tests := []struct {
		name string
		host string
		want string
	}{
		{
			name: "listed host",
			host: "coseeker.com",
			want: "coseeker",
		},
		{
			name: "www variant",
			host: "www.k4m2a.app",
			want: "k4m2a",
		},
		{
			name: "port is stripped",
			host: "mdparivaar.com:8100",
			want: "mdparivaar",
		},
		{
			name: "host is lowercased",
			host: "WWW.CoSeeker.com",
			want: "coseeker",
		},
		{
			name: "bluesky is reachable only when listed, not as a fallback",
			host: "bsky.app",
			want: defaultBrandID,
		},
		{
			name: "unlisted host falls back to the default brand",
			host: "staging.example.com",
			want: defaultBrandID,
		},
		{
			name: "empty host falls back to the default brand",
			host: "",
			want: defaultBrandID,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResolveBrand(tt.host).ID; got != tt.want {
				t.Errorf("ResolveBrand(%q).ID = %q, want %q", tt.host, got, tt.want)
			}
		})
	}
}
