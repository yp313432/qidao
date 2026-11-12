import assert from "node:assert/strict";
import { test } from "node:test";
import { createCrabMotion } from "../src/components/chat/crab-motion.ts";
import { chatCrabSize } from "../src/lib/chat-crab-settings.ts";

test("size choices retain the old largest size and migrate smaller backups", () => {
  assert.deepEqual([28, 32, 36, 44, 52, undefined].map(chatCrabSize), [36, 44, 36, 44, 52, 44]);
});

test("pet moves continuously, preserves position through state changes, wakes and cleans up", () => {
  let now = 0;
  let callback;
  const listeners = new Map();
  const original = {};
  for (const key of ["window", "document", "requestAnimationFrame", "cancelAnimationFrame"])
    original[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const clock = Object.getOwnPropertyDescriptor(performance, "now");
  Object.defineProperty(performance, "now", { configurable: true, value: () => now });
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  globalThis.document = {
    hidden: false,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  globalThis.requestAnimationFrame = (fn) => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => { callback = undefined; };
  const layer = { clientWidth: 390, dataset: {} };
  const actor = { dataset: {}, style: {}, hidden: true, offsetWidth: 56 };
  const options = { width: 44, quiet: false, reduced: false, paused: false, busy: false, working: false };
  const controller = createCrabMotion(layer, actor, () => options);
  const x = () => Number(actor.style.transform?.match(/[-\d.]+/)?.[0] ?? 0);
  const advance = (ms) => {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 16);
      const fn = callback;
      callback = undefined;
      fn?.(now);
    }
  };
  try {
    advance(32);
    assert.equal(actor.hidden, false);
    const positions = [];
    for (let i = 0; i < 1500; i++) { advance(16); positions.push(x()); }
    const deltas = positions.slice(1).map((value, i) => value - positions[i]);
    assert(deltas.some((d) => d > 0.1), "walks right");
    assert(deltas.some((d) => d < -0.1), "walks left");
    assert(deltas.every((d) => Math.abs(d) <= 0.62), "no position jumps between frames");
    const before = x();
    options.busy = true;
    advance(32);
    assert.equal(actor.dataset.pose, "think");
    assert.equal(x(), before);
    options.working = true;
    advance(32);
    assert.equal(actor.dataset.pose, "work");
    assert.equal(x(), before);
    options.working = options.busy = false;
    controller.poke();
    advance(16);
    assert.equal(actor.dataset.pose, "poke");
    assert.equal(x(), before);
    advance(1400);
    assert.notEqual(actor.dataset.pose, "poke");
    options.paused = true;
    advance(32);
    const pausedAt = x();
    advance(2000);
    assert.equal(x(), pausedAt);
    assert.equal(layer.dataset.paused, "true");
    options.paused = false;
    options.reduced = true;
    advance(1000);
    const stillAt = x();
    advance(1000);
    assert.equal(x(), stillAt);
    assert.equal(actor.dataset.reduced, "true");
    options.reduced = false;
    controller.wake();
    advance(46000);
    assert.equal(actor.dataset.pose, "rest");
    controller.poke();
    advance(16);
    assert.equal(actor.dataset.pose, "poke");
    controller.wake();
    advance(1500);
    assert.notEqual(actor.dataset.pose, "rest");
    document.hidden = true;
    listeners.get("visibilitychange")();
    assert.equal(callback, undefined);
    document.hidden = false;
    listeners.get("visibilitychange")();
    assert.equal(typeof callback, "function");
    controller.dispose();
    assert.equal(callback, undefined);
    assert.equal(listeners.size, 0);
  } finally {
    controller.dispose();
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    if (clock) Object.defineProperty(performance, "now", clock);
    else delete performance.now;
  }
});
