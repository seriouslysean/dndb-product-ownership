import assert from "node:assert/strict";
import test from "node:test";

test("background service worker loads as a module and registers its listeners", async () => {
  const listeners = {};
  const fetches = [];

  globalThis.chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      onInstalled: {
        addListener: (listener) => {
          listeners.installed = listener;
        },
      },
      onMessage: {
        addListener: (listener) => {
          listeners.message = listener;
        },
      },
    },
    scripting: {
      executeScript: async () => {},
    },
    sidePanel: {
      setPanelBehavior: async () => {},
    },
    storage: {
      local: {
        get: async () => ({}),
        getBytesInUse: async () => 0,
        remove: async () => {},
        set: async () => {},
      },
    },
    tabs: {
      query: async () => [],
      sendMessage: async () => ({}),
    },
  };

  let apiRequestCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    fetches.push(url);
    if (url.startsWith("https://marketplace.dndbeyond.com/")) {
      apiRequestCount += 1;
      assert.equal(
        options.headers.Authorization,
        apiRequestCount === 1 ? "Bearer stale-token" : "Bearer fresh-token",
      );
      return {
        ok: apiRequestCount > 1,
        status: apiRequestCount === 1 ? 401 : 200,
      };
    }
    return {
      ok: true,
      json: async () => ({ $schema: "description", catalog: "license" }),
    };
  };

  const { BackgroundTesting } = await import("../background.js");
  await Promise.resolve();

  assert.equal(typeof listeners.message, "function");
  assert.equal(typeof listeners.installed, "function");
  assert.deepEqual(fetches, ["chrome-extension://test/id-aliases.json"]);

  globalThis.chrome.tabs.query = async () => [{ id: 1 }];
  globalThis.chrome.tabs.sendMessage = async () => ({ authToken: "Bearer fresh-token" });
  BackgroundTesting.setAuthToken("Bearer stale-token");

  const response = await BackgroundTesting.bgFetch("/test");

  assert.equal(response.status, 200);
  assert.equal(apiRequestCount, 2);
  assert.equal(BackgroundTesting.getAuthToken(), "Bearer fresh-token");

  listeners.message({ authToken: null }, {}, () => {});
  assert.equal(BackgroundTesting.getAuthToken(), null);
});
