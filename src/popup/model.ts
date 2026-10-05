import { DISPLAY_CATEGORIES, FORMAT, PUBLISHER } from "../../constants.js";
import { ProductOwnership } from "../../ownership.js";
import type { CategoryGroup, FilterState, Product, ProductPart, ScopeStats } from "./types";

export const DEFAULT_FILTERS: FilterState = Object.freeze({
  format: FORMAT.DIGITAL,
  publisher: PUBLISHER.FIRST_PARTY,
  search: "",
});

export const FORMAT_OPTIONS = Object.freeze([
  { key: FORMAT.DIGITAL, label: "Digital" },
  { key: FORMAT.PHYSICAL, label: "Physical" },
  { key: FORMAT.ALL, label: "All" },
]);

export const PUBLISHER_OPTIONS = Object.freeze([
  { key: PUBLISHER.FIRST_PARTY, label: "First-party" },
  { key: PUBLISHER.THIRD_PARTY, label: "Third-party" },
  { key: PUBLISHER.ALL, label: "All" },
]);

export const categoryOf = (product: Product) => product.category || "Other";

export const matchesPublisher = (product: Product, publisher: string) => {
  if (publisher === PUBLISHER.ALL) return true;
  if (publisher === PUBLISHER.FIRST_PARTY) return product.isFirstParty === true;
  return product.isFirstParty !== true;
};

export const matchesSearch = (product: Product, search: string) => {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return (product.name || "").toLowerCase().includes(query);
};

export const isMissingForFormat = (product: Product, format: string) => {
  if (!ProductOwnership.matchesFormat(product, format)) return false;
  const relevantParts = ProductOwnership.getRelevantParts(product, format);
  return relevantParts.length === 0 || relevantParts.some((part: ProductPart) => !part.isOwned);
};

export const matchesScope = (product: Product, filters: FilterState) =>
  ProductOwnership.matchesFormat(product, filters.format) &&
  matchesPublisher(product, filters.publisher) &&
  matchesSearch(product, filters.search);

export const scopedMissingProducts = (products: Product[], filters: FilterState) =>
  products.filter(
    (product) => matchesScope(product, filters) && isMissingForFormat(product, filters.format),
  );

export const groupProducts = (products: Product[]): CategoryGroup[] => {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    const category = categoryOf(product);
    const group = groups.get(category) || [];
    group.push(product);
    groups.set(category, group);
  }

  return DISPLAY_CATEGORIES.flatMap(({ key, badge }: { key: string; badge: string }) => {
    const group = groups.get(key);
    return group?.length ? [{ key, badge, products: group }] : [];
  });
};

export const calculateScopeStats = (
  catalog: Product[],
  notOwned: Product[],
  filters: FilterState,
  dismissedIds: ReadonlySet<string>,
  hiddenCategories: ReadonlySet<string>,
  includeCovered = false,
): ScopeStats => {
  const scopedCatalog = catalog.filter((product) => matchesScope(product, filters));
  const unowned = scopedMissingProducts(notOwned, filters);
  const covered = unowned.filter((product) => product.isCovered === true).length;
  const missing = includeCovered
    ? unowned
    : unowned.filter((product) => product.isCovered !== true);
  let dismissed = 0;
  let hidden = 0;
  let visible = 0;

  for (const product of missing) {
    if (dismissedIds.has(product.id)) {
      dismissed += 1;
    } else if (hiddenCategories.has(categoryOf(product))) {
      hidden += 1;
    } else {
      visible += 1;
    }
  }

  const total = catalog.length > 0 ? scopedCatalog.length : null;
  return {
    covered,
    dismissed,
    hidden,
    missing: missing.length,
    owned: total === null ? null : Math.max(0, total - unowned.length),
    total,
    visible,
  };
};

export const formatPrice = (price: Product["price"]) => {
  if (price == null) return null;
  const amount = Number(price);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : null;
};

export const scopeLabel = (filters: FilterState) => {
  const publisher =
    filters.publisher === PUBLISHER.FIRST_PARTY
      ? "first-party"
      : filters.publisher === PUBLISHER.THIRD_PARTY
        ? "third-party"
        : "catalog";
  const format = filters.format === FORMAT.ALL ? "" : ` ${filters.format}`;
  return `${publisher}${format} products`;
};
