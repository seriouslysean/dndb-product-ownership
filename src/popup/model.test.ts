import { describe, expect, it } from "vitest";

import { FORMAT, PUBLISHER } from "../../constants.js";
import {
  calculateScopeStats,
  groupProducts,
  isMissingForFormat,
  scopedMissingProducts,
} from "./model";
import type { FilterState, Product } from "./types";

const officialDigital: FilterState = {
  format: FORMAT.DIGITAL,
  publisher: PUBLISHER.FIRST_PARTY,
  search: "",
};

const arcana: Product = {
  id: "6119000",
  category: "Adventures",
  format: FORMAT.BOTH,
  isFirstParty: true,
  name: "Arcana Unleashed: Deadfall",
  type: "master",
  variants: [
    { id: "DB6119000", format: FORMAT.DIGITAL, isOwned: false },
    { id: "6119001", format: FORMAT.PHYSICAL, isOwned: false },
  ],
};

describe("audit filtering", () => {
  it("keeps the reported Arcana product in first-party digital adventures", () => {
    const products: Product[] = [
      arcana,
      {
        id: "third-party",
        category: "Third-Party",
        format: FORMAT.DIGITAL,
        isFirstParty: false,
        name: "Community book",
      },
      {
        id: "physical",
        category: "Accessories",
        format: FORMAT.PHYSICAL,
        isFirstParty: true,
        name: "Physical accessory",
      },
    ];

    expect(scopedMissingProducts(products, officialDigital)).toEqual([arcana]);
    expect(groupProducts([arcana])).toEqual([
      { key: "Adventures", badge: "adventure", products: [arcana] },
    ]);
  });

  it("renders starter packs in the Character Options category", () => {
    const starterPack: Product = {
      id: "PYVH5VZ",
      category: "Character Options",
      format: FORMAT.DIGITAL,
      isFirstParty: true,
      name: "Eberron Species Starter Pack",
    };

    expect(groupProducts([starterPack])).toEqual([
      { key: "Character Options", badge: "sourcebook", products: [starterPack] },
    ]);
  });

  it("hides a mixed-format master when its digital variant is owned", () => {
    const product: Product = {
      ...arcana,
      variants: [
        { id: "digital", format: FORMAT.DIGITAL, isOwned: true },
        { id: "physical", format: FORMAT.PHYSICAL, isOwned: false },
      ],
    };

    expect(isMissingForFormat(product, FORMAT.DIGITAL)).toBe(false);
    expect(isMissingForFormat(product, FORMAT.PHYSICAL)).toBe(true);
  });

  it("keeps dismissed and hidden products in the audit total", () => {
    const hiddenBook: Product = {
      id: "book",
      category: "Rulebooks",
      format: FORMAT.DIGITAL,
      isFirstParty: true,
      name: "Rulebook",
    };
    const catalog = [
      arcana,
      hiddenBook,
      {
        id: "owned",
        category: "Dice",
        format: FORMAT.DIGITAL,
        isFirstParty: true,
        name: "Owned dice",
      },
    ];

    expect(
      calculateScopeStats(
        catalog,
        [arcana, hiddenBook],
        officialDigital,
        new Set(["6119000"]),
        new Set(["Rulebooks"]),
      ),
    ).toEqual({
      covered: 0,
      dismissed: 1,
      hidden: 1,
      missing: 2,
      owned: 1,
      total: 3,
      visible: 0,
    });
  });

  it("separates covered packs from actual ownership and actionable gaps", () => {
    const coveredPack: Product = {
      id: "PYVH5VZ",
      category: "Character Options",
      format: FORMAT.DIGITAL,
      isCovered: true,
      isFirstParty: true,
      name: "Eberron Species Starter Pack",
    };

    expect(
      calculateScopeStats([coveredPack], [coveredPack], officialDigital, new Set(), new Set()),
    ).toEqual({
      covered: 1,
      dismissed: 0,
      hidden: 0,
      missing: 0,
      owned: 0,
      total: 1,
      visible: 0,
    });
    expect(
      calculateScopeStats([coveredPack], [coveredPack], officialDigital, new Set(), new Set(), true)
        .missing,
    ).toBe(1);
  });
});
