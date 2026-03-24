const FORMAT = Object.freeze({
  DIGITAL: "digital",
  PHYSICAL: "physical",
  BOTH: "both",
  ALL: "all",
});

const ERROR = Object.freeze({
  NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
  FETCH_FAILED: "FETCH_FAILED",
});

const STORAGE = Object.freeze({
  OWNERSHIP: "dndbpo-product-ownership",
  CATALOG: "dndbpo-product-catalog",
  NOT_OWNED: "dndbpo-not-owned",
  LAST_CATALOG_FETCH: "dndbpo-last-catalog-fetch",
  LICENSES_PAGE: "dndbpo-licenses-page",
  FILTER_PREFS: "dndbpo-filter-prefs",
  VERSION: "dndbpo-version",
});

const FIRST_PARTY_PUBLISHERS = Object.freeze([
  "Wizards of the Coast",
  "Wizards of the Coast & Visionary Production and Design",
]);

// Maps primaryCategoryId → display category
// Derived from navigation tree API:
//   GET /mobify/proxy/ocapi/s/DDBUS/dw/shop/v21_3/categories/root?levels=3&type=navigation
const CATEGORY_BY_API_ID = Object.freeze({
  rulebooks: "Rulebooks",
  "core-rules": "Rulebooks",
  "expanded-rules": "Sourcebooks",
  "expanded-rules-1": "Sourcebooks",
  adventures: "Adventures",
  "digi-adventures": "Adventures",
  settings: "Campaign Settings",
  "digi-dice": "Dice",
  "CP-SIGIL-25": "Creature Packs",
  "BB-ForgottenRealms-25": "Adventures",
  "beyond-digital": "Third-Party",
  "BB-3P-crookedmoon": "Third-Party",
  "BB-3RDPARTY-2025": "Third-Party",
  "all-TTRPG": "Third-Party",
  PROMOTION: "Accessories",
  TTRPG: "Accessories",
});

// Fallback for products in root/none/unmapped/campaign categories
const CATEGORY_FALLBACKS = Object.freeze([
  { test: (p) => p.publisher === "Czepeku", category: "Maps" },
  { test: (p) => /^DM[A-Z0-9]/.test(p.id), category: "Maps" },
  { test: (p) => p.id.startsWith("SC"), category: "Creature Packs" },
  { test: (p) => /^DCE-|^DD\d/.test(p.id), category: "Dice" },
  { test: (p) => !FIRST_PARTY_PUBLISHERS.includes(p.publisher), category: "Third-Party" },
]);

// Display order and badge CSS classes
const DISPLAY_CATEGORIES = Object.freeze([
  { key: "Rulebooks", badge: "sourcebook" },
  { key: "Sourcebooks", badge: "sourcebook" },
  { key: "Adventures", badge: "adventure" },
  { key: "Campaign Settings", badge: "adventure" },
  { key: "Dice", badge: "dice" },
  { key: "Maps", badge: "map" },
  { key: "Creature Packs", badge: "other" },
  { key: "Third-Party", badge: "other" },
  { key: "Accessories", badge: "other" },
  { key: "Other", badge: "other" },
  { key: "Bundles", badge: "bundle" },
]);
