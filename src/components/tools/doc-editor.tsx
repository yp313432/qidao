import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { EditorPage, TextArea, TextInput } from "@/components/tools/editor-page";
import { useApp } from "@/lib/store";

/**
 * 新建文档的**编辑页**。
 *
 * 原来这里是 `window.prompt` 弹两次原生输入框（标题一次、正文一次）——
 * 同一个「新建」动作，HTTP / MCP 用的是自绘表单，文档用的是浏览器原生弹窗，
 * 就是用户说的"这个组件一套代码写法，换一个组件又是另一套"。
 * 现在三个走同一个外壳。
 */
export function DocEditor() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const canSave = Boolean(title.trim()) && Boolean(content.trim());
  const saveHint = [
    title.trim() ? "" : "标题",
    content.trim() ? "" : "正文",
  ]
    .filter(Boolean)
    .join("、");

  function save() {
    if (!canSave) return;
    useApp.getState().saveDoc({ title: title.trim(), content, source: "manual" });
    void navigate({ to: "/tools" });
  }

  return (
    <EditorPage
      title="新建文档"
      description="存下来的文档会出现在「工具 → 文档」里"
      onSave={save}
      canSave={canSave}
      saveHint={saveHint ? `保存需要：${saveHint}` : undefined}
    >
      <TextInput
        label="标题"
        value={title}
        onChange={setTitle}
        placeholder="例如：这周想做的事"
      />

      <TextArea
        label="正文"
        value={content}
        onChange={setContent}
        rows={14}
        placeholder="写点什么…"
      />
    </EditorPage>
  );
}
