#!/usr/bin/env node
/**
 * 把「安卓目标」构建出来的静态资源搬到 `dist/`。
 *
 * 为什么需要这一步：QIDAO_TARGET=android 时走的是 SPA 构建，
 * 但 nitro 仍按平台预设把纯静态那部分放在 `.vercel/output/static/`
 * （那是 vercel 预设的目录约定）。Capacitor 只认一个 `webDir`，
 * 所以这里做一次搬运，把位置固定成 `dist/`。
 *
 * 这一步是**纯文件复制**，不起子进程 —— 免得在受限环境里踩 spawn 的坑。
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const CANDIDATES = [".vercel/output/static", ".output/public", "dist/client", "dist"];
const DEST = "dist";

function isStaticDir(dir) {
  try {
    return statSync(join(dir, "index.html")).isFile();
  } catch {
    return false;
  }
}

const src = CANDIDATES.find((d) => existsSync(d) && isStaticDir(d));
if (!src) {
  console.error(
    `[copy-static] 找不到含 index.html 的静态产物（找过：${CANDIDATES.join(", ")}）`,
  );
  console.error("[copy-static] 先跑：QIDAO_TARGET=android VITE_DIRECT_UPSTREAM=1 npm run build");
  process.exit(1);
}

if (src === DEST) {
  console.log("[copy-static] 产物本来就在 dist/，不用搬。");
  process.exit(0);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(src, DEST, { recursive: true });

console.log(`[copy-static] 已把 ${src} 复制到 ${DEST}/`);
