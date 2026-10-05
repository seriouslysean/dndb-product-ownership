import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";

import { FORMAT } from "../../../constants.js";
import type { Product } from "../types";
import CategoryAccordion from "./CategoryAccordion.vue";

const mountedApps: ReturnType<typeof createApp>[] = [];

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  document.body.innerHTML = "";
});

describe("CategoryAccordion", () => {
  it("exposes accordion state and renders the corrected product", async () => {
    const collapsed = ref(false);
    const products: Product[] = [
      {
        id: "6119000",
        category: "Adventures",
        format: FORMAT.DIGITAL,
        isFirstParty: true,
        name: "Arcana Unleashed: Deadfall",
        url: "https://marketplace.dndbeyond.com/category/6119000",
      },
    ];
    const Harness = defineComponent(
      () => () =>
        h(CategoryAccordion, {
          category: "Adventures",
          collapsed: collapsed.value,
          format: FORMAT.DIGITAL,
          products,
          onToggle: () => {
            collapsed.value = !collapsed.value;
          },
        }),
    );
    const host = document.createElement("div");
    document.body.append(host);
    const app = createApp(Harness);
    mountedApps.push(app);
    app.mount(host);

    const header = host.querySelector<HTMLButtonElement>(".category-card__header");
    const chevron = host.querySelector<SVGElement>(".category-card__chevron");
    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(chevron?.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(chevron?.querySelector("path")?.getAttribute("d")).toBe("m4 6 4 4 4-4");
    expect(host.textContent).toContain("Arcana Unleashed: Deadfall");

    header?.click();
    await nextTick();

    expect(header?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector<HTMLElement>(".category-card__body")?.style.display).toBe("none");
  });
});
