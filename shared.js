// constants.js is loaded before this file

const Logger = {
  log: (...msgs) => console.log("[DNDBPO]:", ...msgs),
  warn: (...msgs) => console.warn("[DNDBPO]:", ...msgs),
  error: (...msgs) => console.error("[DNDBPO]:", ...msgs),
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const API_ORG = "f_ecom_bfst_prd";
const API_SITE = "DDBUS";
const API_BASE = "/mobify/proxy/api";
const OCAPI_BASE = `/mobify/proxy/ocapi/s/${API_SITE}/dw/shop/v21_3`;
const LICENSES_PAGE_URL = "https://www.dndbeyond.com/account/licenses";
const MARKETPLACE_BASE = "https://marketplace.dndbeyond.com";

const endpoints = {
  productSearch: (limit = 200) =>
    `${API_BASE}/search/shopper-search/v1/organizations/${API_ORG}/product-search?refine=cgid%3Droot&limit=${limit}&siteId=${API_SITE}`,
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BATCH_DELAY_MS = 300;

const batchProcess = async (items, batchSize, fetchFn) => {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    if (i > 0) await delay(BATCH_DELAY_MS);
    const batch = items.slice(i, i + batchSize);
    results.push({ batch, data: await fetchFn(batch) });
  }
  return results;
};

const paginateFetch = async (fetchPage) => {
  const all = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const items = await fetchPage(offset, limit);
    if (!items?.length) break;
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
    await delay(BATCH_DELAY_MS);
  }

  return all;
};
