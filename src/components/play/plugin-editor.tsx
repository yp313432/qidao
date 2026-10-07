"use client";

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { EditorPage, TextInput } from "@/components/tools/editor-page";
import { useApp } from "@/lib/store";
import type { CustomPlugin } from "@/lib/types";

/**
 * 插件编辑器 —— **填名字 + 地址就行**（用户原话："点进去写上地址和名字，就能插进去了"）。
 *
 * 为什么用 `EditorPage` 那套：这是"填一个东西然后保存"的页面，
 * 全 App 只有这一种写法（UI 统一规范 §1.1）—— 保存按钮在标题栏、整屏、不隐藏轨道。
 *
 * 内置的那两个插件（时感 / 记忆宇宙）**也走这个页面**编辑：
 * 但它们的"地址"是用来指到别处的（时感默认用打进包里的副本，
 * 用户想指到局域网另一台机器时才填）—— 所以这里有个 `slug` 分支。
 */
export function PluginEditor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const plugins = useApp((s) => s.settings.customPlugins) ?? [];
  const shiganUrl = useApp((s) => s.settings.shiganUrl);
  const patch = useApp((s) => s.patchSettings);
  const addPlugin = useApp((s) => s.addPlugin);
  const patchPlugin = useApp((s) => s.patchPlugin);
  const removePlugin = useApp((s) => s.removePlugin);

  /** 编辑内置的时感（地址就是原来那个 `shiganUrl`） */
  const editingShigan = id === "builtin_shigan";
  const existing: CustomPlugin | undefined = editingShigan ? undefined : plugins.find((p) => p.id === id);

  const [name, setName] = useState(editingShigan ? "时感" : (existing?.name ?? ""));
  const [hint, setHint] = useState(editingShigan ? "整页铺满的那个网页" : (existing?.hint ?? ""));
  const [url, setUrl] = useState(editingShigan ? shiganUrl : (existing?.url ?? ""));
  const [problem, setProblem] = useState("");

  function save() {
    const clean = url.trim();
    if (!editingShigan) {
      if (!name.trim()) {
        setProblem("给它起个名字吧 —— 列表里要显示。");
        return;
      }
      if (!/^https?:\/\//i.test(clean)) {
        setProblem("地址要以 http:// 或 https:// 开头（不然点开必然失败）。");
        return;
      }
    }
    if (editingShigan) {
      // 时感的地址归到这里管（原来在「我的 → 我的空间 → 时感地址」）
      patch({ shiganUrl: clean });
    } else if (existing) {
      patchPlugin(existing.id, {
        name: name.trim().slice(0, 20),
        hint: hint.trim().slice(0, 40) || "自己加的插件",
        url: clean,
      });
    } else {
      addPlugin({ name, hint, url: clean });
    }
    void navigate({ to: "/play/plugins" });
  }

  function remove() {
    if (!existing) return;
    removePlugin(existing.id);
    void navigate({ to: "/play/plugins" });
  }

  return (
    <EditorPage
      title={editingShigan ? "时感" : existing ? "改插件" : "添加插件"}
      onSave={save}
      canSave
    >
      {problem && (
        <p className="mb-3 rounded-2xl bg-warn/15 px-3.5 py-2.5 text-[12px] leading-5 text-warn">
          {problem}
        </p>
      )}

      {!editingShigan && (
        <>
          <TextInput
            label="名字"
            value={name}
            onChange={(v) => setName(v.slice(0, 20))}
            placeholder="例如：我的日记本"
          />
          <TextInput
            label="一句话说明（可选）"
            value={hint}
            onChange={(v) => setHint(v.slice(0, 40))}
            placeholder="列表里那行小字"
          />
        </>
      )}

      <TextInput
        label="地址"
        mono
        value={url}
        onChange={setUrl}
        placeholder={editingShigan ? "留空 = 用打进 App 里的那份副本" : "https://example.com/"}
        hint={
          editingShigan
            ? "留空就用跟 App 一起打包的那份（离线也能开、绝对能嵌）。想指到别处（比如局域网另一台机器）才填这里。"
            : "要 http:// 或 https:// 开头。能不能嵌进来取决于那个网站的设置 —— 嵌不进去会告诉你，并给一个用浏览器打开的按钮。"
        }
      />

      {existing && (
        <button
          type="button"
          onClick={remove}
          className="mt-4 w-full rounded-2xl bg-chip px-4 py-3 text-[13px] text-warn"
        >
          删掉这个插件
        </button>
      )}
    </EditorPage>
  );
}
