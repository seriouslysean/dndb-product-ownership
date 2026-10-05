import { describe, expect, it } from "vitest";

import {
  normalizeCatalog,
  normalizeDismissedIds,
  normalizeFilterPrefs,
  normalizePanelData,
} from "./storage";

describe("popup storage normalization", () => {
  it("replaces non-iterable legacy preference values with safe defaults", () => {
    expect(
      normalizeFilterPrefs({
        collapsedCategories: {},
        format: {},
        hiddenCategories: { Other: true },
        publisher: "unknown",
      }),
    ).toEqual({
      collapsedCategories: [],
      format: "digital",
      hiddenCategories: [],
      publisher: "first-party",
      showCovered: false,
    });
    expect(normalizeDismissedIds({ "6119000": true })).toEqual([]);
  });

  it("accepts only arrays of valid products at storage boundaries", () => {
    expect(normalizeCatalog({ "6119000": { id: "6119000" } })).toEqual([]);
    expect(
      normalizeCatalog([
        null,
        {},
        { id: 6119000 },
        { id: "6119000", name: "Arcana Unleashed: Deadfall" },
      ]),
    ).toEqual([{ id: "6119000", name: "Arcana Unleashed: Deadfall" }]);
    expect(normalizePanelData({ products: {} })).toEqual({ products: [] });
  });
});
