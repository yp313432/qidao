/** 说明书与路由、权限真源对账。无需启动 App 或联网：node --experimental-strip-types verify-prompt-truth.mjs */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildManual } from './src/lib/manual.ts';
import { PERMISSIONS, defaultPermissions, permissionSnapshot } from './src/lib/permissions.ts';

const input = { displayName: 'yan', aiName: '小克', userGender: '女', titles: PERMISSIONS.map(({id,title}) => ({id,title})) };
const native = buildManual({ ...input, nativeTools: true, permissions: defaultPermissions() });
const compat = buildManual({ ...input, nativeTools: false });
const changed = buildManual({ ...input, nativeTools: true, permissions: { navigate: 'deny', reset_all: 'allow' } });
assert.equal(native, changed, '实时权限不得改变固定说明书');
assert.match(native, /你是小克/);
assert.match(native, /思考链和回答都必须使用中文/);
assert.match(native, /这并不是 Roleplay/);
assert.match(native, /已提交、执行失败、未查到和成功要说清楚/);
assert.match(native, /【栖岛里有什么】/);
assert.match(native, /打开其他 App 不代表能操作其内部/);
assert.match(native, /破坏性操作仍需确认/);
assert.doesNotMatch(native, /纯前端，没有这种通道|以.*名义对外发消息.*做不到|其余 \d+ 项没设|亲手设的|"primaryEmotion"/);
assert.match(compat, /"primaryEmotion"/);
assert.match(compat, /fresh 默认/);
assert.match(compat, /web\.search/);
assert.match(compat, /web\.fetch/);

const routes = new Set(['/']);
function walk(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { walk(path, `${prefix}${entry.name}.`); continue; }
    if (!entry.name.endsWith('.tsx')) continue;
    const parts = `${prefix}${entry.name.slice(0, -4)}`.split('.').filter((part) => part && part !== 'index');
    routes.add('/' + parts.join('/'));
  }
}
walk(join(process.cwd(), 'src/routes/_app'));
const paths = [...native.matchAll(/(?<![\w:/])\/[a-z][a-z0-9/-]*/g)].map((match) => match[0].replace(/\/$/, ''));
for (const path of paths) assert.ok(routes.has(path), `说明书路径不存在：${path}`);

const snapshot = permissionSnapshot({ navigate: 'deny', reset_all: 'allow' });
assert.match(snapshot, /拒绝：[^\n]*切换页面/);
assert.match(snapshot, /需确认：[^\n]*重置设置/);
assert.match(snapshot, /允许：[^\n]*当前设置/);
for (const permission of PERMISSIONS) assert.ok(snapshot.includes(permission.title), `缺少有效权限：${permission.title}`);
console.log(`提示词真值检查通过：固定背景、中文规则、能力边界、原生/兼容模式、${new Set(paths).size} 个页面路径、${PERMISSIONS.length} 项权限。`);
