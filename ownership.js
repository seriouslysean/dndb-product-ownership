import { CATEGORY_BY_API_ID, CATEGORY_FALLBACKS, FORMAT } from "./constants.js";

export const ProductOwnership = (() => {
  const getVariantFormat = (variationValues, fallback = FORMAT.DIGITAL) => {
    const values = Object.values(variationValues || {}).map((value) => String(value).toLowerCase());
    const hasDigital = values.includes(FORMAT.DIGITAL);
    const hasPhysical = values.includes(FORMAT.PHYSICAL);

    if (hasDigital && hasPhysical) return FORMAT.BOTH;
    if (hasDigital) return FORMAT.DIGITAL;
    if (hasPhysical) return FORMAT.PHYSICAL;
    return fallback;
  };

  const matchesFormat = (product, format) => {
    const productFormat = product.format || FORMAT.DIGITAL;
    return format === FORMAT.ALL || productFormat === format || productFormat === FORMAT.BOTH;
  };

  const getOwnershipParts = (product) => {
    if (product.type === "master") return product.variants || [];
    if (product.type === "set") return product.children || [];
    return [];
  };

  const getRelevantParts = (product, format) =>
    getOwnershipParts(product).filter((part) => matchesFormat(part, format));

  const isIdOwned = (productId, licensedIds, idAliases) => {
    if (licensedIds.has(productId) || licensedIds.has(`DB${productId}`)) return true;

    const aliases = idAliases[productId];
    return (Array.isArray(aliases) ? aliases : [aliases]).some(
      (alias) => alias && licensedIds.has(alias),
    );
  };

  const computeNotOwned = (catalog, ownership, idAliases = {}) => {
    const licensedIds = new Set(ownership.ids || []);
    const owned = (id) => isIdOwned(id, licensedIds, idAliases);
    const notOwned = [];

    for (const product of catalog) {
      if (owned(product.id)) continue;

      const parts = getOwnershipParts(product);
      if (parts.length === 0) {
        notOwned.push(product);
        continue;
      }

      const taggedParts = parts.map((part) => ({ ...part, isOwned: owned(part.id) }));
      if (taggedParts.every((part) => part.isOwned)) continue;

      const partsKey = product.type === "master" ? "variants" : "children";
      notOwned.push({ ...product, [partsKey]: taggedParts });
    }

    return notOwned;
  };

  const mergeSourceIds = (sources) => {
    const availableSources = sources.filter(Array.isArray);
    if (availableSources.length === 0) return null;
    return [...new Set(availableSources.flat())];
  };

  const resolveCategory = (entry, product, onUnmapped = () => {}) => {
    if (entry.type === "set") return "Bundles";

    const mapped = CATEGORY_BY_API_ID[product.primaryCategoryId];
    if (mapped) return mapped;

    if (product.primaryCategoryId === "everything-else") {
      return product.c_isDigitalProduct ? "Creature Packs" : "Accessories";
    }

    const fallback = CATEGORY_FALLBACKS.find(({ test }) => test(entry));
    if (fallback) return fallback.category;

    if (
      product.primaryCategoryId &&
      product.primaryCategoryId !== "root" &&
      product.primaryCategoryId !== "none"
    ) {
      onUnmapped(product.primaryCategoryId);
    }

    return "Other";
  };

  const extractLicenseIds = (html) => {
    const ids = [];
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowPattern.exec(html)) !== null) {
      const cell = rowMatch[1].match(/<td\b[^>]*>([\s\S]*?)<\/td>/i);
      if (!cell) continue;

      const id = cell[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&(?:nbsp|#160);/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();
      if (id) ids.push(id);
    }

    return ids;
  };

  return Object.freeze({
    computeNotOwned,
    extractLicenseIds,
    getRelevantParts,
    getVariantFormat,
    matchesFormat,
    mergeSourceIds,
    resolveCategory,
  });
})();
