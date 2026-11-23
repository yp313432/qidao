import { useEffect, useState } from "react";
import { chatGptPlan, chatGptPlanAvailable } from "@/lib/chatgpt-plan";
import { useApp } from "@/lib/store";

export function ChatGptPlanSettings() {
  const active = useApp((s) => s.settings.chatGptPlanEnabled === true);
  const selected = useApp((s) => s.settings.chatGptPlanModel ?? "");
  const patch = useApp((s) => s.patchSettings);
  const [status, setStatus] = useState({ connected: false, allowed: false, email: "", hasRegistration: false });
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const available = chatGptPlanAvailable();

  useEffect(() => {
    if (!available) return;
    let live = true;
    async function load() {
      try {
        const result = await chatGptPlan.status();
        if (live) setStatus(result);
        if (result.allowed) {
          const catalog = await chatGptPlan.models();
          if (live) setModels(catalog.models);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "无法读取 ChatGPT 连接");
      } finally {
        if (live) setBusy(false);
      }
    }
    void load();
    return () => { live = false; };
  }, [available]);

  async function connect(replaceAccount = false) {
    setBusy(true);
    setError("");
    try {
      const result = await chatGptPlan.signIn({ replaceAccount });
      setStatus(result);
      if (!result.allowed) {
        setError("已登录 ChatGPT。请授权使用订阅额度后再启用聊天。");
        return;
      }
      const catalog = await chatGptPlan.models();
      setModels(catalog.models);
      if (!catalog.models.some((model) => model.id === selected)) {
        patch({ chatGptPlanModel: catalog.models[0]?.id ?? "" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "ChatGPT 授权失败");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      const result = await chatGptPlan.disconnect();
      patch({ chatGptPlanEnabled: false, chatGptPlanModel: "" });
      setStatus((old) => ({ ...old, connected: false, allowed: false, email: "" }));
      setModels([]);
      if (!result.revoked) setError("已断开本机连接。可在 ChatGPT 的登录连接中撤销远程授权。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "断开 ChatGPT 失败");
    } finally {
      setBusy(false);
    }
  }

  if (!available) return <p className="k-note">在 Yisle 安卓 App 中连接 ChatGPT 计划。</p>;

  return (
    <div className="flex flex-col gap-2">
      <p className="k-note">
        使用 ChatGPT 额度进行手动发起的聊天。授权凭据保存在本机，聊天所需的消息会发送给 OpenAI。
      </p>
      {!status.allowed && (
        <button type="button" className="k-btn k-btn--block" onClick={() => void connect()} disabled={busy}>
          {busy ? "正在等待 ChatGPT" : "使用 ChatGPT 继续"}
        </button>
      )}
      {!status.connected && status.hasRegistration && (
        <button type="button" className="k-btn k-btn--block" disabled={busy} onClick={() => void connect(true)}>
          连接另一个 ChatGPT 账号
        </button>
      )}
      {status.connected && status.email && <p className="k-note">{status.email}</p>}
      {status.allowed && (
        <>
          <label className="text-sm">
            模型
            <select
              className="k-input mt-1 w-full"
              value={selected}
              disabled={busy}
              onChange={(e) => patch({ chatGptPlanModel: e.target.value })}
            >
              <option value="">选择模型</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="k-btn k-btn--block"
            disabled={busy || (!active && !models.some((m) => m.id === selected))}
            onClick={() => patch({ chatGptPlanEnabled: !active })}
          >
            {active ? "切回自定义上游" : "聊天使用 ChatGPT 计划"}
          </button>
          <button type="button" className="k-btn k-btn--block" disabled={busy} onClick={() => void connect()}>
            重新连接 ChatGPT
          </button>
        </>
      )}
      {status.connected && (
        <button type="button" className="k-btn k-btn--block" onClick={() => void disconnect()} disabled={busy}>
          断开 ChatGPT
        </button>
      )}
      <a className="k-note underline" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
        在 ChatGPT 查看用量
      </a>
      {error && <p className="k-note" role="status">{error}</p>}
    </div>
  );
}
