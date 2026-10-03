import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BookHeart,
  CalendarHeart,
  ChevronRight,
  Disc3,
  GraduationCap,
  Hourglass,
  ImagePlus,
  Sparkles,
  Spade,
  X,
} from "lucide-react";
import { FileButton } from "@/components/file-button";
import { countdown, sortDates } from "@/lib/days";
import { deletePhoto, listPhotos, makePhoto, putPhoto, type PlayPhoto } from "@/lib/play-photos-db";
import {
  ButterflyRibbon,
  CandyJar,
  ClipStamp,
  WavyFrame,
} from "@/components/play/note-decor";
import { usePlayer } from "@/lib/player";
import { useApp } from "@/lib/store";
import { resolveAiName } from "@/lib/branding";
import { cn } from "@/lib/utils";

/**
 * 玩乐区首页。
 *
 * 用户给的定位（对齐参考图）："在玩乐区首页不进行太多的展示，只是做美化，
 * 二级展示区，每个板块再调节……底层逻辑要一致，风格统一，做美化。"
 *
 * 所以这一页**不承担信息**，只承担氛围：
 *   顶部一句飘逸英文 → 名字 + 认识多久了 → 橱窗（六个入口）→ 便签 → 底部一句英文
 *
 * 那些原来挂在卡片上的信息（几篇日记、几张牌、看过几次单词）**全部撤掉**，
 * 这正好落实视觉 Skill 第 7 节："让每个空间只保留一个小图标、标题和一句状态"
 * + "首页承担选择空间的职责，不要每张卡片都努力成为视觉焦点"。
 * 信息没丢，都在二级页里。
 */

/** 封面用的几句英文。固定几句，循环播放（用户："固定几句吧"）。 */
const PHRASES = [
  "Love like foam upon the sea",
  "A quiet place that belongs to us",
  "The moon remembers what we said",
  "Somewhere soft to come back to",
  "We are still here, still together",
];

export function PlayHub() {
  const settings = useApp((s) => s.settings);
  const aiName = resolveAiName(settings.aiName);
  const myName = settings.displayName || "你";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-above-nav">
        {/* 顶部那片：飘逸英文 + 名字 + SINCE */}
        <header className="pt-[max(1.75rem,env(safe-area-inset-top))] pb-1 text-center">
          <Phrases className="mb-3" />
          <h1 className="font-serif text-[1.4rem] leading-tight font-medium">
            {myName} <span className="text-muted">&</span> {aiName}
          </h1>
          <SinceLine />
        </header>

        <div className="mt-5 space-y-3">
          <TogetherCard />
          <ShowcaseGrid />
          <div className="grid grid-cols-2 gap-3">
            <PhotoNote />
            <NowNote />
          </div>
          <Phrases className="pt-4 pb-2" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 英文装饰句 */

/**
 * 一句展示完 → 渐渐消散 → 下一句显现。
 *
 * 每句挂同一个动画、只是 `animation-delay` 错开一个周期：
 * 可见窗口占周期的 1/句数，所以同一时刻只有一句在亮（见 styles.css 的
 * `@keyframes aster-phrase`）。纯 CSS，没有定时器要清理。
 */
function Phrases({ className }: { className?: string }) {
  const n = PHRASES.length;
  const cycle = 13 * n; // 每句 13 秒
  return (
    <div className={cn("relative h-5", className)} aria-hidden="true">
      {PHRASES.map((p, i) => (
        <p
          key={p}
          className="aster-phrase absolute inset-x-0 truncate text-center text-[12px] leading-5 tracking-wide text-muted"
          style={{
            fontFamily: "var(--font-script)",
            fontStyle: "italic",
            animationDelay: `${(-cycle / n) * i}s`,
            ["--phrase-cycle" as string]: `${cycle}s`,
          }}
        >
          ✦ {p} ✦
        </p>
      ))}
    </div>
  );
}

/** 「PRIVATE SPACE · SINCE …」那行小字。没填日子就不显示。 */
function SinceLine() {
  const since = useApp((s) => s.settings.togetherSince);
  if (!since) return null;
  const shown = since.replace(/-/g, ".");
  return (
    <p className="mt-1.5 text-[10px] tracking-[0.3em] text-subtle uppercase">
      private space · since {shown}
    </p>
  );
}

/* --------------------------------------------------------- 认识多久了 */

/** 从 YYYY-MM-DD 到今天的天数（按本地日期算，避免时区差一天）。 */
function daysSince(dateStr: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(y!, m! - 1, d!);
  if (Number.isNaN(start.getTime())) return null;
  const today = new Date();
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * 同行的日子。
 *
 * 用户："可以来个组件，上面是两个的名字或头像，写着认识多久了，那种参考图二。"
 * 日期**用户自己填**（在我的空间里），没填就提示去填 —— 不编数字。
 */
function TogetherCard() {
  const settings = useApp((s) => s.settings);
  const aiName = resolveAiName(settings.aiName);
  const myName = settings.displayName || "你";
  const days = daysSince(settings.togetherSince);

  return (
    <section className="aster-card relative overflow-hidden rounded-[1.75rem] border border-line px-5 py-6">
      {/*
        四周一圈**波浪细边框**。
        用户："我说的横折只是他的走向，还是要用波浪，而且不是做边框吗，
        你为啥反着包？" —— 上一版我只画了两个角、还是反的；
        正解是一条波浪线**绕卡片一圈**（四个圆角都包上）。
      */}
      <WavyFrame />

      <div className="relative flex items-center justify-between gap-3">
        <div className="flex shrink-0 items-center">
          <Face role="user" label={myName} />
          <Face role="ai" label={aiName} className="-ml-3" />
        </div>
        <div className="text-right">
          {days === null ? (
            <>
              <p
                className="text-[1.05rem] leading-tight text-muted"
                style={{ fontFamily: "var(--font-script)", fontStyle: "italic" }}
              >
                a date we keep
              </p>
              <p className="mt-1 text-[11px] leading-4 text-subtle">
                去「我的 → 我的空间」填上
                <br />
                认识的日子
              </p>
            </>
          ) : (
            <>
              <p className="font-serif text-[2.75rem] leading-none font-medium tabular-nums">
                {days}
              </p>
              <p className="mt-1 text-[10px] tracking-[0.28em] text-muted uppercase">
                days together
              </p>
            </>
          )}
        </div>
      </div>

      {/* 名字 —— 图二那种「A & B」的写法 */}
      <p className="mt-4 text-center font-serif text-[15px]">
        {myName} <span className="text-subtle">&</span> {aiName}
      </p>
    </section>
  );
}

/** 头像圆：没上传就用名字首字。 */
function Face({
  role,
  label,
  className,
}: {
  role: "user" | "ai";
  label: string;
  className?: string;
}) {
  const src = useApp((s) => (role === "user" ? s.settings.userAvatar : s.settings.aiAvatar));
  return (
    <span
      className={cn(
        "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-elevated",
        className,
      )}
      title={label}
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : role === "ai" ? (
        <Sparkles className="size-5 text-accent" />
      ) : (
        <span className="font-serif text-[15px]">{label.slice(0, 1)}</span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------- 橱窗 */

/**
 * 六个入口，装在一个"展示橱窗"里。
 *
 * 用户："下面再来一个展示橱窗一样的组件，把六张个功能图标放进去。"
 * 只留**图标 + 名字** —— 原来卡上那些"1 篇""看过 12 次""16 张牌"
 * 全部撤掉（视觉 Skill 第 7 节：首页不要每张卡都争当焦点）。
 */
const CASES: { to: string; label: string; icon: typeof Disc3 }[] = [
  { to: "/play/listen", label: "音乐", icon: Disc3 },
  { to: "/play/space", label: "动态空间", icon: BookHeart },
  { to: "/play/tools", label: "小日子", icon: CalendarHeart },
  { to: "/play/truth", label: "真心话", icon: Spade },
  { to: "/play/learn", label: "英语学习", icon: GraduationCap },
  { to: "/play/shigan", label: "时感", icon: Hourglass },
];

function ShowcaseGrid() {
  return (
    <section className="aster-card relative overflow-hidden rounded-[1.75rem] border border-line px-3 py-4">
      {/*
        左上角蝴蝶丝带（照着参考图重画成渐变+翅脉+发光边，整只向左微斜）。
        丝带的尾巴控制在组件内，不要拖出卡片外。
      */}
      <ButterflyRibbon className="top-0 -left-2 h-24 w-28 opacity-90" />
      <p className="relative mb-3 text-center text-[10px] tracking-[0.3em] text-subtle uppercase">
        our little things
      </p>
      <div className="relative grid grid-cols-3 gap-1">
        {CASES.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.to}
              to={c.to as never}
              className="flex flex-col items-center gap-2 rounded-2xl px-1 py-3 transition-colors active:bg-chip"
            >
              <span className="flex size-11 items-center justify-center rounded-2xl border border-line bg-chip text-accent">
                <Icon className="size-[1.15rem]" strokeWidth={1.7} aria-hidden="true" />
              </span>
              <span className="max-w-full text-center text-[11px] leading-4 text-muted">
                {c.label}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- 便签 */

/**
 * 照片便签。
 *
 * 图片**单独存在一个 IndexedDB**（`play-photos-db.ts`），不塞进状态树 ——
 * 状态树是整体序列化的，塞大图进去每次状态变化都会重写它们。
 * 这里只存 id 之类的元信息（其实连元信息都不进状态树，直接读库）。
 */
function PhotoNote() {
  const [photos, setPhotos] = useState<PlayPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void listPhotos().then(setPhotos);
  }, []);

  async function onPick(files: File[]) {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    setMsg("");
    try {
      const photo = await makePhoto(file);
      await putPhoto(photo);
      setPhotos(await listPhotos());
    } catch (err) {
      setMsg(`存不进去：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await deletePhoto(id);
    setPhotos(await listPhotos());
  }

  const latest = photos[0];
  const title = latest?.thumb;

  return (
    // 注意：这一块**故意不加 overflow-hidden**。
    // 回形针要"真卡在角上"，就必须有一半**伸到卡片外面**（出画），
    // overflow-hidden 会把它裁掉，看着又变成一个躺在卡里的图标。
    // 用户原话："回形针要真卡在组件角上，后面还有个正方形色块"。
    <section className="aster-card relative rounded-[1.5rem] border border-line p-3">
      {/* 回形针 + 它压着的那张方纸：一起骑在卡片右上角上 */}
      <ClipStamp className="-top-4 -right-5 h-24 w-[5.5rem] opacity-80" />
      <p className="relative mb-2 text-[10px] tracking-[0.22em] text-subtle uppercase">our photos</p>

      {title ? (
        <div className="relative">
          <FileButton
            ariaLabel="换一张照片"
            accept="image/*"
            className="block w-full"
            onPick={(files) => void onPick(files)}
          >
            {/*
              拍立得：白边 + **真实地歪一点**（-2.5°）。
              用户："照片小组件可以真实的倾斜一下，更真实。"
              只转这个小卡片，不转整个组件 —— 否则连标题一起歪，
              在界面里看着像没对齐的 bug。
            */}
            <span className="block -rotate-[2.5deg] rounded-xl bg-elevated p-1.5 shadow-sm transition-transform duration-300 hover:rotate-0">
              <img src={title} alt="" className="aspect-square w-full rounded-lg object-cover" />
            </span>
          </FileButton>
          <button
            type="button"
            aria-label="移除照片"
            onClick={() => void remove(latest!.id)}
            className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-ink text-ink-fg"
          >
            <X className="size-3" />
          </button>
          {photos.length > 1 && (
            <p className="mt-1.5 text-center font-mono text-[10px] text-subtle">
              共 {photos.length} 张 · 点一下换
            </p>
          )}
        </div>
      ) : (
        <FileButton
          ariaLabel="添加一张照片"
          accept="image/*"
          className="block w-full"
          onPick={(files) => void onPick(files)}
        >
          <span className="flex aspect-square w-full -rotate-[2.5deg] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-subtle transition-transform duration-300 hover:rotate-0">
            <ImagePlus className="size-5" strokeWidth={1.6} />
            <span className="text-[11px]">{busy ? "读取中…" : "放一张照片"}</span>
          </span>
        </FileButton>
      )}
      {msg && <p className="mt-1.5 text-[10px] leading-4 text-warn">{msg}</p>}
    </section>
  );
}

/** 时间便签：本机时间 + 日期，纯装饰。 */
function NowNote() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(t);
  }, []);

  const nextDate = useApp((s) => sortDates(s.dates)[0] ?? null);
  const nextLabel = nextDate
    ? `${countdown(nextDate.at, nextDate.yearly).label} · ${nextDate.title}`
    : null;

  const time = now
    ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    : "--:--";
  const day = now ? `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}` : "";

  return (
    <section className="aster-card relative overflow-hidden rounded-[1.5rem] border border-line p-3">
      {/*
        时间下面那块空白：一个装糖果的玻璃罐 + 旁边散落的几颗糖。
        用户："咱们画一个装糖果的玻璃罐，旁边还散落着几颗糖果。"
        （上一版我看成了"玻璃管"，画了根棍子 😅）
      */}
      <CandyJar className="right-1 bottom-1 h-32 w-[6.25rem] opacity-85" />
      <p className="relative mb-2 text-[10px] tracking-[0.22em] text-subtle uppercase">right now</p>
      <p
        className="relative font-serif text-[2.1rem] leading-none font-medium tabular-nums"
        suppressHydrationWarning
      >
        {time}
      </p>
      <p className="relative mt-1 font-mono text-[10px] text-subtle" suppressHydrationWarning>
        {day}
      </p>
      {nextLabel && (
        <p className="relative mt-2.5 rounded-xl bg-chip px-2.5 py-2 text-[11px] leading-4 text-muted">
          {nextLabel}
        </p>
      )}
      <NowPlayingLine />
    </section>
  );
}

/** 便签里那一小行"正在听"。没有歌就不显示。 */
function NowPlayingLine() {
  const name = usePlayer((s) => {
    const t = s.tracks.find((x) => x.id === s.currentId);
    return t ? t.name : "";
  });
  const playing = usePlayer((s) => s.playing);
  if (!name) return null;
  return (
    <Link
      to="/play/listen"
      className="mt-2 flex items-center gap-1.5 rounded-xl bg-chip px-2.5 py-2 text-[11px] text-muted"
    >
      <Disc3 className={cn("size-3.5 shrink-0 text-accent", playing && "aster-spin")} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <ChevronRight className="size-3 shrink-0 text-subtle" />
    </Link>
  );
}
