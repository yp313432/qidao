/**
 * 验收：**插件的动效要听宿主的**（规则见 `qidao-docs/规则-插件的动效要听宿主的.md`）
 *
 * 这条规则是真机踩出来的：用户手机上系统开着「关闭动画」时，
 * 栖岛自己的动画被「始终开启」救了回来，但插件里 **JS 画的 canvas** 只听系统，
 * 于是粒子被整段跳过 —— 用户原话："网页里线上有粒子在跑，手机里只有线"。
 *
 * 这个脚本干三件事：
 *   ① 宿主契约还在：`store.ts` 里确实把设置写到了 `<html data-motion>`
 *   ② **每个插件**里凡是读了 `prefers-reduced-motion` 的文件，必须**同时**读 `dataset.motion`
 *   ③ 已知缺口（打包好的 iframe 产物，改不了源码的）**必须登记在案**，不许悄悄漏掉
 *
 * 跑法：`node verify-plugin-motion.mjs`
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const PLUGINS = join(ROOT, "src", "plugins");

let bad = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? `  ${extra}` : ""}`);
  if (!ok) bad++;
};

/** 把注释剥掉 —— 不然"注释里写了这条规则"会被当成真的读了它（这个坑踩过 4 次） */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

function walk(dir, base = dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      out.push(...walk(p, base));
    } else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
      out.push(relative(base, p).replace(/\\/g, "/"));
    }
  }
  return out;
}

console.log("【一】宿主契约：栖岛把「动画」设置写到了 <html data-motion>");
{
  const store = readFileSync(join(ROOT, "src", "lib", "store.ts"), "utf8");
  check(
    "store.ts 里有 root.dataset.motion = settings.motion",
    /root\.dataset\.motion\s*=/.test(stripComments(store)),
  );
  const types = readFileSync(join(ROOT, "src", "lib", "types.ts"), "utf8");
  check(
    "设置里 motion 是 auto / on / off 三态",
    /motion:\s*"auto"\s*\|\s*"on"\s*\|\s*"off"/.test(types),
  );
}

console.log("\n【二】每个插件：读了系统的「减弱动态」，就必须同时读宿主的");
{
  const files = walk(PLUGINS);
  const readSystem = files.filter((f) =>
    /prefers-reduced-motion/.test(stripComments(readFileSync(join(PLUGINS, f), "utf8"))),
  );

  console.log(`   扫了 ${files.length} 个插件源文件，其中读了系统减弱动效的有 ${readSystem.length} 个`);
  check(
    `插件区里确实存在这种文件（不然这条规则没被验证过）`,
    readSystem.length > 0,
    readSystem.join(", "),
  );

  const offenders = readSystem.filter((f) => {
    const code = stripComments(readFileSync(join(PLUGINS, f), "utf8"));
    return !/dataset\.motion/.test(code);
  });
  check(
    "没有「只听系统」的插件文件（有的话就是漏了这条规则）",
    offenders.length === 0,
    offenders.length ? `漏了：${offenders.join(", ")}` : "全部都会先问宿主",
  );

  /* 逐个报一下状态，方便一眼看出谁改过 */
  for (const f of readSystem) {
    const code = stripComments(readFileSync(join(PLUGINS, f), "utf8"));
    const ok = /dataset\.motion/.test(code);
    console.log(`     ${ok ? "✅" : "❌"} ${f}`);
  }
}

console.log("\n【三】已知缺口：改不了源码的（打包产物）必须登记在案");
{
  /**
   * ⚠️ 时感是**已经打包好的独立产物**（`public/shigan/`），源码不在这，改不了。
   * 这个名单的意义是：**不许悄悄漏掉** —— 哪天处理了，就把这行删掉。
   */
  const KNOWN_GAPS = [
    { path: "public/shigan", why: "打包产物：prefers-reduced-motion ×2 / devicePixelRatio ×2，接时感那一趟处理" },
  ];
  for (const gap of KNOWN_GAPS) {
    const exists = existsSync(join(ROOT, gap.path));
    check(`${gap.path} 还在（⇒ 缺口仍然存在，别忘了）`, exists, gap.why);
  }
  const shiganDir = join(ROOT, "public", "shigan");
  if (existsSync(shiganDir)) {
    /* ⚠️ 必须**递归**扫，而且 .css 也要算 —— 第一版只扫了顶层 .js，
       结果报"0 次"，跟事实相反（命中其实在子目录的 app-shell-*.js 和 styles-*.css 里）。
       验收脚本报假数字比不报还坏。 */
    const countIn = (dir, re) => {
      let n = 0;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) n += countIn(p, re);
        else if (/\.(js|css)$/.test(e.name)) {
          n += (readFileSync(p, "utf8").match(re) ?? []).length;
        }
      }
      return n;
    };
    const reducedHits = countIn(shiganDir, /prefers-reduced-motion/g);
    const dprHits = countIn(shiganDir, /devicePixelRatio/g);
    check(
      "时感产物里确实还有那两个坑（这是实测数字，不是猜的）",
      reducedHits > 0,
      `prefers-reduced-motion ${reducedHits} 次 / devicePixelRatio ${dprHits} 次`,
    );
  }
}

console.log("-".repeat(64));
console.log(`「插件的动效要听宿主的」验收：${bad === 0 ? "全部通过" : `${bad} 项失败`}`);
process.exit(bad === 0 ? 0 : 1);
