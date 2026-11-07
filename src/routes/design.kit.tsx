import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  KButton,
  KCard,
  KChip,
  KEmpty,
  KHead,
  KInput,
  KNavbar,
  KRow,
  KSwitch,
} from "@/components/ui-kit";
import { applyAppearance, useApp } from "@/lib/store";
import type { MaterialId, PaletteId } from "@/lib/types";

/**
 * 标准件样板间（`/design/kit`）。
 *
 * 为什么要有这一页：`src/styles/kit.css` 里那套 `.k-*` 在**真手机上**是什么手感，
 * 光看代码看不出来 —— 圆角、边框粗细、按下位移、字号，都得拿手指点一遍才知道。
 * 这一页把所有标准件摆在一起，还能当场切换材质和纸色，方便对比。
 *
 * 它是**开发用的**，不挂在 `_app` 布局里（不要 AppShell 的导航和返回钮），
 * 也不进任何菜单。上线要不要保留：交给用户定（见 design/ARCHITECTURE.md 阶段 2）。
 *
 * 切材质是靠临时改 `documentElement.dataset`，离开时用 store 里的真实设置还原
 * —— 所以这一页不会污染用户的选择。
 */

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

function KitShowcase() {
  const settings = useApp((s) => s.settings);
  const [material, setMaterial] = useState<MaterialId>(settings.material ?? "solid");
  const [palette, setPalette] = useState<PaletteId>(settings.palette ?? "cream");
  const [switchA, setSwitchA] = useState(true);
  const [switchB, setSwitchB] = useState(false);
  const [nav, setNav] = useState("home");

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.material = material;
    root.dataset.palette = palette;
    // 离开这一页时把用户自己的设置还回去
    return () => applyAppearance(useApp.getState().settings);
  }, [material, palette]);

  return (
    <div className="k-page k-nav-space min-h-dvh">
      <KHead title="标准件" meta="/design/kit" />

      {/* ── 现场切换材质 / 纸色 ─────────────────────────────── */}
      <KCard>
        <div className="k-vstack">
          <span className="k-row__meta">材质</span>
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
          <span className="k-row__meta">纸色（只对纯色有意义）</span>
          <div className="k-hstack">
            {PALETTES.map((p) => (
              <KButton
                key={p.id}
                variant={material === "solid" && palette === p.id ? "primary" : "default"}
                onClick={() => setPalette(p.id)}
              >
                {p.label}
              </KButton>
            ))}
          </div>
        </div>
      </KCard>

      {/* ── 列表行 ─────────────────────────────────────────── */}
      <KHead title="列表行" meta=".k-row" />
      <div className="k-list">
        <KRow
          index="01"
          title="带序号与副信息"
          meta="10 月 28 日 · 用了 3 次"
          trailing={<KChip>常用</KChip>}
        />
        <KRow
          title="右侧是开关"
          meta="点整行不动作，只有开关响应"
          trailing={<KSwitch checked={switchA} onChange={setSwitchA} label="演示开关一" />}
        />
        <KRow
          title="可点的一行"
          meta="按下会有硬位移和阴影变化"
          onClick={() => setSwitchB((v) => !v)}
          trailing={<KChip tone="outline">点击</KChip>}
        />
        <KRow title="停用态" meta="只是把字压灰，不换配色" off trailing={<KChip>关</KChip>} />
      </div>

      {/* ── 开关 ───────────────────────────────────────────── */}
      <KHead title="开关" meta=".k-switch" />
      <KCard>
        <div className="k-vstack">
          <div className="k-hstack">
            <span className="k-grow">开着的</span>
            <KSwitch checked={switchA} onChange={setSwitchA} label="演示开关一" />
          </div>
          <div className="k-hstack">
            <span className="k-grow">关着的</span>
            <KSwitch checked={switchB} onChange={setSwitchB} label="演示开关二" />
          </div>
          <div className="k-hstack">
            <span className="k-grow">不可用的</span>
            <KSwitch checked={false} onChange={() => {}} label="演示开关三" disabled />
          </div>
        </div>
      </KCard>

      {/* ── 按钮 ───────────────────────────────────────────── */}
      <KHead title="按钮" meta=".k-btn" />
      <div className="k-vstack">
        <div className="k-hstack">
          <KButton>普通</KButton>
          <KButton variant="primary">主要</KButton>
        </div>
        <KButton variant="dashed" block>
          虚线款 · 加一条
        </KButton>
        <KButton variant="primary" block>
          整行主要按钮
        </KButton>
      </div>

      {/* ── 输入框 / 标签 ──────────────────────────────────── */}
      <KHead title="输入与标签" meta=".k-input / .k-chip" />
      <KCard>
        <div className="k-vstack">
          <KInput placeholder="说点什么…" />
          <div className="k-hstack">
            <KChip>实心</KChip>
            <KChip tone="outline">描边</KChip>
            <KChip>3 条</KChip>
          </div>
        </div>
      </KCard>

      {/* ── 空态 ───────────────────────────────────────────── */}
      <KHead title="空态" meta=".k-empty" />
      <KCard>
        <KEmpty
          title="这里还什么都没有"
          hint="加一条之后就会列在这里"
          action={<KButton variant="dashed">加一条</KButton>}
        />
      </KCard>

      <KNavbar
        items={[
          { key: "home", label: "首页", active: nav === "home", onSelect: () => setNav("home") },
          {
            key: "garden",
            label: "花园",
            active: nav === "garden",
            onSelect: () => setNav("garden"),
          },
          { key: "me", label: "我的", active: nav === "me", onSelect: () => setNav("me") },
        ]}
      />
    </div>
  );
}

export const Route = createFileRoute("/design/kit")({
  component: KitShowcase,
});
