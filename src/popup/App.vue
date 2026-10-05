<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import {
  DISPLAY_CATEGORIES,
  ERROR,
  FORMAT,
  PUBLISHER,
  STORAGE,
  SYNC_STAGE,
} from "../../constants.js";
import { MARKETPLACE_BASE } from "../../shared.js";
import CategoryAccordion from "./components/CategoryAccordion.vue";
import SegmentedControl from "./components/SegmentedControl.vue";
import {
  calculateScopeStats,
  categoryOf,
  DEFAULT_FILTERS,
  FORMAT_OPTIONS,
  groupProducts,
  PUBLISHER_OPTIONS,
  scopedMissingProducts,
  scopeLabel,
} from "./model";
import {
  normalizeCatalog,
  normalizeDismissedIds,
  normalizeFilterPrefs,
  normalizePanelData,
} from "./storage";
import type { FilterPrefs, FilterState, PanelData, Product } from "./types";

const STAGE_LABELS: Record<string, string> = {
  [SYNC_STAGE.STARTING]: "Starting sync…",
  [SYNC_STAGE.OWNERSHIP]: "Checking ownership…",
  [SYNC_STAGE.CATALOG]: "Fetching catalog…",
  [SYNC_STAGE.MATCHING]: "Matching products…",
};

const currentData = ref<PanelData | null>(null);
const catalog = ref<Product[]>([]);
const dismissedIds = ref<string[]>([]);
const hiddenCategories = ref<string[]>([]);
const collapsedCategories = ref<string[]>([]);
const format = ref(DEFAULT_FILTERS.format);
const publisher = ref(DEFAULT_FILTERS.publisher);
const search = ref("");
const showCovered = ref(false);
const filtersOpen = ref(false);
const refreshing = ref(false);
const classificationReviewOpen = ref(false);

const filters = computed<FilterState>(() => ({
  format: format.value,
  publisher: publisher.value,
  search: search.value,
}));
const products = computed(() => currentData.value?.products || []);
const dismissedSet = computed(() => new Set(dismissedIds.value));
const hiddenSet = computed(() => new Set(hiddenCategories.value));
const collapsedSet = computed(() => new Set(collapsedCategories.value));
const scopedUnowned = computed(() => scopedMissingProducts(products.value, filters.value));
const scopedMissing = computed(() =>
  showCovered.value
    ? scopedUnowned.value
    : scopedUnowned.value.filter((product) => product.isCovered !== true),
);
const listProducts = computed(() =>
  scopedMissing.value.filter(
    (product) => !dismissedSet.value.has(product.id) && !hiddenSet.value.has(categoryOf(product)),
  ),
);
const groups = computed(() => groupProducts(listProducts.value));
const stats = computed(() =>
  calculateScopeStats(
    catalog.value,
    products.value,
    filters.value,
    dismissedSet.value,
    hiddenSet.value,
    showCovered.value,
  ),
);
const categoryCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const product of scopedMissing.value) {
    if (dismissedSet.value.has(product.id)) continue;
    const category = categoryOf(product);
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return counts;
});
const categoryOptions = computed(() =>
  DISPLAY_CATEGORIES.map(({ key }: { key: string }) => ({
    count: categoryCounts.value.get(key) || 0,
    key,
  })).filter(
    ({ count, key }: { count: number; key: string }) => count > 0 || hiddenSet.value.has(key),
  ),
);
const unclassifiedOfficialProducts = computed(() =>
  scopedMissing.value.filter(
    (product) => product.isFirstParty === true && categoryOf(product) === "Other",
  ),
);
const unclassifiedOfficialCount = computed(() => unclassifiedOfficialProducts.value.length);
const isOfficialDigital = computed(
  () => format.value === FORMAT.DIGITAL && publisher.value === PUBLISHER.FIRST_PARTY,
);
const filterCount = computed(
  () =>
    Number(format.value !== DEFAULT_FILTERS.format) +
    Number(publisher.value !== DEFAULT_FILTERS.publisher) +
    Number(showCovered.value) +
    hiddenCategories.value.length,
);
const view = computed(() => {
  if (!currentData.value) return "login";
  if (currentData.value.syncing) return "syncing";
  if (currentData.value.errorCode) return "login";
  return "main";
});
const summary = computed(() => {
  if (stats.value.total !== null) {
    const status = showCovered.value ? "unowned" : "to review";
    const details = [
      `${stats.value.missing} ${status} of ${stats.value.total} ${scopeLabel(filters.value)}`,
    ];
    if (stats.value.covered > 0) details.push(`${stats.value.covered} covered`);
    if (stats.value.dismissed > 0) details.push(`${stats.value.dismissed} dismissed`);
    if (stats.value.hidden > 0) details.push(`${stats.value.hidden} hidden`);
    return details.join(" · ");
  }

  return `${stats.value.missing} matching unowned products`;
});
const loginMessage = computed(() => {
  if (!currentData.value?.errorCode) {
    return "Sign in to the marketplace so the extension can sync your library.";
  }

  const messages: Record<string, string> = {
    [ERROR.NOT_AUTHENTICATED]: "Sign in to the marketplace so the extension can sync your library.",
    [ERROR.TOKEN_EXPIRED]: "Your marketplace session expired. Sign in again, then refresh.",
    [ERROR.FETCH_FAILED]: "D&D Beyond could not be reached. Check your connection and try again.",
  };
  return messages[currentData.value.errorCode] || "The library could not be loaded.";
});
const lastUpdated = computed(() =>
  currentData.value?.lastUpdated
    ? `Updated ${new Date(currentData.value.lastUpdated).toLocaleString()}`
    : "",
);

const saveFilterPrefs = () => {
  const prefs: FilterPrefs = {
    collapsedCategories: collapsedCategories.value,
    format: format.value,
    hiddenCategories: hiddenCategories.value,
    publisher: publisher.value,
    showCovered: showCovered.value,
  };
  void chrome.storage.local.set({ [STORAGE.FILTER_PREFS]: prefs });
};

const setFormat = (value: string) => {
  format.value = value;
  saveFilterPrefs();
};

const setPublisher = (value: string) => {
  publisher.value = value;
  saveFilterPrefs();
};

const applyOfficialDigital = () => {
  format.value = FORMAT.DIGITAL;
  publisher.value = PUBLISHER.FIRST_PARTY;
  search.value = "";
  hiddenCategories.value = [];
  showCovered.value = false;
  saveFilterPrefs();
};

const toggleCovered = () => {
  showCovered.value = !showCovered.value;
  saveFilterPrefs();
};

const toggleCategoryVisibility = (category: string) => {
  hiddenCategories.value = hiddenSet.value.has(category)
    ? hiddenCategories.value.filter((value) => value !== category)
    : [...hiddenCategories.value, category];
  saveFilterPrefs();
};

const toggleCollapsed = (category: string) => {
  collapsedCategories.value = collapsedSet.value.has(category)
    ? collapsedCategories.value.filter((value) => value !== category)
    : [...collapsedCategories.value, category];
  saveFilterPrefs();
};

const expandAll = () => {
  collapsedCategories.value = [];
  saveFilterPrefs();
};

const collapseAll = () => {
  collapsedCategories.value = groups.value.map((group) => group.key);
  saveFilterPrefs();
};

const dismissProduct = (productId: string) => {
  if (dismissedSet.value.has(productId)) return;
  dismissedIds.value = [...dismissedIds.value, productId];
  void chrome.storage.local.set({ [STORAGE.DISMISSED]: dismissedIds.value });
};

const undismissAll = () => {
  dismissedIds.value = [];
  void chrome.storage.local.set({ [STORAGE.DISMISSED]: [] });
};

const openMarketplace = () => {
  void chrome.tabs.create({ url: `${MARKETPLACE_BASE}/` });
};

const openProduct = (url: string) => {
  if (url.startsWith(MARKETPLACE_BASE)) void chrome.tabs.create({ url });
};

const refresh = () => {
  if (refreshing.value) return;
  refreshing.value = true;
  currentData.value = { syncing: true, stage: SYNC_STAGE.STARTING };

  chrome.runtime.sendMessage({ action: "refresh" }, () => {
    if (chrome.runtime.lastError) {
      currentData.value = {
        errorCode: ERROR.FETCH_FAILED,
        errorMessage: chrome.runtime.lastError.message,
      };
    }
    refreshing.value = false;
  });
};

const storageListener = (changes: Record<string, chrome.storage.StorageChange>) => {
  if (changes[STORAGE.NOT_OWNED]) {
    currentData.value = normalizePanelData(changes[STORAGE.NOT_OWNED].newValue);
  }
  if (changes[STORAGE.CATALOG]) {
    catalog.value = normalizeCatalog(changes[STORAGE.CATALOG].newValue);
  }
  if (changes[STORAGE.DISMISSED]) {
    dismissedIds.value = normalizeDismissedIds(changes[STORAGE.DISMISSED].newValue);
  }
  if (changes[STORAGE.FILTER_PREFS]) {
    const prefs = normalizeFilterPrefs(changes[STORAGE.FILTER_PREFS].newValue);
    format.value = prefs.format;
    publisher.value = prefs.publisher;
    hiddenCategories.value = prefs.hiddenCategories;
    collapsedCategories.value = prefs.collapsedCategories;
    showCovered.value = prefs.showCovered;
  }
};

onMounted(async () => {
  const result = await chrome.storage.local.get([
    STORAGE.NOT_OWNED,
    STORAGE.CATALOG,
    STORAGE.FILTER_PREFS,
    STORAGE.DISMISSED,
  ]);
  const prefs = normalizeFilterPrefs(result[STORAGE.FILTER_PREFS]);

  currentData.value = normalizePanelData(result[STORAGE.NOT_OWNED]);
  catalog.value = normalizeCatalog(result[STORAGE.CATALOG]);
  dismissedIds.value = normalizeDismissedIds(result[STORAGE.DISMISSED]);
  format.value = prefs.format;
  publisher.value = prefs.publisher;
  hiddenCategories.value = prefs.hiddenCategories;
  collapsedCategories.value = prefs.collapsedCategories;
  showCovered.value = prefs.showCovered;
  chrome.storage.onChanged.addListener(storageListener);

  if (currentData.value?.errorCode === ERROR.FETCH_FAILED) refresh();
});

onBeforeUnmount(() => {
  chrome.storage.onChanged.removeListener(storageListener);
});
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div>
        <p class="app-header__eyebrow">Ownership audit</p>
        <h1 class="app-header__title">D&amp;D Beyond Library</h1>
      </div>
      <button
        v-if="view === 'main'"
        class="icon-button"
        :class="{ 'icon-button--active': filtersOpen }"
        type="button"
        :aria-expanded="filtersOpen"
        aria-label="Filter settings"
        title="Filter settings"
        @click="filtersOpen = !filtersOpen"
      >
        <span aria-hidden="true">☰</span>
        <span v-if="filterCount > 0" class="icon-button__count">{{ filterCount }}</span>
      </button>
      <p v-if="view === 'main'" class="app-header__summary">{{ summary }}</p>
    </header>

    <section v-if="view === 'login'" class="gate">
      <div class="gate__icon" aria-hidden="true">⚔</div>
      <h2 class="gate__title">Marketplace sign-in needed</h2>
      <p class="gate__message">{{ loginMessage }}</p>
      <div class="gate__actions">
        <button class="button button--primary" type="button" @click="openMarketplace">
          Open marketplace
        </button>
        <button v-if="currentData?.errorCode" class="button" type="button" @click="refresh">
          Try again
        </button>
      </div>
    </section>

    <section v-else-if="view === 'syncing'" class="gate" aria-live="polite">
      <div class="gate__spinner"></div>
      <h2 class="gate__title">Syncing your library</h2>
      <p class="gate__message">{{ STAGE_LABELS[currentData?.stage || ""] || "Syncing…" }}</p>
    </section>

    <template v-else>
      <aside v-if="filtersOpen" class="filter-panel" aria-label="Filters">
        <div class="filter-panel__section">
          <div class="filter-panel__heading">
            <span>Quick scope</span>
            <button class="text-button" type="button" @click="applyOfficialDigital">Reset</button>
          </div>
          <button
            class="scope-button"
            :class="{ 'scope-button--active': isOfficialDigital }"
            type="button"
            :aria-pressed="isOfficialDigital"
            @click="applyOfficialDigital"
          >
            <span class="scope-button__mark" aria-hidden="true">✓</span>
            <span>
              <strong>First-party digital</strong>
              <small>Books, adventures, dice, and other official content</small>
            </span>
          </button>
        </div>

        <fieldset class="filter-panel__section">
          <legend class="filter-panel__label">Format</legend>
          <SegmentedControl
            label="Format"
            :model-value="format"
            :options="FORMAT_OPTIONS"
            @update:model-value="setFormat"
          />
        </fieldset>

        <fieldset class="filter-panel__section">
          <legend class="filter-panel__label">Publisher</legend>
          <SegmentedControl
            label="Publisher"
            :model-value="publisher"
            :options="PUBLISHER_OPTIONS"
            @update:model-value="setPublisher"
          />
        </fieldset>

        <fieldset v-if="categoryOptions.length > 0" class="filter-panel__section">
          <legend class="filter-panel__label">Categories</legend>
          <div class="category-filters">
            <button
              v-for="option in categoryOptions"
              :key="option.key"
              class="category-filter"
              :class="{ 'category-filter--hidden': hiddenSet.has(option.key) }"
              type="button"
              :aria-pressed="!hiddenSet.has(option.key)"
              @click="toggleCategoryVisibility(option.key)"
            >
              <span>{{ option.key }}</span>
              <span class="category-filter__count">{{ option.count }}</span>
            </button>
          </div>
        </fieldset>

        <fieldset v-if="stats.covered > 0" class="filter-panel__section">
          <legend class="filter-panel__label">Covered products</legend>
          <button
            class="scope-button"
            :class="{ 'scope-button--active': showCovered }"
            type="button"
            :aria-pressed="showCovered"
            @click="toggleCovered"
          >
            <span class="scope-button__mark" aria-hidden="true">
              {{ showCovered ? "✓" : stats.covered }}
            </span>
            <span>
              <strong>Show covered starter packs</strong>
              <small>Your books cover their listed character options; extras may differ</small>
            </span>
          </button>
        </fieldset>

        <div class="filter-panel__footer">
          <p>{{ stats.owned ?? currentData?.ownedCount ?? 0 }} owned in this scope</p>
          <button
            class="text-button"
            type="button"
            :disabled="dismissedIds.length === 0"
            @click="undismissAll"
          >
            Restore {{ dismissedIds.length }} dismissed
          </button>
        </div>
      </aside>

      <main class="main-content">
        <div class="toolbar">
          <button
            class="audit-chip"
            :class="{ 'audit-chip--active': isOfficialDigital }"
            type="button"
            :aria-pressed="isOfficialDigital"
            @click="applyOfficialDigital"
          >
            First-party digital
          </button>
          <div class="search-box" role="search">
            <label class="search-box__label" for="product-search">Search products</label>
            <input
              id="product-search"
              v-model.trim="search"
              class="search-box__input"
              type="search"
              placeholder="Search…"
            />
          </div>
        </div>

        <div
          v-if="unclassifiedOfficialCount > 0"
          class="classification-alert"
          role="region"
          aria-label="Unclassified first-party products"
        >
          <div class="classification-alert__header">
            <p>
              <strong
                >{{ unclassifiedOfficialCount }} first-party product<span
                  v-if="unclassifiedOfficialCount !== 1"
                  >s</span
                >
                {{ unclassifiedOfficialCount === 1 ? "needs" : "need" }} review.</strong
              >
              The marketplace did not provide a usable category, so they remain under Other.
            </p>
            <button
              class="classification-alert__toggle"
              type="button"
              :aria-expanded="classificationReviewOpen"
              @click="classificationReviewOpen = !classificationReviewOpen"
            >
              {{ classificationReviewOpen ? "Hide list" : `Review ${unclassifiedOfficialCount}` }}
            </button>
          </div>
          <ul v-if="classificationReviewOpen" class="classification-alert__list">
            <li
              v-for="product in unclassifiedOfficialProducts"
              :key="product.id"
              class="classification-alert__item"
            >
              <a
                class="classification-alert__link"
                :href="product.url"
                @click.prevent="product.url && openProduct(product.url)"
              >
                {{ product.name || "(unnamed)" }}
              </a>
              <span v-if="dismissedSet.has(product.id)" class="classification-alert__state">
                Dismissed
              </span>
              <span v-if="hiddenSet.has('Other')" class="classification-alert__state">
                Category hidden
              </span>
              <span v-if="product.primaryCategoryId" class="classification-alert__state">
                Upstream: {{ product.primaryCategoryId }}
              </span>
            </li>
          </ul>
        </div>

        <div v-if="groups.length > 0" class="list-controls">
          <span>{{ stats.visible }} shown</span>
          <span class="list-controls__actions">
            <button class="text-button" type="button" @click="expandAll">Expand all</button>
            <button class="text-button" type="button" @click="collapseAll">Collapse all</button>
          </span>
        </div>

        <div v-if="groups.length > 0" class="category-list">
          <CategoryAccordion
            v-for="group in groups"
            :key="group.key"
            :category="group.key"
            :collapsed="collapsedSet.has(group.key)"
            :format="format"
            :products="group.products"
            @dismiss="dismissProduct"
            @open="openProduct"
            @toggle="toggleCollapsed(group.key)"
          />
        </div>

        <section v-else class="empty-state">
          <div class="empty-state__mark" aria-hidden="true">✓</div>
          <h2 class="empty-state__title">
            {{
              stats.missing === 0
                ? stats.covered > 0
                  ? "This scope is covered"
                  : "This scope is complete"
                : "Nothing visible"
            }}
          </h2>
          <p class="empty-state__message">
            <template v-if="stats.missing === 0 && stats.covered > 0">
              Your books cover every remaining starter pack in this scope. You can reveal covered
              products from the filter menu.
            </template>
            <template v-else-if="stats.missing === 0">
              You own every {{ scopeLabel(filters) }} item in the current catalog.
            </template>
            <template v-else>
              Matching unowned products are hidden, dismissed, or outside the search.
            </template>
          </p>
        </section>
      </main>

      <footer class="app-footer">
        <time class="app-footer__updated">{{ lastUpdated }}</time>
        <button
          class="button button--compact"
          type="button"
          :disabled="refreshing"
          @click="refresh"
        >
          {{ refreshing ? "Refreshing…" : "Refresh" }}
        </button>
      </footer>
    </template>
  </div>
</template>
