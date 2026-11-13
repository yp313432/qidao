import { useState } from "react";
import { FileButton } from "@/components/shared/file-button";
import { KButton, KEmpty, KSwitch } from "@/components/ui-kit";
import { ToolCard } from "./tool-card";
import { useApp } from "@/lib/store";
import { importSkillFile, importSkillGitHub } from "@/lib/skill-import";
import type { SkillPackage } from "@/lib/skills";

export function SkillManager() {
  const skills = useApp((s) => s.skills);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [repo, setRepo] = useState(""), [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  async function install(load: () => Promise<SkillPackage[]>) {
    setBusy(true); setMessage("");
    try { const packages = await load(); useApp.getState().addSkills(packages); setMessage(`已导入 ${packages.length} 个 Skill，已启用`); }
    catch (error) { setMessage((error as Error).message || "导入失败"); }
    finally { setBusy(false); }
  }
  return <div className="k-list">
    <div className="k-sect"><h2 className="k-sect__title">Skills · {skills.length} 个</h2></div>
    <div className="k-card k-list">
      <FileButton accept=".zip,.md" ariaLabel="导入 Skill 文件" className="k-btn" onPick={(files) => {
        const file = files[0]; if (file && !busy) void install(() => importSkillFile(file));
      }}>{busy ? "正在导入…" : "导入 SKILL.md / ZIP"}</FileButton>
      <label className="k-field"><span>GitHub 仓库或 Skill 目录</span>
        <input className="k-input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/作者/仓库/tree/main/技能目录" />
      </label>
      <KButton disabled={busy || !repo.trim()} onClick={() => void install(() => importSkillGitHub(repo))}>从 GitHub 导入</KButton>
      <p className="k-note">启用后，AI 会按需读取说明和附带资源。导入不会执行脚本；需要 Python、Node 或其他工具的 Skill，仍需相应运行环境。</p>
      {message && <p role="status" className="k-note">{message}</p>}
    </div>
    {!skills.length && <KEmpty title="还没有 Skill" hint="可导入社区的 SKILL.md 或包含脚本、资源的 ZIP。" />}
    {skills.map((skill) => <ToolCard key={skill.id} title={skill.name} open={open === skill.id} onToggle={() => setOpen(open === skill.id ? null : skill.id)}
      trailing={<KSwitch label={`启用 ${skill.name}`} checked={skill.enabled} onChange={(enabled) => useApp.getState().patchSkill(skill.id, { enabled })} />}
      meta={<span>{skill.description || `${skill.files.length} 个文件`}</span>}>
      <p className="k-note">{skill.source} · {skill.files.length} 个文件</p>
      <details className="k-note"><summary>说明与资源</summary><div className="k-note__body">
        <pre className="k-long">{skill.files.find((file) => /^skill\.md$/i.test(file.path))?.data}</pre>
        <p>{skill.files.map((file) => file.path).join(" · ")}</p>
      </div></details>
      <KButton onClick={() => { if (deleting === skill.id) { useApp.getState().removeSkill(skill.id); setDeleting(null); }
        else { setDeleting(skill.id); window.setTimeout(() => setDeleting(null), 5000); } }}>{deleting === skill.id ? "确定删除？" : "删除 Skill"}</KButton>
    </ToolCard>)}
  </div>;
}
