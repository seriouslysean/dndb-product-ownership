// constants.js and shared.js are loaded before this file

const summaryEl = document.getElementById("summary");
const listEl = document.getElementById("product-list");
const filtersEl = document.getElementById("filters");
const formatToggleEl = document.getElementById("format-toggle");
const publisherToggleEl = document.getElementById("publisher-toggle");
const lastUpdatedEl = document.getElementById("last-updated");
const refreshBtn = document.getElementById("refresh-btn");
const loginGate = document.getElementById("login-gate");
const loginMessage = document.getElementById("login-message");
const syncingGate = document.getElementById("syncing-gate");
const mainContent = document.getElementById("main-content");

let currentData = null;
let hiddenCategories = new Set();
let formatFilter = FORMAT.DIGITAL;
let publisherFilter = "all"; // 'all', 'first-party', 'third-party'

const FORMAT_OPTIONS = [
  { key: FORMAT.DIGITAL, label: "Digital" },
  { key: FORMAT.PHYSICAL, label: "Physical" },
  { key: FORMAT.ALL, label: "All" },
];

const PUBLISHER_OPTIONS = [
  { key: "all", label: "All" },
  { key: "first-party", label: "Official" },
  { key: "third-party", label: "Third-Party" },
];

// --- Categorization (data-driven) ---

const categorizeProduct = (product) => product.category || "Other";

const badgeClassFor = (category) =>
  DISPLAY_CATEGORIES.find((c) => c.key === category)?.badge || "other";

// --- Filters ---

const matchesFormat = (product) => {
  if (formatFilter === FORMAT.ALL) return true;
  const f = product.format || FORMAT.DIGITAL;
  return f === formatFilter || f === FORMAT.BOTH;
};

const matchesPublisher = (product) => {
  if (publisherFilter === "all") return true;
  if (publisherFilter === "first-party") return product.isFirstParty === true;
  return product.isFirstParty !== true;
};

const matchesFilters = (product) => matchesFormat(product) && matchesPublisher(product);

// --- Saved Filter Preferences ---

const loadFilterPrefs = async () => {
  const result = await chrome.storage.local.get(STORAGE.FILTER_PREFS);
  const prefs = result[STORAGE.FILTER_PREFS];
  if (prefs) {
    hiddenCategories = new Set(prefs.hiddenCategories || []);
    formatFilter = prefs.format || FORMAT.DIGITAL;
    publisherFilter = prefs.publisher || "all";
  }
};

const saveFilterPrefs = () => {
  chrome.storage.local.set({
    [STORAGE.FILTER_PREFS]: {
      hiddenCategories: [...hiddenCategories],
      format: formatFilter,
      publisher: publisherFilter,
    },
  });
};

// --- View State ---

const showView = (view) => {
  loginGate.style.display = view === "login" ? "" : "none";
  syncingGate.style.display = view === "syncing" ? "" : "none";
  mainContent.style.display = view === "main" ? "" : "none";
};

// --- Rendering ---

const renderToggle = (container, options, activeKey, onChange) => {
  container.innerHTML = "";
  for (const { key, label } of options) {
    const btn = document.createElement("button");
    btn.className = `format-btn${activeKey === key ? " active" : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", () => {
      onChange(key);
      saveFilterPrefs();
      render(currentData);
    });
    container.appendChild(btn);
  }
};

const renderCategoryChips = (groups) => {
  filtersEl.innerHTML = "";

  for (const { key } of DISPLAY_CATEGORIES) {
    const count = groups[key]?.length || 0;
    if (count === 0) continue;

    const isHidden = hiddenCategories.has(key);
    const chip = document.createElement("button");
    chip.className = `filter-chip${isHidden ? " inactive" : ""}`;
    chip.textContent = `${key} (${count})`;
    chip.title = isHidden ? `Show ${key}` : `Hide ${key}`;
    chip.addEventListener("click", () => {
      if (isHidden) {
        hiddenCategories.delete(key);
      } else {
        hiddenCategories.add(key);
      }
      saveFilterPrefs();
      render(currentData);
    });
    filtersEl.appendChild(chip);
  }
};

const render = (data) => {
  listEl.innerHTML = "";
  summaryEl.textContent = "";
  lastUpdatedEl.textContent = "";

  if (!data) {
    showView("login");
    return;
  }
  if (data.syncing) {
    showView("syncing");
    return;
  }
  if (data.errorCode === ERROR.NOT_AUTHENTICATED) {
    showView("login");
    return;
  }
  if (data.errorCode) {
    showView("main");
    summaryEl.textContent = data.errorMessage || "Something went wrong.";
    summaryEl.style.color = "#e74c3c";
    return;
  }

  showView("main");
  summaryEl.style.color = "";

  const allProducts = data.products || [];
  const products = allProducts.filter(matchesFilters);

  renderToggle(formatToggleEl, FORMAT_OPTIONS, formatFilter, (key) => {
    formatFilter = key;
  });
  renderToggle(publisherToggleEl, PUBLISHER_OPTIONS, publisherFilter, (key) => {
    publisherFilter = key;
  });

  if (allProducts.length === 0) {
    summaryEl.textContent = `You own everything! (${data.ownedCount} of ${data.totalCatalog})`;
    return;
  }

  if (products.length === 0) {
    summaryEl.textContent = `No matching products (${allProducts.length} total not owned)`;
    return;
  }

  const groups = {};
  for (const product of products) {
    const cat = categorizeProduct(product);
    (groups[cat] ??= []).push(product);
  }

  renderCategoryChips(groups);

  let visibleCount = 0;
  let hiddenCount = 0;

  for (const { key } of DISPLAY_CATEGORIES) {
    const group = groups[key];
    if (!group?.length) continue;

    if (hiddenCategories.has(key)) {
      hiddenCount += group.length;
      continue;
    }

    visibleCount += group.length;

    const header = document.createElement("div");
    header.className = "group-header";
    header.textContent = `${key} (${group.length})`;
    listEl.appendChild(header);

    for (const product of group) {
      const url = product.url || endpoints.productPage(product.id);
      const entry = document.createElement("a");
      entry.className = "product-entry";
      entry.href = url;
      entry.addEventListener("click", (e) => {
        e.preventDefault();
        if (url.startsWith(MARKETPLACE_BASE)) chrome.tabs.create({ url });
      });

      const nameEl = document.createElement("span");
      nameEl.className = "product-name";
      nameEl.textContent = product.name || "(unnamed)";

      // Bundle children — filter by active format, recompute counts
      const relevantChildren = (product.children || []).filter(matchesFormat);
      const missingChildren = relevantChildren.filter((c) => !c.isOwned);
      const ownedCount = relevantChildren.length - missingChildren.length;

      if (relevantChildren.length > 0 && ownedCount > 0) {
        const note = document.createElement("span");
        note.className = "product-note";
        note.textContent = ` (${ownedCount}/${relevantChildren.length} owned)`;
        nameEl.appendChild(note);
      }

      if (missingChildren.length > 0) {
        for (const child of missingChildren) {
          const childEl = document.createElement("div");
          childEl.className = "product-child-missing";
          childEl.textContent = child.name || "(unnamed)";
          nameEl.appendChild(childEl);
        }
      }

      const badge = document.createElement("span");
      badge.className = `type-badge ${badgeClassFor(key)}`;
      badge.textContent = key;

      entry.appendChild(nameEl);
      entry.appendChild(badge);
      listEl.appendChild(entry);
    }
  }

  const parts = [`${products.length} not owned, ${data.ownedCount} owned of ${data.totalCatalog}`];
  if (hiddenCount > 0) parts.push(`${hiddenCount} hidden`);
  if (visibleCount !== products.length && visibleCount > 0) parts.push(`showing ${visibleCount}`);
  summaryEl.textContent = parts.join(" · ");

  if (data.lastUpdated) {
    lastUpdatedEl.textContent = `Updated ${new Date(data.lastUpdated).toLocaleString()}`;
  }
};

// --- Actions ---

document.getElementById("open-marketplace").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: `${MARKETPLACE_BASE}/` });
});

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Refreshing...";
  showView("syncing");

  const tabs = await chrome.tabs.query({ url: `${MARKETPLACE_BASE}/*` });

  if (tabs.length === 0) {
    showView("login");
    loginMessage.textContent = "Open marketplace.dndbeyond.com in a tab to refresh.";
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh";
    return;
  }

  chrome.tabs.sendMessage(tabs[0].id, { action: "refresh" }, () => {
    if (chrome.runtime.lastError) {
      showView("login");
      loginMessage.textContent = "Could not reach marketplace tab. Try reloading it.";
    }
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh";
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE.NOT_OWNED]) {
    currentData = changes[STORAGE.NOT_OWNED].newValue || null;
    render(currentData);
  }
});

// --- Init ---

(async () => {
  await loadFilterPrefs();
  const result = await chrome.storage.local.get(STORAGE.NOT_OWNED);
  currentData = result[STORAGE.NOT_OWNED] || null;
  render(currentData);
})();
