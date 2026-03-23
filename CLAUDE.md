# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Chrome Extension (Manifest V3) that detects which products a user owns on the D&D Beyond marketplace, with the goal of showing which products are **not** owned.

## Architecture

- **background.js** — Service worker. Intercepts `shopper-customers` API requests on marketplace.dndbeyond.com using `chrome.webRequest`. Captures `c_productsLicensed` from the response and caches it in local storage. Uses a custom header (`X-Dndb-Product-Ownership-Request`) to avoid re-intercepting its own fetch calls. Daily capture throttle via `lastCaptureTime`.
- **content.js** — Content script injected on marketplace pages. Reads cached product ownership data from `chrome.storage.local`. Currently log-only (no DOM manipulation yet).
- **manifest.json** — Manifest V3 config. Permissions: `webRequest`, `storage`. Host permissions scoped to `marketplace.dndbeyond.com`.

## Development

No build step, no package.json, no bundler. Plain JS loaded directly by Chrome.

### Load the extension

1. `chrome://extensions/` -> Enable Developer Mode
2. "Load unpacked" -> select this repo's root directory
3. Navigate to `marketplace.dndbeyond.com` while logged in

### Debug

- Background service worker: `chrome://extensions/` -> "Inspect views: service worker"
- Content script: DevTools console on any marketplace page, filter by `[DNDBPO]:`

## Conventions

- `Logger` class duplicated in both `background.js` and `content.js` (no shared module system). Keep them in sync.
- Storage key: `dndbpo-product-ownership`
- Log prefix: `[DNDBPO]:`
- Target API pattern: `/mobify/proxy/api/customer/shopper-customers/v1/organizations/f_ecom_bfst_prd/customers/{id}?siteId=DDBUS`

## D&D Beyond Marketplace API Reference

The marketplace runs on Salesforce Commerce Cloud (SFCC). All API calls go through `/mobify/proxy/` and require a Bearer token from the `token_DDBUS` cookie.

### Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /mobify/proxy/api/customer/shopper-customers/v1/organizations/f_ecom_bfst_prd/customers/{customerId}?siteId=DDBUS` | Customer profile. Returns `c_productsLicensed` (ownership list). |
| `GET /mobify/proxy/api/search/shopper-search/v1/organizations/f_ecom_bfst_prd/product-search?refine=cgid%3Droot&limit=200&siteId=DDBUS` | All products (196 as of 2026-03-22). Returns product IDs, names, and types. |
| `GET /mobify/proxy/api/product/shopper-products/v1/organizations/f_ecom_bfst_prd/products?ids={csv}&siteId=DDBUS` | Product details by ID (batch, max ~20 per request). |
| `GET /mobify/proxy/api/product/shopper-products/v1/organizations/f_ecom_bfst_prd/products/{id}?expand=set_products&siteId=DDBUS` | Single product with bundle children expanded. |

### Product Types

| Type | Meaning | Example |
|------|---------|---------|
| `master` | Product with variants (Digital/Physical) | `tashas-cauldron-of-everything` |
| `variant` | Specific format of a master product | `SRC-00067` (Digital), `C7878000` (Physical) |
| `item` | Standalone product, no variants | `SRC-00028` (The Tortle Package) |
| `set` | Bundle containing other products | `core-rulebook-bundle` |

### Ownership Matching Rules

`c_productsLicensed` is a list of IDs the user owns. Matching a catalog product to this list requires multiple strategies:

1. **Direct match** — Product catalog ID exists in `c_productsLicensed`.
   - Works for: `item` products with SRC/DCE/DD/DB/SC prefixed IDs.
   - Example: `SRC-00028` (The Tortle Package) appears directly in both the catalog and the licensed list.

2. **DB-prefix match** — `"DB" + catalogId` exists in `c_productsLicensed`.
   - Works for: `master` products with numeric IDs.
   - Example: Catalog ID `8XTUXUM` → check for `DB8XTUXUM` in licensed list.

3. **Variant match** — For `master` products, fetch the product detail to get variant IDs, then check each variant ID against the licensed list (direct or DB-prefixed).
   - Required for: Slug-named masters like `tashas-cauldron-of-everything`.
   - Example: `tashas-cauldron-of-everything` has variant `SRC-00067` (Digital) which appears in the licensed list.

4. **Bundle ownership** — A `set` product is "owned" if ALL of its `setProducts` (fetched via `expand=set_products`) are owned.
   - Use the set children's IDs and apply rules 1-3 to each child.
   - Example: `core-rulebook-bundle` contains `DB3709000`, `DB3710000`, `DB3711000` — if all are in the licensed list, the bundle is fully owned.

### ID Prefix Patterns

| Prefix | Category | Example |
|--------|----------|---------|
| `SRC-` | Sourcebooks, adventures | `SRC-00067` |
| `DCE-` | Digital dice sets | `DCE-00800` |
| `DD-` | Digital dice (alt) | `DD0007000` |
| `DB` | D&D Beyond digital products | `DB8XTUXUM` |
| `DM` | Digital map packs | `DM4716000` |
| `SC` | Creature/sticker packs | `SC11W3K8B` |
| `CB` | Bundle SKUs | `CBFS8K0Y7` |
| `C` | Physical products | `C7878000` |
| `D` | Physical products (alt) | `D3709000` |
| `HAT` | Special collections | `HAT000001` |

### Filtering the "Not Owned" List

When showing products the user doesn't own, filter out noise:

- **Bundles where all children are owned** — user has the content, just didn't buy it as a bundle.
- **Physical-only products** (`c_isDigitalProduct === false` and no digital variant) — spellbook cards, DM screens, character sheets, gift sets.
- Optionally filter by `c_productStyle` or Format refinement (`c_productStyle: "Digital"` vs `"Physical"`).

### Updating the Product/Ownership List

- **Ownership data** refreshes when the customer API is called (happens on any marketplace page load while logged in). The extension intercepts this and caches it daily.
- **Product catalog** — Query the search API with `refine=cgid%3Droot&limit=200` to get the current full catalog. Product count may grow over time.
- **Bundle children** — Must be fetched separately per bundle using `expand=set_products`. Consider caching this since bundle composition rarely changes.
