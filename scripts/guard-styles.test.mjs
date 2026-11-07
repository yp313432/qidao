import test from "node:test";
import assert from "node:assert/strict";

import { auditLayerFile, auditModeFile, runGuard } from "./guard-styles.mjs";

const MODE = "src/styles/modes/solid.css";
const TOKENS = "src/styles/tokens.css";

test("模式文件只写 --k-* 变量时通过", () => {
  const css = `[data-material="solid"] {\n  --k-border-w: 2px;\n  --k-card-radius: 2px;\n}\n`;
  assert.deepEqual(auditModeFile(MODE, css), []);
});

test("模式文件里冒出类名选择器会被拦下（补丁回潮）", () => {
  const violations = auditModeFile(
    MODE,
    `[data-material="solid"] .tool-card { --k-border-w: 2px; }`,
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /只许用属性选择器/);
});

test("模式文件里写间距/字号这类样式会被拦下", () => {
  const violations = auditModeFile(MODE, `[data-material="solid"] {\n  padding: 6px;\n}`);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /只许写 --k-\*/);
});

test("模式文件里不带 data-material 的属性选择器会被拦下", () => {
  const violations = auditModeFile(MODE, `[data-theme="dusk"] {\n  --k-line: red;\n}`);
  assert.ok(violations.some((v) => /必须带 data-material/.test(v.message)));
});

test("模式文件里出现 @media 会被拦下（条件样式属于 kit）", () => {
  const violations = auditModeFile(
    MODE,
    `@media (min-width: 30em) {\n[data-material="solid"] {\n  --k-s-1: 3px;\n}\n}`,
  );
  assert.ok(violations.some((v) => /不许出现 @media/.test(v.message)));
});

test("分层文件里色值字面量和模式选择器都会被拦下", () => {
  const hex = auditLayerFile(TOKENS, `:root {\n  --k-fg: #1c1917;\n}`);
  assert.equal(hex.length, 1);
  assert.match(hex[0].message, /色值字面量/);

  const material = auditLayerFile(
    TOKENS,
    `[data-material="solid"] {\n  --k-fg: var(--aster-fg);\n}`,
  );
  assert.equal(material.length, 1);
  assert.match(material[0].message, /不许出现 \[data-material/);
});

test("当前仓库通过样式守卫", () => {
  const result = runGuard();
  assert.equal(result.ok, true, JSON.stringify(result.violations, null, 2));
});
