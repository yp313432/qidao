import { createFileRoute } from "@tanstack/react-router";
import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

/**
 * 工作区清单：请求时**实时扫盘**，所以永远是最新的（不用重新生成）。
 *
 * 这是**本地开发工具**：部署到 Serverless 后源码通常不在运行时目录里，
 * 那时它会如实返回失败，页面会告诉你原因。
 *
 * 变更记录优先读 `git log`；项目不是 git 仓库时退回到 changelog.json。
 */

const run = promisify(execFile);

const ROOTS = ["src", "public", "scripts"];
const LOOSE = ["package.json", "changelog.json", "vite.config.ts", "tsconfig.json", "AGENTS.md"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".output",
  ".tanstack",
  "dist",
  "build",
  ".vercel",
  ".vite",
  "__grok",
]);
const TEXT_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|json|md|html?|svg|txt|ya?ml|toml)$/i;
const MAX_FILE_BYTES = 512 * 1024;

export type WsFile = { type: "file"; name: string; path: string; bytes: number; lines: number };
export type WsDir = { type: "dir"; name: string; path: string; children: (WsFile | WsDir)[] };
export type WsNote = {
  at: string;
  title: string;
  detail: string;
  files: string[];
  source: "git" | "changelog";
};

async function walk(abs: string, rel: string, depth: number): Promise<WsDir | null> {
  let items: Dirent[];
  try {
    items = await readdir(abs, { withFileTypes: true });
  } catch {
    return null;
  }

  const children: (WsFile | WsDir)[] = [];
  for (const it of items) {
    if (it.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(it.name)) continue;
    const childAbs = path.join(abs, it.name);
    const childRel = `${rel}/${it.name}`;

    if (it.isDirectory()) {
      if (depth > 6) continue;
      const dir = await walk(childAbs, childRel, depth + 1);
      if (dir) children.push(dir);
      continue;
    }

    let bytes = 0;
    let lines = 0;
    try {
      const st = await stat(childAbs);
      bytes = st.size;
      if (TEXT_EXT.test(it.name) && bytes <= MAX_FILE_BYTES) {
        const txt = await readFile(childAbs, "utf8");
        lines = txt.length ? txt.split("\n").length : 0;
      }
    } catch {
      /* 读不到就留 0 */
    }
    children.push({ type: "file", name: it.name, path: childRel, bytes, lines });
  }

  children.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1,
  );
  return { type: "dir", name: path.basename(abs), path: rel, children };
}

function countAll(roots: WsDir[], loose: WsFile[]) {
  let files = roots.length + loose.length;
  let dirs = 0;
  let lines = loose.reduce((n, f) => n + f.lines, 0);
  let bytes = loose.reduce((n, f) => n + f.bytes, 0);

  const visit = (d: WsDir) => {
    dirs += 1;
    for (const c of d.children) {
      if (c.type === "dir") visit(c);
      else {
        files += 1;
        lines += c.lines;
        bytes += c.bytes;
      }
    }
  };
  for (const r of roots) visit(r);
  return { files, dirs, lines, bytes };
}

async function gitNotes(cwd: string): Promise<WsNote[] | null> {
  try {
    const { stdout } = await run(
      "git",
      ["log", "--name-only", "--date=iso-strict", "--pretty=format:@@%cI|%s", "-n", "60"],
      { cwd, maxBuffer: 8 * 1024 * 1024 },
    );
    const out: WsNote[] = [];
    let cur: WsNote | null = null;
    for (const line of stdout.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith("@@")) {
        if (cur) out.push(cur);
        const idx = t.indexOf("|");
        const at = t.slice(2, idx > 0 ? idx : undefined);
        const title = idx > 0 ? t.slice(idx + 1) : "(无标题)";
        cur = { at, title, detail: "", files: [], source: "git" };
      } else if (cur) {
        cur.files.push(t);
      }
    }
    if (cur) out.push(cur);
    return out.length ? out : null;
  } catch {
    return null;
  }
}

async function changelogNotes(cwd: string): Promise<WsNote[]> {
  try {
    const raw = await readFile(path.join(cwd, "changelog.json"), "utf8");
    const json = JSON.parse(raw) as { entries?: WsNote[] };
    return (json.entries ?? []).map((e) => ({ ...e, source: "changelog" as const }));
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/api/workspace")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const cwd = process.cwd();
          const roots: WsDir[] = [];
          for (const r of ROOTS) {
            const dir = await walk(path.join(cwd, r), r, 0);
            if (dir) roots.push(dir);
          }

          const loose: WsFile[] = [];
          for (const name of LOOSE) {
            try {
              const st = await stat(path.join(cwd, name));
              let lines = 0;
              if (TEXT_EXT.test(name) && st.size <= MAX_FILE_BYTES) {
                const txt = await readFile(path.join(cwd, name), "utf8");
                lines = txt.length ? txt.split("\n").length : 0;
              }
              loose.push({ type: "file", name, path: name, bytes: st.size, lines });
            } catch {
              /* 不存在就算了 */
            }
          }

          const git = await gitNotes(cwd);
          const entries = git ?? (await changelogNotes(cwd));

          return Response.json({
            ok: true,
            generatedAt: Date.now(),
            roots,
            loose,
            entries,
            source: git ? "git" : "changelog",
            totals: countAll(roots, loose),
          });
        } catch (err) {
          return Response.json({ ok: false, message: (err as Error).message ?? "读取失败" });
        }
      },

      /**
       * 追加一条变更记录 —— 这是「记录改动」权限落到磁盘的地方。
       *
       * 只在能写文件的运行时可用（本地开发就是）；Serverless 上会如实报错。
       */
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            title?: string;
            detail?: string;
            files?: string[];
          };
          const title = (body.title ?? "").trim();
          if (!title) return Response.json({ ok: false, message: "记录得有标题" });

          const file = path.join(process.cwd(), "changelog.json");
          let json: { note?: string; entries?: WsNote[] } = {};
          try {
            json = JSON.parse(await readFile(file, "utf8")) as typeof json;
          } catch {
            json = {};
          }

          const entry: WsNote = {
            at: new Date().toISOString(),
            title: title.slice(0, 120),
            detail: (body.detail ?? "").trim().slice(0, 600),
            files: (body.files ?? [])
              .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
              .map((f) => f.trim().slice(0, 200))
              .slice(0, 20),
            source: "changelog",
          };

          json.note = json.note ?? "Agent 与 AI 的改动登记表。";
          json.entries = [entry, ...(json.entries ?? [])].slice(0, 200);
          await writeFile(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");

          return Response.json({ ok: true, entry, total: json.entries.length });
        } catch (err) {
          return Response.json({
            ok: false,
            message: `写不进去：${(err as Error).message ?? "未知错误"}（部署到 Serverless 后通常不允许运行时写文件）`,
          });
        }
      },
    },
  },
});
