import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * **自绘的日期 / 时间选择器**（用户第 7 条："改对话名称和选择时间……
 * 这是安卓系统最底层的对话框吧，这儿有点像裸奔……做个适配"）。
 *
 * 为什么不用系统的 `input type="date" / "time"`：
 *   那是**系统最底层**那套（白底、CANCEL/OK、跟 App 完全不搭），而且各家 ROM 长得都不一样。
 *
 * 这里的做法（跟用户确认过的）：
 *   · **时间** → **滚轮**（上滑下滑、中间那行是选中，手感跟系统闹钟一样）；
 *   · **日期** → **月历网格**（能看见星期几、当月全貌）；
 *   · 选中一律是**反色实心**（用当前文字色做底、字用当前背景色）→ 深色背景图下自动反转，永远看得清；
 *   · 外壳是**玻璃卡片 + 半透明遮罩**，跟 App 其它弹层一致。
 */

const ITEM_H = 44;

/** 时间滚轮（小时 / 分钟各一列） */
export function WheelPicker({
  value,
  onChange,
  min,
  max,
  label,
  pad = 2,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  label: string;
  pad?: number;
}) {
  const items = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef(0);

  /** 打开时先滚到当前选中项 */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = Math.max(0, items.indexOf(value));
    el.scrollTop = idx * ITEM_H;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jump = (n: number) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: Math.max(0, items.indexOf(n)) * ITEM_H, behavior: "smooth" });
  };

  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-center text-[11px] text-muted">{label}</p>
      <div className="relative h-[220px] overflow-hidden rounded-2xl border border-line bg-chip">
        {/* 中间那条 = 反色实心（选中项就落在它上面） */}
        <div className="pointer-events-none absolute top-1/2 right-2 left-2 h-11 -translate-y-1/2 rounded-full bg-fg" />
        <div
          ref={ref}
          onScroll={() => {
            const el = ref.current;
            if (!el) return;
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
              const idx = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
              const v = items[idx];
              if (v !== undefined && v !== value) onChange(v);
            }, 90);
          }}
          className="h-full snap-y snap-mandatory overflow-y-scroll py-[88px] text-center"
        >
          {items.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                onChange(n);
                jump(n);
              }}
              className={cn(
                "relative z-10 block h-11 w-full snap-center text-[15px] tabular-nums",
                n === value ? "font-semibold text-bg" : "text-muted",
              )}
            >
              {String(n).padStart(pad, "0")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const WD = ["一", "二", "三", "四", "五", "六", "日"];

/** 日期月历（`value` 用 `YYYY-MM-DD`，跟原来的 input 一致） */
export function CalendarPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const init = value ? new Date(`${value}T00:00:00`) : new Date();
  const [cursor, setCursor] = useState({
    y: Number.isNaN(init.getTime()) ? new Date().getFullYear() : init.getFullYear(),
    m: Number.isNaN(init.getTime()) ? new Date().getMonth() : init.getMonth(),
  });
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;

  const first = new Date(cursor.y, cursor.m, 1);
  const lead = (first.getDay() + 6) % 7; // 周一当第一列
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  const stamp = (d: number) =>
    `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const shift = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="上个月"
          className="grid size-8 place-items-center rounded-full border border-line bg-chip text-[13px]"
          onClick={() => shift(-1)}
        >
          ‹
        </button>
        <b className="text-[14px]">
          {cursor.y} 年 {cursor.m + 1} 月
        </b>
        <button
          type="button"
          aria-label="下个月"
          className="grid size-8 place-items-center rounded-full border border-line bg-chip text-[13px]"
          onClick={() => shift(1)}
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WD.map((w) => (
          <div key={w} className="py-1 text-[10px] text-muted">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />;
          const s = stamp(d);
          const on = s === value;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              className={cn(
                "rounded-full py-2 text-[12.5px] tabular-nums",
                on ? "bg-fg font-semibold text-bg" : "text-fg",
                !on && s === todayStr && "shadow-[inset_0_0_0_1px_var(--fg)]",
              )}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 两列滚轮的"时间"选择（`value` 用 `HH:MM`） */
export function TimeWheels({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h, m] = (value || "00:00").split(":").map((x) => Number(x) || 0);
  return (
    <div className="flex gap-2">
      <WheelPicker
        label="小时"
        min={0}
        max={23}
        value={h}
        onChange={(nv) => onChange(`${String(nv).padStart(2, "0")}:${String(m).padStart(2, "0")}`)}
      />
      <WheelPicker
        label="分钟"
        min={0}
        max={59}
        value={m}
        onChange={(nv) => onChange(`${String(h).padStart(2, "0")}:${String(nv).padStart(2, "0")}`)}
      />
    </div>
  );
}

/**
 * **一个字段 + 点开弹层的组合**（给各个页面直接用，替掉 `input type="date" / "time"`）。
 * 弹层里是：玻璃卡片 + 月历或滚轮 + 取消/确定（确定按钮用统一的反色实心）。
 */
export function DateTimeField({
  mode,
  value,
  onChange,
  label,
  className,
}: {
  mode: "date" | "time";
  value: string;
  onChange: (v: string) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const openIt = () => {
    setDraft(value);
    setOpen(true);
  };
  return (
    <>
      <button
        type="button"
        onClick={openIt}
        className={cn(
          "rounded-2xl border border-line bg-chip px-3 text-left text-[13px] tabular-nums",
          className ?? "h-10",
        )}
      >
        {value || (mode === "date" ? "选日期" : "选时间")}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-fg/25 p-5"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-line bg-elevated p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-3 text-[13px] font-medium">{label ?? (mode === "date" ? "选个日子" : "选个时间")}</p>
            {mode === "date" ? (
              <CalendarPicker value={draft} onChange={setDraft} />
            ) : (
              <TimeWheels value={draft} onChange={setDraft} />
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full px-4 py-1.5 text-[12px] text-muted"
                onClick={() => setOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-full bg-fg px-4 py-1.5 text-[12px] text-bg"
                onClick={() => {
                  onChange(draft);
                  setOpen(false);
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
