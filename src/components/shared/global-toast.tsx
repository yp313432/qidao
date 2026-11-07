import { useEffect, useState } from "react";
import { subscribeToast } from "@/lib/toast";

/**
 * 全局轻提示的**显示端**（发消息用 `lib/toast.ts` 的 `pushToast`）。
 *
 * 替代 `window.alert()`：在 WebView 里 alert 是安卓原生白卡片，跟 App 的玻璃感不搭，
 * 长文案还会被系统裁掉。这里就是页内一张浮卡：不阻塞、点一下关掉、六秒自动消失。
 * 挂载点在 `components/app-shell.tsx`，整个 App 只挂一个。
 */
export function GlobalToast() {
  const [msg, setMsg] = useState("");

  useEffect(() => subscribeToast((m) => setMsg(m)), []);

  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(""), 6000);
    return () => window.clearTimeout(t);
  }, [msg]);

  if (!msg) return null;
  return (
    <button
      type="button"
      onClick={() => setMsg("")}
      className="fixed inset-x-4 bottom-[calc(var(--q-inset-bottom,0px)+96px)] z-[95] max-h-[46vh] overflow-y-auto whitespace-pre-wrap break-all rounded-2xl border border-line bg-surface/95 px-4 py-3 text-left text-[12.5px] leading-5 text-ink shadow-lg backdrop-blur"
    >
      {msg}
    </button>
  );
}
