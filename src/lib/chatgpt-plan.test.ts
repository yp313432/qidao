import assert from "node:assert/strict";
import { test } from "node:test";
import { chatGptPlanAvailable, getChatGptPlan, readChatGptPlanStatus } from "./chatgpt-plan.ts";

test("the real Android Capacitor proxy stays synchronous and reads local sign-in status", async () => {
  const root = globalThis as typeof globalThis & Record<string, unknown>;
  const savedBridge = root.androidBridge;
  const savedCapacitor = root.Capacitor;
  const status = { connected: false, allowed: false, email: "", hasRegistration: false };
  const calls: string[] = [];
  let freezeStatus = false;
  try {
    root.androidBridge = {};
    root.Capacitor = {
      PluginHeaders: [{ name: "ChatGptPlan", methods: [{ name: "status", rtype: "promise" }] }],
      nativePromise: async (plugin: string, method: string) => {
        assert.equal(plugin, "ChatGptPlan");
        calls.push(method);
        return freezeStatus ? new Promise(() => {}) : status;
      },
    };
    await import("@capacitor/core");

    assert.equal(chatGptPlanAvailable(), true);
    const bridge = getChatGptPlan();
    // The actual Capacitor Proxy has a synthetic "then". Never resolve a promise with this proxy.
    assert.equal(typeof Reflect.get(bridge, "then"), "function");
    assert.equal(getChatGptPlan(), bridge);
    assert.deepEqual(await readChatGptPlanStatus(100), status);
    assert.deepEqual(calls, ["status"]);

    freezeStatus = true;
    await assert.rejects(readChatGptPlanStatus(10), /读取本机 ChatGPT 授权超时/);
  } finally {
    root.Capacitor = savedCapacitor;
    root.androidBridge = savedBridge;
  }
});
