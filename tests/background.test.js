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

  globalThis.fetch = async (url) => {
    fetches.push(url);
    return {
      ok: true,
      json: async () => ({ $schema: "description", catalog: "license" }),
    };
  };

  await import("../background.js");
  await Promise.resolve();

  assert.equal(typeof listeners.message, "function");
  assert.equal(typeof listeners.installed, "function");
  assert.deepEqual(fetches, ["chrome-extension://test/id-aliases.json"]);
});
