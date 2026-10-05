import {
  CATEGORY_BY_API_ID,
  CATEGORY_FALLBACKS,
  FIRST_PARTY_PUBLISHERS,
  FORMAT,
} from "./constants.js";

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

  const resolveProductFormat = (product, fallback = FORMAT.DIGITAL) => {
    const productStyle = String(product?.c_productStyle || product?.c_productType || "").toLowerCase();
    if (productStyle === FORMAT.PHYSICAL) return FORMAT.PHYSICAL;
    if (productStyle === FORMAT.DIGITAL) return FORMAT.DIGITAL;
    if (product?.c_isDigitalProduct === false) return FORMAT.PHYSICAL;
    if (product?.c_isDigitalProduct === true) return FORMAT.DIGITAL;
    return getVariantFormat(product?.variationValues, fallback);
  };

  const getOwnershipParts = (product) => {
    if (product.type === "master") return Array.isArray(product.variants) ? product.variants : [];
    if (product.type === "set") return Array.isArray(product.children) ? product.children : [];
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

      const taggedParts = parts.map((part) => ({
        ...part,
        isOwned:
          owned(part.id) ||
          (Array.isArray(part.componentIds) &&
            part.componentIds.length > 0 &&
            part.componentIds.every(owned)),
      }));
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

  const resolvePublisher = (product) => {
    for (const value of [product.c_publisher, product.manufacturerName]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };

  const isFirstPartyPublisher = (publisher) => {
    if (typeof publisher !== "string") return false;
    const normalized = publisher.trim().toLowerCase();
    return FIRST_PARTY_PUBLISHERS.some((candidate) => candidate.toLowerCase() === normalized);
  };

  const resolveCategory = (entry, product, onUnmapped = () => {}) => {
    if (entry.type === "set") return "Bundles";

    const mapped = CATEGORY_BY_API_ID[product.primaryCategoryId];
    if (mapped && !(mapped === "Third-Party" && entry.isFirstParty)) return mapped;

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

  const extractProductPageContext = (html) => {
    const htmlToText = (value) =>
      String(value || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&(?:nbsp|#160);/gi, " ")
        .replace(/&(?:mdash|ndash);/gi, "-")
        .replace(/&(?:rsquo|lsquo);/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/&amp;/gi, "&")
        .replace(/&#x([0-9a-f]+);/gi, (_match, entity) =>
          String.fromCodePoint(Number.parseInt(entity, 16)),
        )
        .replace(/&#(\d+);/g, (_match, entity) => String.fromCodePoint(Number(entity)))
        .replace(/\s+/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .trim();
    const normalizeName = (value) =>
      htmlToText(value)
        .normalize("NFKD")
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const extractContentSources = (descriptionMarkup) => {
      const markup = String(descriptionMarkup || "");
      const marker = /contains Character Options from:/i.exec(markup);
      if (!marker) return [];

      const afterMarker = markup.slice(marker.index + marker[0].length);
      const extrasMarker = /D&amp;D Beyond Digital Extras|D&D Beyond Digital Extras/i.exec(
        afterMarker,
      );
      const sourcesMarkup = extrasMarker
        ? afterMarker.slice(0, extrasMarker.index)
        : afterMarker;
      const sourceNames = [
        ...sourcesMarkup.matchAll(/<em\b[^>]*>([\s\S]*?)<\/em>/gi),
      ]
        .map((match) => htmlToText(match[1]))
        .filter(Boolean);
      if (sourceNames.length === 0) return [];

      const links = [...markup.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
        .map((match) => {
          const href = match[1].replace(/&amp;/gi, "&");
          const productId = href.match(/marketplace\.dndbeyond\.com\/category\/([^?/#&"']+)/i)?.[1];
          return productId
            ? {
                name: normalizeName(match[2]),
                productId,
              }
            : null;
        })
        .filter(Boolean);

      return sourceNames.map((name) => {
        const link = links.find((candidate) => candidate.name === normalizeName(name));
        return link ? { name, productId: link.productId } : { name };
      });
    };
    const scripts =
      html.match(
        /<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/gi,
      ) || [];
    let context = null;

    for (const script of scripts) {
      const contents = script
        .replace(/^<script\b[^>]*>/i, "")
        .replace(/<\/script>$/i, "")
        .trim();

      try {
        const parsed = JSON.parse(contents);
        const candidates = [
          ...(Array.isArray(parsed) ? parsed : [parsed]),
          ...(Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : []),
        ];
        const products = candidates.filter((item) => {
          const types = Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]];
          return types.includes("Product");
        });

        for (const product of products) {
          const contentSources = extractContentSources(product.description);
          const candidate = {
            description: htmlToText(product.description),
            name: typeof product.name === "string" ? product.name : null,
            sku: typeof product.sku === "string" ? product.sku : null,
            ...(contentSources.length > 0 ? { contentSources } : {}),
          };
          if (!context || candidate.description.length > context.description.length) {
            context = candidate;
          }
        }
      } catch {
        // Ignore malformed structured-data blocks and continue to the next one.
      }
    }

    const renderedDescription = html.match(
      /<div\b[^>]*class=["'][^"']*\bsf-product-short-description\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    )?.[1];
    const description = htmlToText(renderedDescription);
    if (description.length > (context?.description.length || 0)) {
      const contentSources = extractContentSources(renderedDescription);
      context = {
        description,
        name: context?.name || null,
        sku: context?.sku || null,
        ...(contentSources.length > 0 ? { contentSources } : {}),
      };
    }

    return context;
  };

  const inferCategoryFromContext = (entry, context = {}) => {
    const name = String(entry.name || context.name || "");
    const description = String(context.description || "");
    const text = `${name} ${description}`.toLowerCase();
    const named = (pattern) => pattern.test(name);
    const described = (pattern) => pattern.test(description);

    const directNameRules = [
      { category: "Maps", pattern: /\b(?:battle )?maps? pack\b/i, reason: "map pack name" },
      {
        category: "Dice",
        pattern: /\b(?:digital )?dice(?: set)?\b/i,
        reason: "dice product name",
      },
      {
        category: "Creature Packs",
        pattern: /\b(?:creature|monster) pack\b/i,
        reason: "creature pack name",
      },
      {
        category: "Accessories",
        pattern:
          /\b(?:dungeon master(?:'s|s)? screen|dm screen|reference cards?|tarokka deck|card deck)\b/i,
        reason: "accessory product name",
      },
      {
        category: "Rulebooks",
        pattern:
          /\b(?:player's handbook|players handbook|dungeon master's guide|dungeon masters guide|monster manual|basic rules|core rulebook)\b/i,
        reason: "core rulebook name",
      },
    ];
    const directRule = directNameRules.find(({ pattern }) => named(pattern));
    if (directRule) return { category: directRule.category, reason: directRule.reason };

    if (
      named(/\b(?:class|species) starter pack\b/i) ||
      described(/\b(?:this )?pack contains character options from\b/i)
    ) {
      return { category: "Character Options", reason: "character-options starter pack" };
    }

    if (described(/\b(?:campaign setting|setting guide)\b/i)) {
      return { category: "Campaign Settings", reason: "campaign-setting description" };
    }

    if (described(/\b(?:sourcebook|rulebook)\b/i)) {
      return { category: "Sourcebooks", reason: "sourcebook description" };
    }

    const playerOptionSignals = [
      /\bsubclasses?\b/i,
      /\bspells?\b/i,
      /\bfeats?\b/i,
      /\bbackgrounds?\b/i,
      /\bmagic(?:al)? items?\b/i,
      /\b(?:monsters?|creatures?)\b/i,
    ].filter((pattern) => pattern.test(text)).length;
    if (playerOptionSignals >= 4) {
      return { category: "Sourcebooks", reason: "multiple player-option signals" };
    }

    if (
      described(
        /\b(?:complete (?:level(?:s)? [\d–—-]+ )?adventure|adventure (?:built|designed|written) for|adventure anthology|\d+[- ]chapter adventure)\b/i,
      )
    ) {
      return { category: "Adventures", reason: "adventure description" };
    }

    return null;
  };

  const normalizeProductName = (value) =>
    String(value || "")
      .normalize("NFKD")
      .replace(/[’‘]/g, "'")
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .toLowerCase();

  const resolveBundleComponents = (children, catalog) => {
    if (!Array.isArray(children) || !Array.isArray(catalog)) return [];

    const directDigitalNames = new Set(
      children
        .filter(
          (child) =>
            child.format === FORMAT.DIGITAL && !/\bdigital bundle$/i.test(child.name || ""),
        )
        .map((child) => normalizeProductName(child.name))
        .filter(Boolean),
    );
    const catalogByName = new Map();
    for (const product of catalog) {
      const name = normalizeProductName(product.name);
      if (name && !catalogByName.has(name)) catalogByName.set(name, product);
    }

    return children.map((child) => {
      if (child.format !== FORMAT.DIGITAL) return child;
      const match = String(child.name || "").match(/^(.*?)\s+Digital Bundle$/i);
      if (!match) return child;
      const baseName = normalizeProductName(match[1]);
      const componentIds = [
        ...new Set(
          children
            .filter((candidate) => candidate.format === FORMAT.PHYSICAL)
            .filter((candidate) => {
              const name = normalizeProductName(candidate.name);
              return (
                (name === baseName || name.startsWith(`${baseName} `)) &&
                !directDigitalNames.has(name)
              );
            })
            .flatMap((candidate) => {
              const product = catalogByName.get(normalizeProductName(candidate.name));
              return getOwnershipParts(product || {})
                .filter((part) => matchesFormat(part, FORMAT.DIGITAL))
                .map((part) => part.id);
            }),
        ),
      ];

      return componentIds.length >= 2 ? { ...child, componentIds } : child;
    });
  };

  const markCoveredProducts = (catalog, notOwned, ownership, idAliases = {}) => {
    const licensedIds = new Set(Array.isArray(ownership?.ids) ? ownership.ids : []);
    const owned = (id) => isIdOwned(id, licensedIds, idAliases);
    const catalogByName = new Map();

    for (const product of catalog) {
      const name = normalizeProductName(product.name);
      if (name && !catalogByName.has(name)) catalogByName.set(name, product);
    }

    const ownsProductDigitally = (product) => {
      if (owned(product.id)) return true;
      const parts = getOwnershipParts(product).filter((part) =>
        matchesFormat(part, FORMAT.DIGITAL),
      );
      return parts.length > 0 && parts.every((part) => owned(part.id));
    };

    return notOwned.map((product) => {
      const sources = Array.isArray(product.coverageSources) ? product.coverageSources : [];
      if (sources.length === 0) return product;

      const isCovered = sources.every((source) => {
        if (source?.productId && owned(source.productId)) return true;
        const sourceProduct = catalogByName.get(normalizeProductName(source?.name));
        return sourceProduct ? ownsProductDigitally(sourceProduct) : false;
      });

      return isCovered
        ? {
            ...product,
            isCovered: true,
            coveredBy: sources.map((source) => source.name),
          }
        : product;
    });
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
    extractProductPageContext,
    getRelevantParts,
    getVariantFormat,
    inferCategoryFromContext,
    isFirstPartyPublisher,
    markCoveredProducts,
    matchesFormat,
    mergeSourceIds,
    resolveCategory,
    resolveBundleComponents,
    resolveProductFormat,
    resolvePublisher,
  });
})();
