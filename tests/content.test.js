import assert from "node:assert/strict";
import test from "node:test";

test("content script sends and serves the current marketplace token", async () => {
  let listener;
  let initialMessage;

  globalThis.document = {
    cookie: "other=value; token_DDBUS=Bearer%20signed-token; another=value",
  };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener: (registered) => {
          listener = registered;
        },
      },
      sendMessage: (message, callback) => {
        initialMessage = message;
        callback();
      },
    },
  };

  await import("../content.js");

  assert.deepEqual(initialMessage, {
    action: "sync",
    authToken: "Bearer signed-token",
  });

  let response;
  listener({ action: "get-auth-token" }, {}, (value) => {
    response = value;
  });
  assert.deepEqual(response, { authToken: "Bearer signed-token" });
});

test("content script rejects an expired JWT before starting a sync", async () => {
  let listener;
  let initialMessage;
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString(
    "base64url",
  );

  globalThis.document = {
    cookie: `token_DDBUS=${encodeURIComponent(`Bearer header.${payload}.signature`)}`,
  };
  globalThis.chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener: (registered) => {
          listener = registered;
        },
      },
      sendMessage: (message, callback) => {
        initialMessage = message;
        callback();
      },
    },
  };

  await import(`../content.js?expired=${Date.now()}`);

  assert.deepEqual(initialMessage, { action: "sync", authToken: null });

  let response;
  listener({ action: "get-auth-token" }, {}, (value) => {
    response = value;
  });
  assert.deepEqual(response, { authToken: null });
});
