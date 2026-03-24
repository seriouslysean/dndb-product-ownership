# Architecture

How data flows through the extension and why each piece exists.

## Runtime Context

| Context                   | File(s)       | Capabilities                                                           | Limitations                                      |
| ------------------------- | ------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| Background service worker | background.js | `chrome.cookies`, `chrome.storage`, cross-origin fetch, always running | No DOM, no DOMParser, no page context            |
| Content script            | content.js    | Runs on marketplace pages, same-origin fetch                           | Only active when a tab is open                   |
| Side panel                | popup.js      | DOM rendering, `chrome.storage`, `chrome.runtime.sendMessage`          | Cannot fetch marketplace APIs (extension origin) |

## Fetch Architecture

All external HTTP requests in the background service worker go through `bgFetch()`:

1. Resolves relative paths (e.g. `/mobify/proxy/...`) against `MARKETPLACE_BASE`
2. Adds auth token from `chrome.cookies` (unless `auth: false`)
3. Checks response status: 401 throws with `isAuthError`, non-ok throws with status
4. Returns the raw `Response` object

`apiFetch()` wraps `bgFetch()` and parses JSON. All SFCC API calls use `apiFetch()`.

Why the background needs to resolve URLs: endpoint builders in `shared.js` return relative paths (e.g. `/mobify/proxy/api/...`). In the content script (page context), these resolve against `marketplace.dndbeyond.com`. In the background service worker, they resolve against `chrome-extension://<id>/`, which fails. `bgFetch` handles this transparently.

## Pipeline Flow

The pipeline runs in `background.js` and writes results to `chrome.storage.local`. The popup reads from storage and renders.

```
1. checkVersionChange()
   - Compares manifest version against stored version
   - If different: clears cached catalog, ownership, and results
   - Ensures new extension versions get fresh data

2. fetchOwnershipData()
   - Runs 3 sources in parallel via Promise.allSettled
   - Each source can fail independently without losing the others:

   a. fetchOwnershipFromApi()
      - Reads customer ID from JWT in token_DDBUS cookie
      - Fetches customer profile from SFCC shopper-customers API
      - Returns c_productsLicensed (array of owned IDs)

   b. fetchOwnershipFromLicensesPage()
      - Fetches www.dndbeyond.com/account/licenses (HTML)
      - Parses first <td> from each <tr> via regex (no DOMParser in service worker)
      - Detects login redirect (no <table> in HTML)
      - Returns array of license IDs

   c. fetchOwnershipFromOrders()
      - Paginates through GetOrderHistory OCAPI endpoint
      - Extracts sfccProductId from all fulfilled order items
      - Returns array of ordered product IDs

   - Merges and deduplicates all IDs
   - Writes merged IDs to STORAGE.OWNERSHIP

3. fetchCatalog()
   - Checks daily cache (STORAGE.LAST_CATALOG_FETCH)
   - If stale or forced: fetches all products from SFCC search API
   - Enriches in batches:
     - Masters + items: product details for format, category, publisher, price
     - Sets: product details with expand=set_products for bundle children
   - Tags new products (not in STORAGE.KNOWN_IDS) with isNew for 7 days
   - Writes enriched catalog to STORAGE.CATALOG

4. computeNotOwned()
   - For each catalog product, checks ownership via:
     a. Direct ID match in licensed IDs
     b. "DB" + catalogId match
     c. ID alias lookup (id-aliases.json)
     d. Variant ID match (masters)
     e. All-children-owned check (sets)
   - Returns array of unowned products with tagged bundle children

5. Write results to STORAGE.NOT_OWNED
```

## Triggers

| Trigger                                 | What happens                                                        |
| --------------------------------------- | ------------------------------------------------------------------- |
| Extension installed/updated             | `onInstalled` re-injects content scripts into open marketplace tabs |
| Background startup                      | `loadIdAliases()` then `runPipeline()`                              |
| Content script loads (marketplace page) | Sends `refresh` message to background                               |
| Popup refresh button                    | Sends `refresh` message to background                               |
| Popup opens with stale FETCH_FAILED     | Sends `refresh` message to background                               |

## Popup Rendering

The popup never fetches data. It reads from `chrome.storage.local` and listens for changes via `chrome.storage.onChanged`.

Filters (format, publisher, categories, search, dismissed products) are applied client-side on the stored data. Filter preferences persist in `STORAGE.FILTER_PREFS`. Dismissed product IDs persist in `STORAGE.DISMISSED`.

## Error States

| Error Code          | Meaning                            | Popup behavior                                                      |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `NOT_AUTHENTICATED` | No auth token (not logged in)      | Shows login gate                                                    |
| `TOKEN_EXPIRED`     | 401 from API (session expired)     | Shows login gate with "session expired"                             |
| `FETCH_FAILED`      | Network error or non-401 API error | Shows login gate with "check connection", auto-retries on next open |

## Storage Keys

All keys defined in `STORAGE` enum in `constants.js`.

| Key                  | Contents                                                                     | TTL                                    |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| `OWNERSHIP`          | Merged array of all owned product IDs                                        | Refreshed on pipeline run              |
| `CATALOG`            | Enriched product array (name, format, category, price, children)             | 1 day (ONE_DAY_MS)                     |
| `LAST_CATALOG_FETCH` | Timestamp of last catalog fetch                                              | Used for TTL check                     |
| `NOT_OWNED`          | Pipeline result: products array + counts + timestamp, or error/syncing state | Refreshed on pipeline run              |
| `KNOWN_IDS`          | Map of productId to first-seen timestamp                                     | Grows over time, used for "new" badges |
| `FILTER_PREFS`       | User's format, publisher, and hidden category preferences                    | Persistent                             |
| `DISMISSED`          | Array of product IDs the user dismissed                                      | Persistent, resettable                 |
| `VERSION`            | Extension version string for cache busting                                   | Updated on version change              |
