# CLAUDE.md

Guidance for working in this repository.

## What This Is

A Chrome Manifest V3 extension that shows which D&D Beyond marketplace products the signed-in user does not fully own. Its Vue side panel supports audit scopes, format, category, publisher, text, and accordion controls. Three ownership sources are merged to reduce false positives.

## Commands

```bash
npm test              # ownership and parsing tests
npm run typecheck     # Vue and TypeScript diagnostics
npm run lint          # oxlint (JS/TS/Vue) + stylelint (CSS)
npm run lint:fix      # auto-fix lint issues
npm run format        # oxfmt --write
npm run format:check  # oxfmt --check
npm run build         # Vite production bundle
```

Lefthook runs tests, type checking, the Vite build, Oxfmt, Oxlint, and Stylelint before commits.

## Architecture

```text
constants.js  → enums, storage keys, category maps, publisher list
shared.js     → logging, URLs, endpoint builders, batch helpers
ownership.js  → pure ownership, format, and license-parsing rules
content.js    → reads the marketplace auth cookie and requests a sync
background.js → fetch pipeline and extension lifecycle
src/popup/    → Vue/TypeScript side-panel model, components, and styles
```

Vite builds the side panel to `dist/popup.html`. The background service worker uses native ES modules, and the isolated content script is a standalone classic script.

### Data Flow

1. The content script passes the marketplace auth token to the background service worker.
2. The background merges ownership IDs from the customer API, licenses page, and paginated order history.
3. It fetches the complete paginated catalog and enriches products in detail batches.
4. `ownership.js` matches direct IDs, `DB`-prefixed IDs, aliases, master variants, and set children.
5. The result is stored under `STORAGE.NOT_OWNED`; the Vue side panel renders storage changes.

Catalog and ownership caches are reused during automatic sync. The Refresh button forces all sources and the catalog to refetch. A manifest-version change invalidates cached catalog, ownership, and results.

## Ownership Rules

- Items are owned by direct ID, `DB`-prefixed ID, or a configured alias.
- Masters are fully owned by their direct ID or when all variants are owned. Partially owned masters retain tagged variants so format filtering stays accurate.
- Sets are fully owned by their direct ID or when all children are owned. Partially owned sets retain tagged children.
- `id-aliases.json` contains known marketplace-to-license ID mismatches.
- A valid empty ownership response means the entire catalog is unowned; it is not an authentication error.

## Categories and Formats

`primaryCategoryId` maps through `CATEGORY_BY_API_ID`. Unmapped products use the ordered `CATEGORY_FALLBACKS`, then unresolved first-party products use conservative inference over public product-page JSON-LD. The `everything-else` category splits by `c_isDigitalProduct`.

Products use `digital`, `physical`, or `both`. Master variant formats come from `variationValues`; set child formats come from `c_isDigitalProduct`.

## Conventions

- Keep pure ownership and parsing behavior in `ownership.js` and add tests for every edge case.
- Keep side-panel filtering rules in `src/popup/model.ts` and UI behavior in small Vue components.
- Keep shared constants in `constants.js` and HTTP endpoint builders in `shared.js`.
- Use structured logging such as `Logger.log("message", { key: value })`.
- Use `STORAGE.*`, `ERROR.*`, and `FORMAT.*` instead of raw values.
- Do not commit tokens, customer IDs, licenses, order data, or other private account data.
