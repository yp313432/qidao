import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { EditorPage, Segmented, TextArea, TextInput } from "@/components/tools/editor-page";
import { useApp } from "@/lib/store";
import type { HttpTool } from "@/lib/types";

/**
 * HTTP 工具的**编辑页**（独立页面，不是底部弹层）。
 *
 * 它跟 MCP 那个编辑器共用 `editor-page.tsx` 的外壳和字段零件 ——
 * 这两个原来各自写了一个底部弹层，两份代码 95% 一样，而且都犯了同一个错：
 * 弹层 `z-40` 低于底部导航 `z-60`，导航把最底下那栏输入框压住了。
 * 用户的话："这三个是同类的，明明可以用一套写法"。
 */

type Draft = Omit<HttpTool, "id"> & { id?: string };

const EMPTY: Draft = {
  name: "",
  description: "",
  method: "GET",
  url: "",
  headersText: "",
  body: "",
  enabled: true,
};

const METHODS: HttpTool["method"][] = ["GET", "POST", "PUT", "DELETE"];

export function HttpToolEditor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const tools = useApp((s) => s.httpTools);
  const existing = id ? tools.find((t) => t.id === id) : undefined;
  const [draft, setDraft] = useState<Draft>(() => (existing ? { ...existing } : { ...EMPTY }));

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const canSave = Boolean(draft.name.trim()) && Boolean(draft.url.trim());
  const saveHint = [
    draft.name.trim() ? "" : "名称",
    draft.url.trim() ? "" : "地址",
  ]
    .filter(Boolean)
    .join("、");

  /** GET / DELETE 不带请求体 —— 这一条原来就写对了，搬过来别丢 */
  const needsBody = draft.method !== "GET" && draft.method !== "DELETE";

  function save() {
    if (!canSave) return;
    const st = useApp.getState();
    if (draft.id) {
      const { id: keep, ...rest } = draft;
      st.patchHttpTool(keep, rest);
    } else {
      const { id: _ignored, ...rest } = draft;
      st.addHttpTool(rest);
    }
    void navigate({ to: "/tools" });
  }

  return (
    <EditorPage
      title={draft.id ? "编辑工具" : "新建 HTTP 工具"}
      onSave={save}
      canSave={canSave}
      saveHint={saveHint ? `保存需要：${saveHint}` : undefined}
    >
      <TextInput
        label="名称"
        value={draft.name}
        onChange={(v) => patch({ name: v })}
        placeholder="例如：查天气"
      />

      <TextInput
        label="说明（可选）"
        value={draft.description}
        onChange={(v) => patch({ description: v })}
        placeholder="这个工具是干什么的"
      />

      <Segmented<HttpTool["method"]>
        label="方法"
        value={draft.method}
        options={METHODS.map((m) => ({ id: m, label: m }))}
        onChange={(v) => patch({ method: v })}
        hint={needsBody ? "会在下面填写请求体" : "这个方法不带请求体"}
      />

      <TextInput
        label="地址"
        value={draft.url}
        onChange={(v) => patch({ url: v })}
        placeholder="https://..."
        mono
      />

      <TextArea
        label="请求头（每行一个 Key: Value）"
        value={draft.headersText}
        onChange={(v) => patch({ headersText: v })}
        rows={4}
        placeholder={"Authorization: Bearer xxx\nAccept: application/json"}
      />

      {needsBody && (
        <TextArea
          label="请求体"
          value={draft.body}
          onChange={(v) => patch({ body: v })}
          rows={5}
          placeholder={'{\n  "key": "value"\n}'}
        />
      )}

      <div className="mt-4 rounded-2xl border border-dashed border-line px-4 py-3">
        <p className="text-[12px] leading-5 text-muted">
          保存回列表后点「调用」，会真的发一次请求。浏览器有跨域（CORS）限制，
          对方服务器没放开的话会被挡住 —— 那不是栖岛的问题，是对方的事。
        </p>
      </div>
    </EditorPage>
  );
}
