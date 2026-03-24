# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Chrome Extension (Manifest V3) that shows which D&D Beyond marketplace products you don't own. Side panel UI with format, category, and publisher filters. Three ownership data sources merged for accuracy.

## Commands

```bash
npm run lint          # oxlint (JS) + stylelint (CSS)
npm run lint:fix      # auto-fix lint issues
npm run format        # oxfmt --write on all JS
npm run format:check  # oxfmt --check (CI mode)
```

Lefthook runs lint-js, format-js, and lint-css on pre-commit.

## Architecture

```
constants.js  → enums, storage keys, category maps, publisher list
shared.js     → Logger, endpoints, batch helpers (depends on constants.js)
content.js    → pipeline: fetch catalog + ownership → compute not-owned (depends on both)
popup.js      → side panel UI: filters, rendering (depends on both)
background.js → side panel setup, content script re-injection on install
```

Load order enforced by manifest.json content_scripts: `constants.js → shared.js → content.js`. Popup loads the same order via script tags. Background uses `importScripts('constants.js', 'shared.js')`.

No build step. No module system. All files share a global scope within their context.

### Data Flow

1. **Content script** runs on marketplace.dndbeyond.com page load
2. Checks version - clears cache if extension version changed (manifest.json version vs stored)
3. Fetches ownership from 3 sources in parallel (`Promise.allSettled`):
   - Marketplace customer API (`c_productsLicensed`)
   - dndbeyond.com/account/licenses page (HTML scrape for IDs + names)
   - Order history API (paginated, extracts `sfccProductId`)
4. Fetches product catalog via SFCC search API, enriches with detail batches
5. Matches ownership using: direct ID, DB-prefix, variant IDs, name fallback
6. Stores result in `chrome.storage.local` under `STORAGE.NOT_OWNED`
7. **Popup** reads from storage, applies format/publisher/category filters, renders

### Category Resolution

Products get categories from `primaryCategoryId` (API field) mapped through `CATEGORY_BY_API_ID` in constants.js. Unmapped products (mostly in `root`) fall through `CATEGORY_FALLBACKS` which uses publisher name and ID prefix patterns. The `everything-else` API category splits by `c_isDigitalProduct` into Creature Packs (digital) vs Accessories (physical).

### Ownership Matching

Applied per product in `computeNotOwned`:

- `item`: direct ID match or DB-prefix match against licensed IDs
- `master`: same as item, plus check each variant ID
- `set`: same as item, plus check if ALL children are owned (children tagged with `isOwned`)
- Name fallback: if no ID match, normalized catalog name checked against license names (one direction only, min 8 chars)

### Format and Publisher

Each product tagged with `format` (DIGITAL, PHYSICAL, BOTH) from API fields (`c_productStyle`, `c_isDigitalProduct`, `variationAttributes`). Bundle children also tagged individually. Publisher stored from `c_publisher`, with `isFirstParty` flag from `FIRST_PARTY_PUBLISHERS` list.

Popup filters by format and publisher. Bundle child counts recalculated per active format filter. Bundles hidden when all format-relevant children are owned.

## Key Files

- **constants.js** - `FORMAT`, `ERROR`, `STORAGE` enums. `CATEGORY_BY_API_ID` map. `CATEGORY_FALLBACKS` array. `DISPLAY_CATEGORIES` for UI. `FIRST_PARTY_PUBLISHERS`.
- **shared.js** - `Logger` object. `endpoints` builder. `batchProcess()`, `paginateFetch()` helpers. URL constants.
- **content.js** - `fetchCatalog()`, `resolveCategory()`, `enrichProduct()`, `computeNotOwned()`, `fetchOwnershipData()`, `runPipeline()`. Concurrency guard via `pipelineRunning` flag.
- **popup.js** - `render()`, `matchesFormat()`, `matchesPublisher()`, filter prefs persisted in `STORAGE.FILTER_PREFS`.

## Conventions

- All constants in `constants.js`, not scattered across files
- Use `npm run format` and `npm run lint`, not direct tool invocation
- Structured logging: `Logger.log('message', { key: value })` - no string interpolation
- `const` over `let`. Arrow functions. Destructuring.
- Storage keys via `STORAGE.*` enum, error codes via `ERROR.*`, format values via `FORMAT.*`
- No private data (customer IDs, tokens, personal info) in source
- Cache busted on version change (manifest.json version compared against `STORAGE.VERSION`)

## D&D Beyond API

Salesforce Commerce Cloud (SFCC) via `/mobify/proxy/`. Auth token from `token_DDBUS` cookie. All endpoints defined in `shared.js` `endpoints` object. Key API fields on products:

| Field                 | Where                                     | What                        |
| --------------------- | ----------------------------------------- | --------------------------- |
| `primaryCategoryId`   | product detail                            | Category assignment         |
| `c_productStyle`      | product detail                            | `"Digital"` or `"Physical"` |
| `c_isDigitalProduct`  | product detail, set children              | boolean                     |
| `c_publisher`         | product detail                            | Publisher name              |
| `variationAttributes` | search hit (masters)                      | Digital/Physical variants   |
| `c_productsLicensed`  | customer profile                          | Array of owned product IDs  |
| `setProducts`         | product detail with `expand=set_products` | Bundle children             |
