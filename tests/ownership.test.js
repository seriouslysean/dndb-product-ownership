import assert from "node:assert/strict";
import test from "node:test";

import { FORMAT } from "../constants.js";
import { ProductOwnership as ownership } from "../ownership.js";

test("matches direct IDs, DB-prefixed IDs, and aliases", () => {
  const catalog = [
    { id: "direct", type: "item" },
    { id: "prefixed", type: "item" },
    { id: "aliased", type: "item" },
    { id: "missing", type: "item" },
  ];
  const result = ownership.computeNotOwned(
    catalog,
    { ids: ["direct", "DBprefixed", "legacy-id"] },
    { aliased: "legacy-id" },
  );

  assert.deepEqual(result, [{ id: "missing", type: "item" }]);
});

test("supports multiple aliases for one catalog product", () => {
  const result = ownership.computeNotOwned(
    [{ id: "product", type: "item" }],
    { ids: ["second-alias"] },
    { product: ["first-alias", "second-alias"] },
  );

  assert.deepEqual(result, []);
});

test("keeps a mixed-format master when only one variant is owned", () => {
  const product = {
    id: "master",
    type: "master",
    format: FORMAT.BOTH,
    variants: [
      { id: "digital-id", format: FORMAT.DIGITAL },
      { id: "physical-id", format: FORMAT.PHYSICAL },
    ],
  };
  const [result] = ownership.computeNotOwned([product], { ids: ["digital-id"] });

  assert.deepEqual(result.variants, [
    { id: "digital-id", format: FORMAT.DIGITAL, isOwned: true },
    { id: "physical-id", format: FORMAT.PHYSICAL, isOwned: false },
  ]);
  assert.equal(
    ownership.getRelevantParts(result, FORMAT.DIGITAL).every((variant) => variant.isOwned),
    true,
  );
  assert.equal(
    ownership.getRelevantParts(result, FORMAT.PHYSICAL).every((variant) => variant.isOwned),
    false,
  );
});

test("removes a master when every variant is owned", () => {
  const product = {
    id: "master",
    type: "master",
    variants: [{ id: "one" }, { id: "two" }],
  };
  const result = ownership.computeNotOwned([product], { ids: ["one", "two"] });

  assert.deepEqual(result, []);
});

test("tags every bundle child and removes fully owned bundles", () => {
  const product = {
    id: "bundle",
    type: "set",
    children: [
      { id: "one", format: FORMAT.DIGITAL },
      { id: "two", format: FORMAT.PHYSICAL },
    ],
  };

  const [partial] = ownership.computeNotOwned([product], { ids: ["one"] });
  assert.deepEqual(partial.children, [
    { id: "one", format: FORMAT.DIGITAL, isOwned: true },
    { id: "two", format: FORMAT.PHYSICAL, isOwned: false },
  ]);

  const complete = ownership.computeNotOwned([product], { ids: ["one", "two"] });
  assert.deepEqual(complete, []);
});

test("treats a valid empty library as owning no catalog products", () => {
  const catalog = [
    { id: "one", type: "item" },
    { id: "two", type: "item" },
  ];
  const result = ownership.computeNotOwned(catalog, { ids: [] });

  assert.deepEqual(result, catalog);
});

test("distinguishes unavailable ownership sources from a valid empty source", () => {
  assert.equal(ownership.mergeSourceIds([null, null, null]), null);
  assert.deepEqual(ownership.mergeSourceIds([null, [], null]), []);
  assert.deepEqual(ownership.mergeSourceIds([["one", "two"], null, ["two", "three"]]), [
    "one",
    "two",
    "three",
  ]);
});

test("resolves variant formats case-insensitively with a safe fallback", () => {
  assert.equal(
    ownership.getVariantFormat({ "Digital/Physical": "Digital" }, FORMAT.BOTH),
    FORMAT.DIGITAL,
  );
  assert.equal(
    ownership.getVariantFormat({ "Digital/Physical": "physical" }, FORMAT.BOTH),
    FORMAT.PHYSICAL,
  );
  assert.equal(ownership.getVariantFormat({}, FORMAT.BOTH), FORMAT.BOTH);
});

test("resolves mapped, special-case, and fallback categories", () => {
  assert.equal(
    ownership.resolveCategory({ id: "book", type: "item" }, { primaryCategoryId: "rulebooks" }),
    "Rulebooks",
  );
  assert.equal(
    ownership.resolveCategory(
      { id: "digital", type: "item" },
      { primaryCategoryId: "everything-else", c_isDigitalProduct: true },
    ),
    "Creature Packs",
  );
  assert.equal(
    ownership.resolveCategory(
      { id: "physical", type: "item" },
      { primaryCategoryId: "everything-else", c_isDigitalProduct: false },
    ),
    "Accessories",
  );
  assert.equal(
    ownership.resolveCategory(
      { id: "product", type: "item", publisher: "Independent Publisher" },
      { primaryCategoryId: "root" },
    ),
    "Third-Party",
  );
  assert.equal(
    ownership.resolveCategory({ id: "bundle", type: "set" }, { primaryCategoryId: "root" }),
    "Bundles",
  );
});

test("does not misclassify products with missing publishers as third-party", () => {
  let unmapped;
  const category = ownership.resolveCategory(
    { id: "unknown", type: "item", publisher: null },
    { primaryCategoryId: "new-upstream-category" },
    (value) => {
      unmapped = value;
    },
  );

  assert.equal(category, "Other");
  assert.equal(unmapped, "new-upstream-category");
});

test("extracts the first cell from license rows with nested markup", () => {
  const html = `
    <table>
      <thead><tr><th>ID</th><th>Name</th></tr></thead>
      <tbody>
        <tr><td> SRC-00028 </td><td>Product</td></tr>
        <tr class="license"><td><span>DCE-02100</span></td><td>Dice</td></tr>
        <tr><td>ABC&amp;123&nbsp;</td><td>Encoded</td></tr>
      </tbody>
    </table>
  `;

  assert.deepEqual(ownership.extractLicenseIds(html), ["SRC-00028", "DCE-02100", "ABC&123"]);
});
