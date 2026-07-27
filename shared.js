export const Logger = {
  log: (...msgs) => console.log("[DNDBPO]:", ...msgs),
  warn: (...msgs) => console.warn("[DNDBPO]:", ...msgs),
  error: (...msgs) => console.error("[DNDBPO]:", ...msgs),
};

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const API_ORG = "f_ecom_bfst_prd";
const API_SITE = "DDBUS";
const API_BASE = "/mobify/proxy/api";
const OCAPI_BASE = `/mobify/proxy/ocapi/s/${API_SITE}/dw/shop/v21_3`;
export const LICENSES_PAGE_URL = "https://www.dndbeyond.com/account/licenses";
export const MARKETPLACE_BASE = "https://marketplace.dndbeyond.com";

export const endpoints = {
  productSearch: (offset = 0, limit = 200) => {
    const params = new URLSearchParams({
      refine: "cgid=root",
      offset,
      limit,
      siteId: API_SITE,
    });
    return `${API_BASE}/search/shopper-search/v1/organizations/${API_ORG}/product-search?${params}`;
  },
  productDetails: (ids, expand = "") => {
    const params = new URLSearchParams({
      ids: ids.join(","),
      allImages: "false",
      siteId: API_SITE,
    });
    if (expand) params.set("expand", expand);
    return `${API_BASE}/product/shopper-products/v1/organizations/${API_ORG}/products?${params}`;
  },
  customerProfile: (customerId) =>
    `${API_BASE}/customer/shopper-customers/v1/organizations/${API_ORG}/customers/${customerId}?siteId=${API_SITE}`,
  orderHistory: (offset, limit) =>
    `${OCAPI_BASE}/custom_objects/CustomAPI/GetOrderHistory?offset=${offset}&limit=${limit}&refineBy={}`,
  productPage: (productId) => `${MARKETPLACE_BASE}/category/${productId}`,
};

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const BATCH_DELAY_MS = 300;

export const batchProcess = async (items, batchSize, fetchFn) => {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    if (i > 0) await delay(BATCH_DELAY_MS);
    const batch = items.slice(i, i + batchSize);
    results.push({ batch, data: await fetchFn(batch) });
  }
  return results;
};

export const paginateFetch = async (
  fetchPage,
  { limit = 100, wait = () => delay(BATCH_DELAY_MS) } = {},
) => {
  const all = [];
  let offset = 0;

  while (true) {
    const page = await fetchPage(offset, limit);
    const items = Array.isArray(page) ? page : page?.items || [];
    const total = Array.isArray(page) ? null : Number(page?.total);

    if (items.length === 0) break;
    all.push(...items);

    const reachedEnd = Number.isFinite(total) ? all.length >= total : items.length < limit;
    if (reachedEnd) break;

    offset += items.length;
    await wait();
  }

  return all;
};
