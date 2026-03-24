# Ownership Resolution

How the extension determines which products you own and how it categorizes them.

## Data Sources

Three sources fetched in parallel via `Promise.allSettled`. Any source can fail without losing the others.

| Source                      | What it provides                          | Endpoint                               |
| --------------------------- | ----------------------------------------- | -------------------------------------- |
| Marketplace customer API    | `c_productsLicensed` - array of owned IDs | `shopper-customers/.../customers/{id}` |
| Licenses page (HTML scrape) | License IDs + product names               | `www.dndbeyond.com/account/licenses`   |
| Order history API           | `sfccProductId` from all orders           | `GetOrderHistory` (paginated)          |

IDs from all three are merged and deduplicated. License names are normalized and stored separately for name-based fallback matching.

## Ownership Matching

Applied per product in order. First match wins.

### 1. Direct ID match

Check if the product's catalog ID exists in the merged licensed IDs set.

Example: `SRC-00028` (The Tortle Package) appears directly in `c_productsLicensed`.

### 2. DB-prefix match

Check if `"DB" + catalogId` exists in the licensed IDs.

Example: Catalog ID `8XTUXUM` → check for `DB8XTUXUM`. This covers master products whose digital variant IDs use the DB prefix.

### 3. Variant match (masters only)

For `master` type products, fetch product details to get variant IDs, then check each variant against rules 1-2.

Example: `tashas-cauldron-of-everything` has variant `SRC-00067` (Digital) which appears in licensed IDs. See [fixtures/products.json](../fixtures/products.json) - first entry.

### 4. Bundle ownership (sets only)

A `set` is fully owned if ALL its children (from `expand=set_products`) are owned per rules 1-3. Children are tagged with `isOwned` so the popup can recompute counts per active format filter.

Example: `core-rulebook-bundle` has 6 children (3 digital, 3 physical). In Digital mode, only the 3 digital children matter. See [fixtures/products.json](../fixtures/products.json) - `core-rulebook-bundle` entry.

### 5. ID alias (manual overrides)

Some products have different IDs in the marketplace catalog vs the licenses page. These are tracked in `id-aliases.json` as `{ catalogId: licenseId }` pairs.

Example: `DCE-02101` (Elder Heart Digital Dice Set) in the catalog, but `DCE-02100` on the licenses page. The alias `"DCE-02101": "DCE-02100"` bridges the gap.

This file exists because the two systems are out of sync for certain products. It should be re-evaluated periodically. If the mismatch is fixed upstream, remove the entry. If new mismatches appear, add them. Run `tools/fetch-fixtures.js` to compare catalog IDs against license IDs and identify gaps.

## Format Resolution

Each product tagged with `format`: `digital`, `physical`, or `both`.

| Product type    | Format source                                                             |
| --------------- | ------------------------------------------------------------------------- |
| `master`        | `variationAttributes` from search hit - check for Digital/Physical values |
| `item`          | `c_productStyle` or `c_isDigitalProduct` from product detail              |
| `set`           | Derived from children - has digital + physical children = `both`          |
| Bundle children | `c_isDigitalProduct` directly on each child                               |

## Category Resolution

Products get a display category via a two-step process:

### Step 1: API category map

`primaryCategoryId` from product detail → `CATEGORY_BY_API_ID` lookup in `constants.js`.

| API ID                                                    | Display           |
| --------------------------------------------------------- | ----------------- |
| `rulebooks`, `core-rules`                                 | Rulebooks         |
| `expanded-rules`, `expanded-rules-1`                      | Sourcebooks       |
| `adventures`, `digi-adventures`                           | Adventures        |
| `settings`                                                | Campaign Settings |
| `digi-dice`                                               | Dice              |
| `CP-SIGIL-25`                                             | Creature Packs    |
| `beyond-digital`, `BB-3P-*`, `BB-3RDPARTY-*`, `all-TTRPG` | Third-Party       |
| `PROMOTION`, `TTRPG`                                      | Accessories       |
| `BB-ForgottenRealms-25`                                   | Adventures        |

### Step 2: Fallback for unmapped categories

Products in `root`, `none`, or campaign-specific categories not in the map fall through `CATEGORY_FALLBACKS` in order:

1. Publisher is Czepeku → **Maps**
2. ID matches `/^DM[A-Z0-9]/` → **Maps**
3. ID starts with `SC` → **Creature Packs**
4. ID matches `/^DCE-|^DD\d/` → **Dice**
5. Publisher not in `FIRST_PARTY_PUBLISHERS` → **Third-Party**
6. Everything else → **Other**

### Special case: `everything-else`

This API category contains both digital creature packs and physical accessories. Split by `c_isDigitalProduct`: digital → Creature Packs, physical → Accessories.

## Publisher

`c_publisher` from product detail. Products flagged `isFirstParty` if publisher is in `FIRST_PARTY_PUBLISHERS` list (constants.js). The popup's publisher toggle filters by this flag.

## Fixtures

See [fixtures/products.json](../fixtures/products.json) for annotated examples of each product type and edge case. Each entry has a `_comment` explaining what makes it interesting for testing.
