import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLiquidShell } from "@/liquid/lib/drawer-state";

/**
 * 设置页 = 从底部头像点进来的那一屏（纯色「我的」七组，液态只是换了外壳）。
 *
 * 纯色的分组在 `src/components/me/me-hub.tsx` 的 `GROUPS`：
 *   账号与资料 / 外观 / 对话 / 主动与通知 / 语音 / 隐私与数据 + 页底「关于与高级」。
 *
 * 七行**都真跳转**（用户 m08387："还有设置那些，点开都能点进去设置"）：
 * 点行先把设置层收掉，再进对应的二级页（那些页还是纯色的，等液态一页页改到再换壳）。
 */

const ROWS = [
  { title: "账号与资料", note: "头像 · 名字 · 称呼", to: "/profile" },
  { title: "外观", note: "纸色 · 字体 · 材质", to: "/space" },
  { title: "对话", note: "分段 · 思考链 · 上下文", to: "/chat-settings" },
  { title: "主动与通知", note: "横幅 · 定时 · 自由活动", to: "/notify" },
  { title: "语音", note: "朗读 · 语速 · 声音", to: "/voice-settings" },
  { title: "隐私与数据", note: "备份 · 记忆 · 权限", to: "/privacy" },
  { title: "关于与高级", note: "版本 · 环境自检", to: "/about" },
] as const;

export function LiquidSettings() {
  const { settings, setSettings } = useLiquidShell();
  const nav = useNavigate();

  return (
    <section className="lq-settings" aria-hidden={!settings}>
      <div className="lq-settings__head">
        <button
          type="button"
          className="lq-ico"
          aria-label="返回"
          onClick={() => setSettings(false)}
        >
          <ChevronLeft />
        </button>
        <p className="lq-settings__title">设置</p>
      </div>

      <ul className="lq-settings__list">
        {ROWS.map((row) => (
          <li key={row.title}>
            <button
              type="button"
              className="lq-setrow lq-glass"
              onClick={() => {
                /* 不在这里关设置层：`settingsMemory` 记住"用户是从设置进来的"，
                   三级页返回 `/` 时会自动停在设置列表（三级 → 二级）。 */
                void nav({ to: row.to });
              }}
            >
              <span className="lq-setrow__t">{row.title}</span>
              <span className="lq-setrow__d">{row.note}</span>
              <ChevronRight className="lq-setrow__chev" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
