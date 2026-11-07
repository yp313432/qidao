import { useEffect, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Paperclip, SendHorizontal, Sparkles, Wrench } from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { KButton, KChip, KHead, KInput } from "@/components/ui-kit";
import { applyAppearance, useApp } from "@/lib/store";
import type { MaterialId, PaletteId } from "@/lib/types";

/**
 * 对话页预览（`/design/preview/chat`）—— 假数据，**真对话页一行都没动**。
 *
 * 为什么要这一页：用户 2026-11-07 说"我要知道改完是啥样啊，不能改好了不行又退"，
 * 又担心"迁到标准件会不会把之前做好的对话界面弄没了"。
 * 所以新版先挂在这条临时路由上，用真实的消息形态（长文 / 列表 / 代码 / 图片 /
 * 思考块 / 工具调用 / 正在写 / 我发的 / 他发的）把观感摆出来，看行不行。
 *
 * 定稿之前：
 *   · `src/routes/_app/index.tsx` 和 `src/components/chat/*` 一个字都不改；
 *   · 觉得不行就删掉这个文件，成本为零（这是"平行跑"，业内叫 strangler / feature flag）。
 * 定稿之后：把这里的版式搬进真对话页，删掉本文件。
 *
 * 保留了什么：原对话页定稿的"方案丁"版式（头像在上、气泡另起一行、我的靠右他的靠左、
 * 气泡宽度跟文字走、左右留白一致）、消息形态、时间与操作的位置。
 * 收敛掉的只有散落在各处的一次性边框 / 圆角 / 阴影 / 字号写法。
 */

// ── 临时排障：把运行时错误直接画在页面上（白屏时也能看见原因）───────────────
// 2026-11-07 用户反馈"点开是空白"。这一页是预览页，挂个显式报错浮层不为过；
// 定稿搬进真对话页时随本文件一起删。
if (
  typeof window !== "undefined" &&
  !(window as { __qidaoPreviewErr?: boolean }).__qidaoPreviewErr
) {
  (window as { __qidaoPreviewErr?: boolean }).__qidaoPreviewErr = true;
  const show = (label: string, detail: unknown) => {
    const body = detail instanceof Error ? (detail.stack ?? detail.message) : String(detail);
    const text = `${label}\n${body}`;
    document.title = `ERR ${text.replace(/\s+/g, " ").slice(0, 90)}`;
    let box = document.getElementById("qidao-preview-err");
    if (!box) {
      box = document.createElement("pre");
      box.id = "qidao-preview-err";
      box.setAttribute(
        "style",
        // 故意不用 var(--k-*)：这层是"样式没生效"时的兜底，不能依赖样式表。
        "position:fixed;inset:0;z-index:99999;margin:0;padding:16px;overflow:auto;background:rgb(255,248,248);color:rgb(176,0,32);font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap",
      );
      document.body.appendChild(box);
    }
    box.textContent = text;
  };
  window.addEventListener("error", (e) =>
    show("页面报错", e.error ?? `${e.message} @ ${e.filename}:${e.lineno}`),
  );
  window.addEventListener("unhandledrejection", (e) => show("未处理的 Promise", e.reason));
}

const MATERIALS: { id: MaterialId; label: string }[] = [
  { id: "solid", label: "纯色" },
  { id: "frost", label: "磨砂" },
  { id: "liquid", label: "液态" },
];

const PALETTES: { id: PaletteId; label: string }[] = [
  { id: "cream", label: "米白" },
  { id: "blue", label: "青蓝" },
  { id: "green", label: "苔绿" },
  { id: "pink", label: "藕粉" },
];

type Demo = { id: string; role: "me" | "ai"; time: string; body: ReactNode };

/** 开场内容：把消息页会遇到的所有形态各来一条，一次看全。 */
const SEED: Demo[] = [
  {
    id: "m1",
    role: "me",
    time: "21:04",
    body: <p>今天有点累，跟我说说话吧。</p>,
  },
  {
    id: "m2",
    role: "ai",
    time: "21:04",
    body: (
      <>
        <p>那就慢慢来。今晚要不要只做一件小事？</p>
        <ul>
          <li>把灯调暗一点，我不催你</li>
          <li>想说什么就说什么，不用组织语言</li>
        </ul>
        <p>
          对了，<strong>你昨天提过的那件事</strong>我记着，等你想聊再聊。
        </p>
      </>
    ),
  },
  {
    id: "m3",
    role: "ai",
    time: "21:05",
    body: (
      <div className="k-vstack">
        <span className="k-msg__head">
          <Sparkles className="size-3.5" />
          想过一会儿
        </span>
        <p>窗外的雨声这个词，你上次用过两次，我说不定能从这儿接着往下说。</p>
      </div>
    ),
  },
  {
    id: "m4",
    role: "me",
    time: "21:06",
    body: (
      <div className="k-vstack">
        <p>我拍到了，你看。</p>
        <div className="k-media">图片占位 · 4:3</div>
      </div>
    ),
  },
  {
    id: "m5",
    role: "ai",
    time: "21:06",
    body: (
      <div className="k-vstack">
        <p>看到了。窗玻璃上的水痕，把楼下的灯拉成一条一条的。</p>
        <p>顺手把这张图记进今天了：</p>
        <div className="k-hstack">
          <KChip tone="outline">
            <Wrench className="size-3" />
            记忆 · 已写入
          </KChip>
          <KChip tone="outline">图像</KChip>
        </div>
        <pre className="k-code">{`{ "date": "11-07", "mood": "安静", "note": "雨夜窗玻璃" }`}</pre>
      </div>
    ),
  },
  {
    id: "m6",
    role: "ai",
    time: "21:07",
    body: <p>要是还想坐一会儿，我就在这儿。想睡了就说一声。</p>,
  },
];

function ChatPreview() {
  const settings = useApp((s) => s.settings);
  // 起始值写死成"纯色 + 米白"：这一页是预览，不跟随用户设置，
  // 免得服务端渲染与客户端首次渲染读到不同的值（差异会让整页刷成空白）。
  const [material, setMaterial] = useState<MaterialId>("solid");
  const [palette, setPalette] = useState<PaletteId>("cream");
  const [draft, setDraft] = useState("");
  const [msgs, setMsgs] = useState<Demo[]>(SEED);
  const [typing, setTyping] = useState(true);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.material = material;
    root.dataset.palette = palette;
    // 离开这一页时把用户自己的设置还回去
    return () => applyAppearance(useApp.getState().settings);
  }, [material, palette]);

  // 新消息进来滚到底：等两帧再写滚动位置，别跟这一帧的排版抢
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [msgs, typing]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    setMsgs((list) => [
      ...list,
      {
        id: `u${list.length + 1}`,
        role: "me",
        time: "21:0" + ((list.length + 1) % 10),
        body: <p>{text}</p>,
      },
    ]);
    setDraft("");
    setTyping(true);
  }

  return (
    <div className="k-stage k-page min-h-dvh">
      <KHead title="对话 · 预览" meta="假数据，真页面未改动" />

      {/* 现场切换材质 / 纸色，方便看这套版式在三种模式下各是什么样 */}
      <div className="k-vstack mt-2">
        <div className="k-hstack">
          {MATERIALS.map((m) => (
            <KButton
              key={m.id}
              variant={material === m.id ? "primary" : "default"}
              onClick={() => setMaterial(m.id)}
            >
              {m.label}
            </KButton>
          ))}
        </div>
        <div className="k-hstack">
          {PALETTES.map((p) => (
            <KButton
              key={p.id}
              variant={palette === p.id ? "primary" : "default"}
              onClick={() => setPalette(p.id)}
            >
              {p.label}
            </KButton>
          ))}
        </div>
      </div>

      {/* ── 消息区：占满剩余高度，只有它滚 ─────────────────── */}
      <div ref={scroller} className="k-scroll mt-3 min-h-0 flex-1">
        <ol className="k-list">
          {msgs.map((m) => (
            <li key={m.id} className="k-msg" data-role={m.role}>
              <span className="k-msg__head">
                <Avatar role={m.role === "me" ? "user" : "ai"} size={22} />
                {m.role === "me" ? settings.displayName || "我" : "栖岛"}
                <span className="k-msg__meta">{m.time}</span>
              </span>
              <div className="k-bubble">{m.body}</div>
            </li>
          ))}

          {typing && (
            <li className="k-msg" data-role="ai">
              <div className="k-bubble">
                <span className="k-typing">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </li>
          )}
        </ol>
      </div>

      {/* ── 输入条 ─────────────────────────────────────────── */}
      <div className="k-composer">
        <KButton variant="icon" aria-label="附件">
          <Paperclip className="size-4" />
        </KButton>
        <div className="k-grow">
          <KInput
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder="说点什么…"
            aria-label="输入消息"
          />
        </div>
        <KButton variant="primary" onClick={send} aria-label="发送">
          <SendHorizontal className="size-4" />
        </KButton>
      </div>

      {/* 说明：这一条是给将来的自己看的，定稿后随文件一起删 */}
      <details className="k-note">
        <summary>
          <ChevronDown className="k-chev size-4" />
          这页是什么
        </summary>
        <div className="k-note__body">
          <p>
            假数据的对话页预览。真对话页（<code>/</code>）一个字没改；这里只演示 「标准件 +
            柔和纸」搬到聊天形态上是什么样。
          </p>
          <p>可以试：发一条消息（回车或点发送）、往下翻、切三种材质和四套纸色。</p>
        </div>
      </details>
    </div>
  );
}

export const Route = createFileRoute("/design/preview/chat")({
  component: ChatPreview,
  // 渲染期抛错时把原因打印在页面上，而不是留一片白
  errorComponent: ({ error }) => (
    <pre className="k-page k-code">
      这一页渲染时出错：{"\n"}
      {error instanceof Error ? (error.stack ?? error.message) : String(error)}
    </pre>
  ),
});
