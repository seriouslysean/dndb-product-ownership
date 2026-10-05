# Ownership Resolution

How the extension determines complete and partial product ownership.

## Source Semantics

Three sources run in parallel and return product IDs:

| Source                | Endpoint                                 |
| --------------------- | ---------------------------------------- |
| Marketplace customer  | `shopper-customers/.../customers/{id}`   |
| Account licenses page | `www.dndbeyond.com/account/licenses`     |
| Order history         | `GetOrderHistory` with offset pagination |

Every successful array is merged and deduplicated. A source that cannot run returns `null`; a source that successfully finds no products returns `[]`. Rejected sources are logged and excluded.

## ID Matching

For a catalog ID such as `ABC`, matching checks:

1. `ABC`
2. `DBABC`
3. Any override configured for `ABC` in `id-aliases.json`

Aliases may be a single string or an array. They cover known mismatches between marketplace IDs and account-license IDs.

## Product Types

### Item

An item is fully owned when its own ID matches. Otherwise it remains in the not-owned list.

### Master

A direct master-ID match marks the whole master owned. Otherwise every variant is matched and tagged independently.

- All variants owned: remove the master from the not-owned list.
- Some variants owned: keep the master and its tagged variants.
- No variants owned: keep the master and tag every variant as unowned.

This preserves accuracy for mixed digital/physical masters. Owning the digital variant no longer hides the physical product.

### Set

A direct set-ID match marks the whole set owned. Otherwise every child is matched and tagged independently.

- All children owned: remove the set.
- Some or no children owned: keep the set with tagged children.

Some Ultimate Bundles contain a synthetic `Digital Bundle` child instead of listing its digital products. When the outer set also lists physical products with matching catalog masters, the extension derives the wrapper’s digital component IDs. Physical siblings that already have an explicit digital sibling are excluded. The wrapper is satisfied only when every derived digital component is owned; unresolved wrappers remain unowned.

The popup uses those tags to recalculate ownership for the active format.

## Format Resolution

| Product part   | Source                                                                         |
| -------------- | ------------------------------------------------------------------------------ |
| Master         | Search-hit `variationAttributes`                                               |
| Master variant | Detail `variationValues`, matched case-insensitively                           |
| Item           | `c_productStyle` and `c_isDigitalProduct`                                      |
| Set            | Derived from its children                                                      |
| Set child      | Product style/type, `c_isDigitalProduct`, variation values, then parent format |

Unknown top-level product formats default to digital for compatibility with existing cached data. Unknown variant and set-child formats inherit their parent format so ambiguous products are not accidentally treated as digital.

## Category Resolution

Sets first resolve to Bundles. Remaining products map through `CATEGORY_BY_API_ID`. A first-party product never accepts a mapped Third-Party category, because upstream merchandising categories can contain products from multiple publishers. The special `everything-else` category uses `c_isDigitalProduct` to distinguish digital Creature Packs from physical Accessories.

Unmapped products then use ordered fallbacks:

1. Czepeku publisher or a `DM...` ID → Maps
2. `SC...` ID → Creature Packs
3. `DCE-...` or `DD...` ID → Dice
4. Non-first-party publisher → Third-Party
5. Everything else → Other

Publisher resolution prefers `c_publisher` and falls back to `manufacturerName`. First-party matching is normalized for whitespace and letter case.

### First-Party Context Inference

The marketplace sometimes returns only `primaryCategoryId: "root"` for new first-party products. After the normal rules run, the background fetches the public product page for unresolved first-party entries and reads its JSON-LD `Product` description.

Inference is deliberately limited to high-confidence evidence:

- Exact product-type phrases such as Map Pack, Digital Dice, Creature Pack, reference cards, decks, and DM screens
- Class and species starter packs, or an explicit “contains Character Options” description
- Explicit campaign-setting, sourcebook, or rulebook language
- Four or more independent player-option signals, such as subclasses, spells, feats, backgrounds, items, and creatures
- Strong adventure phrases such as “complete level 11–20 adventure” or “adventure designed for”

The description is used transiently and is not stored. Only the category, a short inference reason, and public source-book references enter the catalog cache. Ambiguous products remain under Other and appear in the expandable review list.

### Covered Starter Packs

Character-option starter packs can duplicate content from larger books. Their public description contains a “Character Options from” section. The extension extracts those source-book names and any linked marketplace product IDs, then marks the pack covered only when every listed source is owned digitally.

Covered does not mean owned: starter packs can contain separate dice or premade-character extras. Covered packs remain in the unowned data, do not increase the owned count, and are merely removed from the default actionable list. The filter menu can reveal them with the source books that cover them.

## Accuracy Maintenance

- Add a focused test before changing a matching rule.
- Treat first-party products under Other as classification work, not as silently valid results.
- Keep private account data out of fixtures and source control.
- Re-evaluate `id-aliases.json` when upstream IDs change.
- Use `tools/fetch-fixtures.js` in an authenticated marketplace console to inspect selected public catalog records.
