# Architecture

How data flows through the extension and why each runtime context exists.

## Runtime Contexts

| Context                   | Files                                          | Responsibilities                                      |
| ------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| Background service worker | `background.js` and imported modules           | Authenticated fetches, matching, caching, lifecycle   |
| Content script            | `content.js`                                   | Read the marketplace cookie and request a sync        |
| Side panel                | `src/popup/` Vue components and model          | Render storage state and apply client-side filters    |
| Pure logic                | `ownership.js`                                 | Ownership matching, format selection, license parsing |
| Shared definitions        | `constants.js`, `shared.js`, `id-aliases.json` | Enums, mappings, endpoints, known ID mismatches       |

The Manifest V3 service worker is event-driven and may stop between events. Its auth token is intentionally memory-only, while reusable results live in `chrome.storage.local`. After a worker restart, it can request the token again from an open marketplace content script.

The background uses native ES modules. Vite bundles the Vue/TypeScript side panel into `dist/`, while the content script remains standalone so it can be safely re-injected after an extension update without redeclaring shared globals.

## Fetch Boundary

All external HTTP requests go through `bgFetch()`:

1. Resolve relative marketplace paths against `MARKETPLACE_BASE`.
2. Add the in-memory bearer token unless `auth: false`.
3. On HTTP 401, ask open marketplace tabs for a different token and retry once.
4. Map a missing token to `NOT_AUTHENTICATED` and a repeated HTTP 401 to `TOKEN_EXPIRED`.
5. Reject every other non-success response.

`apiFetch()` adds JSON parsing. A failing source is rejected and logged; it is never treated as a successful partial page.

The content script rejects JWTs that are already expired or within 30 seconds of expiry. Sending a null token explicitly clears any stale background token.

## Pipeline

`runPipeline()` has a concurrency guard and reports each stage through `STORAGE.NOT_OWNED`.

1. **Version check**
   - Clear the catalog, ownership, and computed result after an extension-version change.
2. **Ownership**
   - Reacquire the memory-only token from an open marketplace tab when necessary.
   - On a normal sync, reuse a stored ownership array, including a valid empty array.
   - On refresh or cache miss, run all three sources with `Promise.allSettled`.
   - Merge and deduplicate every successful source.
3. **Catalog**
   - Reuse the catalog for up to one day on a normal sync.
   - Otherwise paginate shopper search until its reported total is reached.
   - Enrich masters/items in batches of 20 and sets in batches of 10.
   - Fetch public JSON-LD context in batches of four only for unresolved first-party products.
4. **Matching**
   - Wait for `id-aliases.json` to finish loading.
   - Run the pure `ProductOwnership.computeNotOwned()` rules.
5. **Storage**
   - Persist products, counts, and `lastUpdated`.
   - Warn when local-storage usage passes 80% of the documented 10 MB quota.

## Ownership Sources

| Source                  | Output                                           |
| ----------------------- | ------------------------------------------------ |
| Customer API            | `c_productsLicensed` IDs                         |
| Account licenses page   | First table-cell value from each license row     |
| Paginated order history | Every `sfccProductId` found in order group items |

An unavailable source returns `null`; a successful account with no products returns `[]`. This distinction prevents empty libraries from being mistaken for logged-out users.

## Triggers

| Trigger                          | Behavior                                             |
| -------------------------------- | ---------------------------------------------------- |
| Marketplace content script loads | Normal sync; caches may be reused                    |
| User presses Refresh             | Force ownership and catalog refetch                  |
| Popup opens after `FETCH_FAILED` | Force one automatic retry                            |
| Extension installs or updates    | Re-inject the standalone content script in open tabs |

## Side Panel

The Vue side panel only reads `chrome.storage.local` and listens to `chrome.storage.onChanged`. Format, publisher, category, search, accordion, and dismissed-product state stay client-side.

Masters and sets retain ownership-tagged parts. The side panel hides a partially owned product only when all parts relevant to the active format are owned.

The default scope is first-party digital. Filter-aware audit totals use the cached full catalog as the denominator and do not silently treat hidden, dismissed, or covered products as owned. Starter packs are covered only when every source book listed in their public description is owned digitally; they are hidden from the actionable audit by default and remain revealable from the filter menu. First-party products left in `Other` generate an expandable review list, including products hidden by category or dismissal preferences.

## Storage

| Key                   | Contents                                              | Lifetime                            |
| --------------------- | ----------------------------------------------------- | ----------------------------------- |
| `OWNERSHIP`           | Deduplicated owned IDs, including a valid empty array | Until forced refresh/version change |
| `CATALOG`             | Enriched products and ownership parts                 | One-day cache                       |
| `LAST_CATALOG_FETCH`  | Catalog timestamp                                     | Paired with `CATALOG`               |
| `NOT_OWNED`           | Sync stage, error, or completed result                | Replaced each pipeline run          |
| `KNOWN_IDS`           | Product ID to first-seen timestamp                    | Persistent                          |
| `CATEGORY_INFERENCES` | High-confidence public-page category results          | Until extension-version change      |
| `FILTER_PREFS`        | Format, publisher, hidden and collapsed categories    | Persistent                          |
| `DISMISSED`           | Dismissed product IDs                                 | Persistent and resettable           |
| `VERSION`             | Last extension version that initialized caches        | Persistent                          |

## Verification

`npm test` exercises the pure rules and Vue components. `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` validate the production bundle. Lefthook runs the same quality gate before commits.
