import assert from "node:assert/strict";
import test from "node:test";

import manifest from "../manifest.json" with { type: "json" };
import viteConfig from "../vite.config.ts";

test("builds side-panel assets relative to the dist HTML", () => {
  assert.equal(viteConfig.base, "./");
  assert.equal(manifest.side_panel.default_path, "dist/popup.html");
});
