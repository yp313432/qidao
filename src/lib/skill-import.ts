import { mcpFetch } from "./mcp-fetch.ts";
import { packagesFromSkillFiles, SKILL_LIMITS, type SkillFile, type SkillPackage } from "./skills.ts";
import { readSkillZip } from "./skill-zip.ts";

export async function importSkillFile(file: File): Promise<SkillPackage[]> {
  if (file.size > SKILL_LIMITS.archive) throw new Error("文件超过 16MB");
  if (/\.zip$/i.test(file.name)) return packagesFromSkillFiles(await readSkillZip(await file.arrayBuffer()), file.name);
  if (/\.md$/i.test(file.name)) return packagesFromSkillFiles([{ path: "SKILL.md", data: await file.text(), encoding: "utf8" }], file.name);
  throw new Error("请选择 SKILL.md 或 ZIP 压缩包");
}

/** Public GitHub API works in browsers too; credentials are never forwarded to a repository. */
export async function importSkillGitHub(raw: string): Promise<SkillPackage[]> {
  const url = new URL(raw.trim());
  if (url.hostname !== "github.com" || url.protocol !== "https:") throw new Error("请填写 https://github.com 上的仓库或目录地址");
  const parts = url.pathname.split("/").filter(Boolean);
  const owner = parts[0], repo = parts[1]?.replace(/\.git$/, "");
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw new Error("GitHub 仓库地址不完整");
  const signal = AbortSignal.timeout(60000);
  const api = async (path: string) => {
    const response = await mcpFetch(`https://api.github.com/repos/${owner}/${repo}/${path}`, { signal, headers: { accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}，请检查公开仓库地址或稍后再试`);
    return response.json();
  };
  const info = await api("") as { default_branch?: string };
  const branch = parts[2] === "tree" || parts[2] === "blob" ? parts[3] : info.default_branch;
  if (!branch) throw new Error("没有找到仓库分支");
  const prefix = parts.length > 4 ? parts.slice(4).join("/").replace(/\/?skill\.md$/i, "") : "";
  const tree = await api(`git/trees/${encodeURIComponent(branch)}?recursive=1`) as { truncated?: boolean; tree?: { path: string; type: string; sha: string; size?: number }[] };
  if (tree.truncated) throw new Error("仓库过大，请改为下载具体 Skill 的 ZIP 导入");
  const candidates = (tree.tree ?? []).filter((f) => f.type === "blob" && (!prefix || f.path === prefix || f.path.startsWith(prefix + "/")));
  const roots = candidates.filter((f) => /(^|\/)skill\.md$/i.test(f.path)).map((f) => f.path.slice(0, f.path.lastIndexOf("/") + 1));
  if (!roots.length) throw new Error("这个目录没有找到 SKILL.md");
  const selected = candidates.filter((f) => roots.some((root) => f.path.startsWith(root)));
  if (selected.length > SKILL_LIMITS.files || selected.reduce((n, f) => n + (f.size ?? 0), 0) > SKILL_LIMITS.total) throw new Error("Skill 文件过多或过大，请填写更具体的目录地址");
  const files: SkillFile[] = [];
  for (const entry of selected) {
    if ((entry.size ?? 0) > SKILL_LIMITS.file) throw new Error("Skill 单个文件超过 1MB");
    const blob = await api(`git/blobs/${entry.sha}`) as { encoding?: string; content?: string; size?: number };
    if (blob.encoding !== "base64" || typeof blob.content !== "string" || (blob.size ?? 0) > SKILL_LIMITS.file) throw new Error("GitHub 文件内容不可用或过大");
    const encoded = blob.content.replace(/\s/g, "");
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    try { const data = new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (data.includes("\0")) throw new Error("binary"); files.push({ path: entry.path, data, encoding: "utf8" }); }
    catch { files.push({ path: entry.path, data: encoded, encoding: "base64" }); }
  }
  return packagesFromSkillFiles(files, url.href);
}
