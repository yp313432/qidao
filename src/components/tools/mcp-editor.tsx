import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { EditorPage, TextArea, TextInput } from "@/components/tools/editor-page";
import { useApp } from "@/lib/store";
import type { McpServer } from "@/lib/types";

/**
 * MCP 服务器的**编辑页**（独立页面，不是底部弹层）。
 *
 * ── 为什么从弹层搬过来 ────────────────────────────────────────
 * 弹层是 `z-40`，比底部导航的 `z-60` 低，导航把最下面那栏「请求头」直接
 * 压住了（用户实测：字看不见、点不到）。现在改成独立页面 + 不显示底部
 * 导航（`nav-tree.ts` 的 `hidesNav` 一处管着），这个问题从根上没有，
 * 也不用去比 z 值。
 *
 * ── 为什么没有「传输方式」这一栏了 ────────────────────────────
 * 用户："假的和实现不了的就不留了，别误导"。
 * `stdio` 实现不了，`sse` 在本机没法实测 —— 两个都从界面撤掉，只留 HTTP。
 * 详见 `src/lib/mcp.ts` 开头的说明。
 */

type Draft = Omit<McpServer, "id" | "tools" | "status"> & { id?: string };

const EMPTY: Draft = {
  name: "",
  description: "",
  transport: "http",
  url: "",
  command: "",
  args: "",
  headersText: "",
  enabled: true,
  kind: "mcp",
};

export function McpEditor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const servers = useApp((s) => s.mcp);
  const existing = id ? servers.find((s) => s.id === id) : undefined;
  const [draft, setDraft] = useState<Draft>(() => ({
    ...EMPTY,
    ...(existing
      ? {
          id: existing.id,
          name: existing.name,
          description: existing.description,
          url: existing.url,
          headersText: existing.headersText,
          enabled: existing.enabled,
          kind: existing.kind,
        }
      : {}),
  }));

  /** 老记录的传输方式（sse / stdio）—— 保存时会按 HTTP 处理，得先说清楚。 */
  const legacyTransport =
    existing && existing.transport !== "http" ? existing.transport : undefined;

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const canSave = Boolean(draft.name.trim()) && Boolean(draft.url.trim());
  const saveHint = [
    draft.name.trim() ? "" : "名称",
    draft.url.trim() ? "" : "地址",
  ]
    .filter(Boolean)
    .join("、");

  function save() {
    if (!canSave) return;
    const st = useApp.getState();
    if (draft.id) {
      const { id: keep, ...rest } = draft;
      // 老记录顺手改成 http —— 界面已经不提供别的了
      st.patchMcp(keep, { ...rest, transport: "http" });
    } else {
      const { id: _ignored, ...rest } = draft;
      st.addMcp({ ...rest, tools: [] });
    }
    // 回工具页 —— 那个页面会记得刚才在 MCP 这个标签上
    void navigate({ to: "/tools" });
  }

  return (
    <EditorPage
      title={draft.id ? "编辑 MCP 服务器" : "添加 MCP 服务器"}
      onSave={save}
      canSave={canSave}
      saveHint={saveHint ? `保存需要：${saveHint}` : undefined}
    >
      {legacyTransport && (
        <div className="mb-3 rounded-2xl border border-dashed border-line px-4 py-3">
          <p className="text-[12px] leading-5 text-muted">
            这条原来存的是「{legacyTransport}」传输方式 —— 栖岛连不了它
            （{legacyTransport === "stdio" ? "要起本地进程，手机上做不到" : "老式 SSE，已经在客户端里去掉了"}）。
            保存后会按 HTTP 处理，记得把地址换成对方给的 HTTP 地址。
          </p>
        </div>
      )}

      <TextInput
        label="名称"
        value={draft.name}
        onChange={(v) => patch({ name: v })}
        placeholder="例如：Horizon / 我的记忆库"
      />

      <TextInput
        label="说明（可选）"
        value={draft.description}
        onChange={(v) => patch({ description: v })}
        placeholder="它能做什么"
      />

      <TextInput
        label="地址（HTTP）"
        value={draft.url}
        onChange={(v) => patch({ url: v })}
        placeholder="https://example.com/mcp"
        mono
        hint="现在只支持 Streamable HTTP。很多服务不是根路径，别漏了结尾的 /mcp"
      />

      <TextArea
        label="请求头（每行一个 Key: Value）"
        value={draft.headersText}
        onChange={(v) => patch({ headersText: v })}
        rows={4}
        placeholder={"Authorization: Bearer xxx"}
        hint="对方要认证时填这里。令牌只存在你这台机器上，不会上传。"
      />

      <div className="mt-4 rounded-2xl border border-dashed border-line px-4 py-3">
        <p className="text-[12px] leading-5 text-muted">
          保存后回列表点「测试连接」，会真的走一遍 MCP 握手（initialize →
          initialized → 工具清单）。看到「拿到 N 个工具」才算真的连上了 ——
          只写"握手成功"是不够的，那只能说明对方回了一句话。
        </p>
      </div>
    </EditorPage>
  );
}
