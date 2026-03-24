/**
 * Fetch product fixtures from the D&D Beyond marketplace API.
 *
 * Usage:
 *   1. Open https://marketplace.dndbeyond.com/ in Chrome (logged in)
 *   2. Open DevTools console
 *   3. Paste this script and run it
 *   4. Copy the output JSON and save to fixtures/products.json
 *
 * To add/remove products, edit the PRODUCT_IDS array and the REASONS map.
 */

const PRODUCT_IDS = [
  "tashas-cauldron-of-everything", // master: digital+physical variants, slug ID
  "SRC-00028", // item: digital sourcebook, direct ID match
  "C5666000", // item: physical-only (spellbook cards)
  "DCE-02101", // item: dice, license ID mismatch (DCE-02100 on license page)
  "Q4AXQ3W", // master: third-party in root, no category match
  "core-rulebook-bundle", // set: mixed digital+physical children
  "CBSC8KM3L", // set: digital-only children, multi-publisher
];

const REASONS = {
  "tashas-cauldron-of-everything":
    "Master with Digital+Physical variants. Category: expanded-rules → Sourcebooks. Ownership: variant ID SRC-00067 (digital) in licensed list.",
  "SRC-00028":
    "Digital item. Category: expanded-rules → Sourcebooks. License ID matches catalog ID directly.",
  C5666000:
    "Physical-only item. Category: everything-else + physical → Accessories. No digital variant.",
  "DCE-02101":
    "Dice with license ID mismatch. Catalog: DCE-02101, license page: DCE-02100. Matched via name fallback.",
  Q4AXQ3W:
    "Third-party master in root. Falls through CATEGORY_FALLBACKS to Third-Party via non-first-party publisher.",
  "core-rulebook-bundle":
    "Bundle with 3 digital + 3 physical children. In Digital mode, hidden if all 3 digital children owned.",
  CBSC8KM3L:
    "Digital-only bundle in root. Multi-publisher (WotC + Visionary). All children digital.",
};

const KEEP_FIELDS = [
  "id",
  "name",
  "type",
  "primaryCategoryId",
  "c_publisher",
  "c_productStyle",
  "c_isDigitalProduct",
  "c_ddbProductId",
];

const slimProduct = (p) => {
  const slim = {};
  for (const key of KEEP_FIELDS) {
    if (p[key] !== undefined) slim[key] = p[key];
  }
  if (p.variants) {
    slim.variants = p.variants.map((v) => ({
      productId: v.productId,
      variationValues: v.variationValues,
    }));
  }
  if (p.setProducts) {
    slim.setProducts = p.setProducts.map((sp) => ({
      id: sp.id,
      name: sp.name,
      type: sp.type,
      c_isDigitalProduct: sp.c_isDigitalProduct,
      c_productStyle: sp.c_productStyle,
    }));
  }
  return slim;
};

(async () => {
  const tokenCookie = document.cookie.match(/token_DDBUS=([^;]+)/);
  if (!tokenCookie) {
    console.error("Not logged in — no token_DDBUS cookie found");
    return;
  }
  const token = decodeURIComponent(tokenCookie[1]).trim();

  const results = [];
  for (const id of PRODUCT_IDS) {
    const resp = await fetch(
      `/mobify/proxy/api/product/shopper-products/v1/organizations/f_ecom_bfst_prd/products/${id}?expand=set_products&allImages=false&siteId=DDBUS`,
      { headers: { Authorization: token } },
    );
    if (!resp.ok) {
      console.warn(`Failed to fetch ${id}: ${resp.status}`);
      continue;
    }
    const product = slimProduct(await resp.json());
    product._reason = REASONS[id] || "No reason specified";
    results.push(product);
  }

  const json = JSON.stringify(results, null, 2);
  console.log(json);
  console.log(
    `\n✅ ${results.length} fixtures fetched. Copy the JSON above to fixtures/products.json`,
  );
})();
