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

The popup uses those tags to recalculate ownership for the active format.

## Format Resolution

| Product part   | Source                                               |
| -------------- | ---------------------------------------------------- |
| Master         | Search-hit `variationAttributes`                     |
| Master variant | Detail `variationValues`, matched case-insensitively |
| Item           | `c_productStyle` and `c_isDigitalProduct`            |
| Set            | Derived from its children                            |
| Set child      | `c_isDigitalProduct`                                 |

Unknown product formats default to digital for compatibility with existing cached data. Unknown variant formats inherit their parent format so ambiguous mixed-format products remain visible rather than being incorrectly hidden.

## Category Resolution

`primaryCategoryId` first maps through `CATEGORY_BY_API_ID` in `constants.js`. The special `everything-else` category uses `c_isDigitalProduct` to distinguish digital Creature Packs from physical Accessories.

Unmapped products then use ordered fallbacks:

1. Czepeku publisher or a `DM...` ID → Maps
2. `SC...` ID → Creature Packs
3. `DCE-...` or `DD...` ID → Dice
4. Non-first-party publisher → Third-Party
5. Everything else → Other

Sets always display under Bundles.

## Accuracy Maintenance

- Add a focused test before changing a matching rule.
- Keep private account data out of fixtures and source control.
- Re-evaluate `id-aliases.json` when upstream IDs change.
- Use `tools/fetch-fixtures.js` in an authenticated marketplace console to inspect selected public catalog records.
