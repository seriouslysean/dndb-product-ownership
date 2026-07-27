import assert from "node:assert/strict";
import test from "node:test";

import { endpoints, paginateFetch } from "../shared.js";

test("product search endpoints include explicit offset and limit", () => {
  const url = new URL(endpoints.productSearch(200, 50), "https://marketplace.dndbeyond.com");

  assert.equal(url.searchParams.get("refine"), "cgid=root");
  assert.equal(url.searchParams.get("offset"), "200");
  assert.equal(url.searchParams.get("limit"), "50");
  assert.equal(url.searchParams.get("siteId"), "DDBUS");
});

test("pagination follows the reported total using actual page lengths", async () => {
  const calls = [];
  const pages = [
    { items: ["one", "two"], total: 3 },
    { items: ["three"], total: 3 },
  ];

  const result = await paginateFetch(
    async (offset, limit) => {
      calls.push({ offset, limit });
      return pages.shift();
    },
    { limit: 2, wait: async () => {} },
  );

  assert.deepEqual(result, ["one", "two", "three"]);
  assert.deepEqual(calls, [
    { offset: 0, limit: 2 },
    { offset: 2, limit: 2 },
  ]);
});

test("pagination supports array-only APIs and stops on a short page", async () => {
  const pages = [["one", "two"], ["three"]];

  const result = await paginateFetch(async () => pages.shift(), {
    limit: 2,
    wait: async () => {},
  });

  assert.deepEqual(result, ["one", "two", "three"]);
});
