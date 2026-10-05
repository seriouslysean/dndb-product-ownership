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

test("ignores malformed cached ownership collections", () => {
  assert.deepEqual(
    ownership.getRelevantParts({ type: "master", variants: {} }, FORMAT.DIGITAL),
    [],
  );
  assert.deepEqual(ownership.getRelevantParts({ type: "set", children: {} }, FORMAT.DIGITAL), []);
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

test("resolves nested digital bundle wrappers from owned sibling products", () => {
  const catalog = [
    {
      id: "6015000",
      name: "Ravenloft: The Horrors Within",
      type: "master",
      variants: [
        { id: "DB6015000", format: FORMAT.DIGITAL },
        { id: "D6015000", format: FORMAT.PHYSICAL },
      ],
    },
    {
      id: "6018000",
      name: "Ravenloft: The Horrors Within Map Pack",
      type: "master",
      variants: [
        { id: "DM6018000", format: FORMAT.DIGITAL },
        { id: "D6018000", format: FORMAT.PHYSICAL },
      ],
    },
  ];
  const children = ownership.resolveBundleComponents(
    [
      {
        id: "D6015000",
        name: "Ravenloft: The Horrors Within",
        format: FORMAT.PHYSICAL,
      },
      {
        id: "DBR4VNLFT",
        name: "Ravenloft: The Horrors Within Digital Bundle",
        format: FORMAT.DIGITAL,
      },
      {
        id: "D6017000",
        name: "Ravenloft: The Horrors Within Dungeon Master's Screen",
        format: FORMAT.PHYSICAL,
      },
      {
        id: "D6018000",
        name: "Ravenloft: The Horrors Within Map Pack",
        format: FORMAT.PHYSICAL,
      },
      {
        id: "D6019000",
        name: "Ravenloft: The Horrors Within Tarokka Deck",
        format: FORMAT.PHYSICAL,
      },
      {
        id: "DB6019000",
        name: "Ravenloft: The Horrors Within Tarokka Deck",
        format: FORMAT.DIGITAL,
      },
    ],
    catalog,
  );

  assert.deepEqual(children.find((child) => child.id === "DBR4VNLFT").componentIds, [
    "DB6015000",
    "DM6018000",
  ]);

  const bundle = {
    id: "CBR4VNLFT",
    type: "set",
    children,
  };
  const [satisfied] = ownership.computeNotOwned([bundle], {
    ids: ["DB6015000", "DM6018000", "DB6019000"],
  });
  assert.equal(
    ownership.getRelevantParts(satisfied, FORMAT.DIGITAL).every((child) => child.isOwned),
    true,
  );

  const [missingMap] = ownership.computeNotOwned([bundle], {
    ids: ["DB6015000", "DB6019000"],
  });
  assert.equal(missingMap.children.find((child) => child.id === "DBR4VNLFT").isOwned, false);
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

test("resolves physical products from every storefront format signal", () => {
  assert.equal(ownership.resolveProductFormat({ c_isDigitalProduct: false }), FORMAT.PHYSICAL);
  assert.equal(ownership.resolveProductFormat({ c_productStyle: "Physical" }), FORMAT.PHYSICAL);
  assert.equal(
    ownership.resolveProductFormat({
      variationValues: { "Digital/Physical": "Physical" },
    }),
    FORMAT.PHYSICAL,
  );
  assert.equal(ownership.resolveProductFormat({}, FORMAT.PHYSICAL), FORMAT.PHYSICAL);
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
      { id: "official", isFirstParty: true, type: "item" },
      { primaryCategoryId: "beyond-digital" },
    ),
    "Other",
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

test("extracts public JSON-LD product context without retaining markup", () => {
  const context = ownership.extractProductPageContext(`
    <script type="application/ld+json">{"@type":"Organization","name":"D&D Beyond"}</script>
    <script type="application/ld+json">
      {
        "@type": "Product",
        "name": "Arcana Unleashed: Deadfall",
        "sku": "DB6119000",
        "description": "<p>A complete level 11&ndash;20 adventure &amp; gazetteer.</p>"
      }
    </script>
  `);

  assert.deepEqual(context, {
    name: "Arcana Unleashed: Deadfall",
    sku: "DB6119000",
    description: "A complete level 11-20 adventure & gazetteer.",
  });

  assert.deepEqual(
    ownership.extractProductPageContext(`
      <script type="application/ld+json">
        {"@type":"Product","name":"Arcana Unleashed","sku":"6031000","description":""}
      </script>
      <div class="chakra-text sf-product-short-description css-example">
        <p>Includes <strong>subclasses</strong>, spells, feats, and backgrounds.</p>
      </div>
    `),
    {
      name: "Arcana Unleashed",
      sku: "6031000",
      description: "Includes subclasses, spells, feats, and backgrounds.",
    },
  );

  assert.deepEqual(
    ownership.extractProductPageContext(`
      <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Rogue Starter Pack",
          "sku": "PGWXBIS",
          "description": "This pack contains Character Options from: <em>Player&#x27;s Handbook (5.5e)</em><ul><li>3 subclasses</li></ul><em>Mordenkainen Presents: Monsters of the Multiverse</em><ul><li>2 species</li></ul><em>D&amp;D Beyond Digital Extras</em><ul><li>Digital Dice Set</li></ul><a href=\\"https://marketplace.dndbeyond.com/category/3709000?pid=DB3709000&amp;Digital%2FPhysical=Digital\\">Player’s Handbook (5.5e)</a>"
        }
      </script>
    `),
    {
      contentSources: [
        { name: "Player's Handbook (5.5e)", productId: "3709000" },
        { name: "Mordenkainen Presents: Monsters of the Multiverse" },
      ],
      description:
        "This pack contains Character Options from: Player's Handbook (5.5e) 3 subclasses Mordenkainen Presents: Monsters of the Multiverse 2 species D&D Beyond Digital Extras Digital Dice Set Player’s Handbook (5.5e)",
      name: "Rogue Starter Pack",
      sku: "PGWXBIS",
    },
  );
});

test("infers only high-confidence categories from public product context", () => {
  assert.deepEqual(
    ownership.inferCategoryFromContext(
      { name: "Eberron Species Starter Pack" },
      {
        description:
          "This pack contains Character Options from Eberron: Forge of the Artificer, including 5 species.",
      },
    ),
    {
      category: "Character Options",
      reason: "character-options starter pack",
    },
  );
  assert.deepEqual(
    ownership.inferCategoryFromContext(
      { name: "Wizard Starter Pack" },
      {
        description:
          "This pack contains Character Options from the Player's Handbook, including subclasses, backgrounds, feats, and spells.",
      },
    ),
    {
      category: "Character Options",
      reason: "character-options starter pack",
    },
  );
  assert.deepEqual(
    ownership.inferCategoryFromContext(
      { name: "Arcana Unleashed: Deadfall" },
      { description: "A complete level 11-20 adventure built for high-level play." },
    ),
    { category: "Adventures", reason: "adventure description" },
  );
  assert.deepEqual(
    ownership.inferCategoryFromContext(
      { name: "Arcana Unleashed" },
      {
        description:
          "Includes subclasses, spells, feats, backgrounds, magical items, and creatures.",
      },
    ),
    { category: "Sourcebooks", reason: "multiple player-option signals" },
  );
  assert.deepEqual(ownership.inferCategoryFromContext({ name: "Arcana Unleashed Map Pack" }), {
    category: "Maps",
    reason: "map pack name",
  });
  assert.deepEqual(
    ownership.inferCategoryFromContext({ name: "Ravenloft Dungeon Master's Screen" }),
    { category: "Accessories", reason: "accessory product name" },
  );
  assert.deepEqual(
    ownership.inferCategoryFromContext(
      { name: "A Mysterious Book" },
      { description: "A beautiful volume for your collection." },
    ),
    null,
  );
});

test("resolves and normalizes first-party publisher metadata", () => {
  assert.equal(
    ownership.resolvePublisher({
      c_publisher: "",
      manufacturerName: " Wizards of the Coast ",
    }),
    "Wizards of the Coast",
  );
  assert.equal(ownership.isFirstPartyPublisher("wizards OF THE coast"), true);
  assert.equal(ownership.isFirstPartyPublisher("Independent Publisher"), false);
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

test("marks starter packs covered only when every source book is owned digitally", () => {
  const pack = {
    id: "PGWXBIS",
    coverageSources: [
      { name: "Player's Handbook (5.5e)", productId: "3709000" },
      { name: "Mordenkainen Presents: Monsters of the Multiverse" },
    ],
  };
  const catalog = [
    pack,
    {
      id: "mordenkainen",
      name: "Mordenkainen Presents: Monsters of the Multiverse",
      type: "master",
      variants: [
        { id: "mordenkainen-digital", format: FORMAT.DIGITAL },
        { id: "mordenkainen-physical", format: FORMAT.PHYSICAL },
      ],
    },
  ];

  assert.deepEqual(
    ownership.markCoveredProducts(
      catalog,
      [pack],
      { ids: ["DB3709000", "mordenkainen-digital"] },
      {},
    ),
    [
      {
        ...pack,
        coveredBy: [
          "Player's Handbook (5.5e)",
          "Mordenkainen Presents: Monsters of the Multiverse",
        ],
        isCovered: true,
      },
    ],
  );

  assert.deepEqual(ownership.markCoveredProducts(catalog, [pack], { ids: ["DB3709000"] }, {}), [
    pack,
  ]);
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
