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
