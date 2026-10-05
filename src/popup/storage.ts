import { FORMAT, PUBLISHER } from "../../constants.js";
import { DEFAULT_FILTERS } from "./model";
import type { FilterPrefs, PanelData, Product } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const products = (value: unknown): Product[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Product =>
          isRecord(item) && typeof item.id === "string" && item.id.length > 0,
      )
    : [];

export const normalizePanelData = (value: unknown): PanelData | null => {
  if (!isRecord(value)) return null;
  return {
    ...value,
    products: products(value.products),
  } as PanelData;
};

export const normalizeCatalog = (value: unknown): Product[] => products(value);

export const normalizeDismissedIds = (value: unknown): string[] => stringArray(value);

export const normalizeFilterPrefs = (value: unknown): FilterPrefs => {
  const prefs = isRecord(value) ? value : {};
  const validFormats = Object.values(FORMAT) as string[];
  const validPublishers = Object.values(PUBLISHER) as string[];

  return {
    collapsedCategories: stringArray(prefs.collapsedCategories),
    format:
      typeof prefs.format === "string" && validFormats.includes(prefs.format)
        ? prefs.format
        : DEFAULT_FILTERS.format,
    hiddenCategories: stringArray(prefs.hiddenCategories),
    publisher:
      typeof prefs.publisher === "string" && validPublishers.includes(prefs.publisher)
        ? prefs.publisher
        : DEFAULT_FILTERS.publisher,
    showCovered: prefs.showCovered === true,
  };
};
