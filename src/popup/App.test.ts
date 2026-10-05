import { createApp, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STORAGE } from "../../constants.js";
import App from "./App.vue";
import type { Product } from "./types";

const mountedApps: ReturnType<typeof createApp>[] = [];

const mountWithStorage = async (stored: Record<string, unknown>) => {
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>) => void>();
  vi.stubGlobal("chrome", {
    runtime: {
      get lastError() {
        return undefined;
      },
      sendMessage(_message: unknown, callback?: () => void) {
        callback?.();
      },
    },
    storage: {
      local: {
        async get() {
          return stored;
        },
        async set() {},
      },
      onChanged: {
        addListener(listener: (changes: Record<string, chrome.storage.StorageChange>) => void) {
          listeners.add(listener);
        },
        removeListener(listener: (changes: Record<string, chrome.storage.StorageChange>) => void) {
          listeners.delete(listener);
        },
      },
    },
    tabs: {
      async create() {
        return {};
      },
    },
  });

  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp(App);
  mountedApps.push(app);
  app.mount(host);

  await Promise.resolve();
  await nextTick();
  return host;
};

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("App", () => {
  it("renders the search control after extension storage loads", async () => {
    const host = await mountWithStorage({
      [STORAGE.CATALOG]: [],
      [STORAGE.DISMISSED]: [],
      [STORAGE.NOT_OWNED]: {
        ownedCount: 0,
        products: [],
        totalCatalog: 0,
      },
    });

    const search = host.querySelector<HTMLInputElement>(
      'input[type="search"][aria-label], input[type="search"]',
    );
    expect(search).not.toBeNull();
    expect(search?.id).toBe("product-search");
  });

  it("reveals every unclassified product without changing hidden or dismissed state", async () => {
    const product: Product = {
      id: "unclassified",
      category: "Other",
      format: "digital",
      isFirstParty: true,
      name: "Unclassified Official Product",
      url: "https://marketplace.dndbeyond.com/category/unclassified",
    };
    const host = await mountWithStorage({
      [STORAGE.CATALOG]: [product],
      [STORAGE.DISMISSED]: [product.id],
      [STORAGE.FILTER_PREFS]: {
        format: "digital",
        hiddenCategories: ["Other"],
        publisher: "first-party",
      },
      [STORAGE.NOT_OWNED]: {
        ownedCount: 0,
        products: [product],
        totalCatalog: 1,
      },
    });

    const toggle = host.querySelector<HTMLButtonElement>(".classification-alert__toggle");
    expect(host.textContent).toContain("1 first-party product needs review.");
    expect(toggle?.textContent).toContain("Review 1");
    toggle?.click();
    await nextTick();

    expect(host.querySelector(".classification-alert__link")?.textContent).toContain(product.name);
    expect(host.textContent).toContain("Dismissed");
    expect(host.textContent).toContain("Category hidden");
  });

  it("renders safely when an existing installation contains non-iterable stored values", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const product: Product = {
      id: "legacy-cache",
      category: "Other",
      format: "digital",
      isFirstParty: true,
      name: "Legacy Cached Product",
      type: "master",
      variants: {} as Product["variants"],
    };

    const host = await mountWithStorage({
      [STORAGE.CATALOG]: [product],
      [STORAGE.DISMISSED]: {},
      [STORAGE.FILTER_PREFS]: {
        collapsedCategories: {},
        format: "digital",
        hiddenCategories: {},
        publisher: "first-party",
      },
      [STORAGE.NOT_OWNED]: {
        products: [product],
        totalCatalog: 1,
      },
    });

    expect(host.textContent).toContain("Legacy Cached Product");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("hides covered starter packs by default and lets the user reveal them", async () => {
    const coveredPack: Product = {
      id: "PYVH5VZ",
      category: "Character Options",
      coveredBy: ["Eberron: Forge of the Artificer"],
      format: "digital",
      isCovered: true,
      isFirstParty: true,
      name: "Eberron Species Starter Pack",
    };
    const host = await mountWithStorage({
      [STORAGE.CATALOG]: [coveredPack],
      [STORAGE.NOT_OWNED]: {
        ownedCount: 0,
        products: [coveredPack],
        totalCatalog: 1,
      },
    });

    expect(host.textContent).toContain("This scope is covered");
    expect(host.querySelector('[data-product-id="PYVH5VZ"]')).toBeNull();

    host.querySelector<HTMLButtonElement>('[aria-label="Filter settings"]')?.click();
    await nextTick();
    const toggle = [...host.querySelectorAll<HTMLButtonElement>(".scope-button")].find((button) =>
      button.textContent?.includes("Show covered starter packs"),
    );
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");

    toggle?.click();
    await nextTick();

    expect(host.querySelector('[data-product-id="PYVH5VZ"]')).not.toBeNull();
    expect(host.textContent).toContain("Covered by Eberron: Forge of the Artificer");
  });
});
