import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronUp,
  Ghost,
  Menu,
  Mic,
  Paperclip,
  Pause,
  Play,
  Plus,
  Search,
  X,
} from "lucide-react";
import { prettySize } from "@/lib/attachments";
import { firstSegment } from "@/lib/segment";
import { Avatar } from "@/components/avatar";

/**
 * 这段文字里**有没有看得见的东西**。
 *
 * 为什么不用 `.trim()`：用户 m04513 报的「定时回复空气泡」里，那一条的正文是
 * 零宽字符 / 看不见的空白（模型偶尔会吐 `\u200b`、BOM 之类），`trim()` 判它"非空"，
 * 于是气泡照常画出来、里面一个字都没有 —— 看着就是一个空的圆角框。
 * 这里把零宽字符一起剥掉再判。
 */


/**
 * 去掉 **Markdown 记号**之后再判一次空。
 *
 * 为什么还得多这一层：`**`、`>`、`-`、`` ` ``、`[]()` 这些符号在正文里"看得见"，
 * 但 Markdown 渲染出来是空的 —— 用户 m07120 截图里那个**空气泡**就是这种：
 * 分段里有一段只剩记号/空白，气泡照画（还带 min-w），里面什么都没有。
 */
function hasRenderedText(s: string | undefined | null): boolean {
  if (!s) return false;
  const bare = s
    /*
      ⚠️ 2026-10（用户 m09523 截图：定时唤醒那条消息两段之间多一个空框）：
      **图片/链接语法要先整段删掉再判空**。原来的写法只删 `!` `[` `]` `(` `)`
      这几个符号，`![]( )`、`![](null)` 这种"空图片"会剩下一个 URL 残留被当成正文，
      于是画出一个没有内容的图片框。链接则只保留可读文字（`[看图]( )` → 「看图」）。
      空地址的（`![]( )`、`[看图]( )`）要单独处理：Markdown 不会解析它们，
      会原样显示成一行括号，等于一个空框。
    */
    .replace(/!\[[^\]]*\]\(\s*\)/g, "")
    .replace(/\[([^\]]*)\]\(\s*\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // 「只有序号/列表符、没有内容」的一行（`1.`、`-`、`•`）—— 渲染成空列表项就是空框
    .replace(/^\s*(?:\d+[.)]|[-*+•])\s*$/gm, "")
    // HTML 实体写成的空白 / 裸 HTML 标签（`<br>`、`<div></div>`）渲染出来都没有字
    .replace(/&(?:nbsp|ensp|emsp|thinsp|zwnj|zwj);/gi, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/[*_~#>`!|()[\]]/g, "")
    .replace(/[\s\u200b-\u200f\u2060\ufeff]/g, "");
  return bare.length > 0;
}

/**
 * 只剩标点/符号（`·`、`。`、`-`、`…`、`——`、`)）`）也算"没内容"。
 *
 * 为什么还要这一层：模型偶尔会把分隔符单独输出成一个 part（真机截图里那个
 * "一个小圆点的气泡"），剥掉 Markdown 记号后它还剩一个 `·`，`hasRenderedText`
 * 判它有字，于是画一个 `min-w-[4em]` 的小框，看起来就是空气泡。
 */
function isPunctOnly(s: string | undefined | null): boolean {
  if (!s) return true;
  return /^[\s\p{P}\p{S}]*$/u.test(s);
}

/**
 * 最后一道兜底：**渲染完真的没字，就把这颗气泡藏掉**。
 *
 * 为什么还要这一层（用户 m09523 截图：定时唤醒那条两段之间多一个空框）：
 * `hasRenderedText` 是拿字符串猜的，可有些写法"有字"却渲染不出任何东西——
 * 空地址图片 `![]( )`、只有序号的一行 `1.`、未知标记…… 猜漏一个就是一个空框。
 * 这里在挂载后量一次 `innerText`：没有可见文字、也没有图片/视频/画布，
 * 就 `display: none`。用回调 ref（commit 阶段）所以不会闪一下再消失。
 */
/**
 * 渲染前的轻量清理：只处理**空地址**的图片/链接。
 *
 * `[看图]( )` 这种 Markdown 不认（地址是空的），会原样显示成一行括号，
 * 屏幕上就是"一个带括号的空框"。这里把空地址链接压成纯文字、空地址图片直接删掉。
 */
function cleanForRender(s: string): string {
  return stripActionLines(s)
    .replace(/!\[[^\]]*\](\(\s*\))/g, "")
    .replace(/\[([^\]]+)\]\(\s*\)/g, "$1");
}

function hideIfRenderedEmpty(el: HTMLDivElement | null): void {
  if (!el) return;
  const hasText = el.innerText.trim().length > 0;
  const hasMedia = el.querySelector("img, video, canvas, hr") !== null;
  el.style.display = hasText || hasMedia ? "" : "none";
}
import { Markdown } from "@/components/markdown";
import { Composer } from "@/components/chat/composer";
import { MessageActions } from "@/components/chat/message-actions";
import { ThinkingSheet } from "@/components/chat/thinking-sheet";
import { ToolProcess } from "@/components/chat/tool-process";
import { SummaryLine } from "@/components/chat/summary-line";
import { Ticker } from "@/components/chat/ticker";
import { DrawerSky, DrawerCosmos } from "@/components/chat/drawer-decor";
import { resolveAiName } from "@/lib/branding";
import { crumb } from "@/lib/breadcrumbs";
import { greetingFor } from "@/lib/greeting";
import { usePlayer } from "@/lib/player";
import { useApp } from "@/lib/store";
import { transcribe } from "@/lib/voice-service";
import type { Attachment } from "@/lib/types";
import { stripActionLines, useChatStream } from "@/lib/use-chat";
import { useActivity } from "@/lib/use-activity";
import { chatFontPx } from "@/lib/ux";
import { cn, formatClock } from "@/lib/utils";

/**
 * **引用头**：发送引用时把 `> 引用：xxx\n\n正文` 拼在你这条消息前面（见下面 Composer 的 onSend）——
 * 这样你和他都看得见引的是哪句、模型也能从上下文读到。
 *
 * 但**显示**时不许把它当正文摆在气泡里（用户 m01498 第 1 条："引用修改在气泡下面引用，
 * 跟微信那样"）：这里把它摘出来，气泡**下面**单独摆一条小灰条。数据本身不动 ——
 * 引用仍然原样存在消息正文里，所以历史消息、模型上下文全都不受影响。
 */
const QUOTE_HEAD = /^>\s*引用\s*[：:]\s*([^\n]*)\n+([\s\S]*)$/;

function splitQuote(content: string): { quote: string | null; body: string } {
  const m = QUOTE_HEAD.exec(content);
  if (!m) return { quote: null, body: content };
  return { quote: m[1]!.trim(), body: m[2]! };
}

/** 气泡下面的引用小条（灰底 + 左侧一道竖线，跟微信那套一致） */
function QuoteBar({ text }: { text: string }) {
  return (
    <p className="mt-1 max-w-[85%] truncate rounded-lg border-l-2 border-line bg-chip/80 px-2.5 py-1.5 text-[11px] text-muted">
      {text}
    </p>
  );
}

export function ChatView() {
  const conversations = useApp((s) => s.conversations);
  const activeId = useApp((s) => s.activeId);
  const settings = useApp((s) => s.settings);
  const model = useApp((s) => s.model);
  const [menu, setMenu] = useState(false);
  /** 会话列表每行的 ⋯ 菜单（第 3 条：重命名 / 置顶 / 删除 收进一个菜单） */
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  /** **自绘改名对话框**（用户第 7 条：系统那个白底 CANCEL/OK 太不搭） */
  const [renameFor, setRenameFor] = useState<{ id: string; text: string } | null>(null);
  /** 底部弹出的思考链（Claude 那种一层）—— null 表示没打开 */
  const [thinkSheet, setThinkSheet] = useState<{
    text: string;
    ms?: number;
    live?: boolean;
  } | null>(null);
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  /**
   * **悬浮对话框**（用户 m02002："对话框独立，改成悬浮聊天浮层，然后消息是可滚动消息流，
   * 滑动时会一条条从对话框过去，而对话框保持不动"）。
   *
   * 做法：输入框那一块从"文档流里的最后一行"改成**浮在消息区上面**（absolute），
   * 消息区因此铺满整屏、真的从它下面滑过去。
   * 代价是最后一条消息会被它盖住 → 量它的实际高度，给消息列表补等量的底部留白
   * （输入框长高了留白跟着长，用 ResizeObserver，写死一个数迟早不够）。
   */
  const composerWrap = useRef<HTMLDivElement>(null);
  const [padBottom, setPadBottom] = useState(168);
  useEffect(() => {
    const el = composerWrap.current;
    if (!el) return;
    const sync = () => {
      const h = Math.round(el.offsetHeight);
      setPadBottom(h + 14);
      /**
       * 顺手把这块的高度发布成 CSS 变量：**全屏浮着的东西**（全局音频悬浮球，
       * `audio-widget.tsx`）得知道输入框占了多高，否则球会落在输入框底下、点都点不到
       * （用户 m03024 第 5 条："小球不能遮挡底部导航等关键按钮"）。
       * 这个值**已经含底部导航的高度**（`pb-composer` 里加了它）。
       */
      document.documentElement.style.setProperty("--q-composer-h", `${h}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      // 离开对话页要把变量撤掉，不然别的页面的悬浮球会被顶得老高
      document.documentElement.style.removeProperty("--q-composer-h");
    };
  }, []);
  const conv = conversations.find((c) => c.id === activeId) ?? null;
  const empty = !conv || conv.messages.length === 0;
  const aiName = resolveAiName(settings.aiName);
  const hydrated = useApp((s) => s.hydrated);
  /** 他现在醒着还是打盹（只由 lib/awake.ts 写）—— 用户 m10324 要能一眼看到 */
  const awakeState = useApp((s) => s.awakeState);
  // 发送逻辑与语音页共用（见 lib/use-chat.ts）
  const { busy, liveId, step, send, regenerate } = useChatStream();
  // 感知层：告诉 AI 你此刻在干什么（上一条活动会留在轨迹里）
  useActivity("在和你聊天", conv?.title ?? "新对话");

  /*
    「他现在知道什么」——原来这句在 Composer（对话框里）占一行，
    现在挪到**顶部栏**（用户要求："不要放在对话框占地方"）。
    所以订阅提到这一层来，因为顶部栏在 ChatView 里。
  */
  const activity = useApp((s) => s.activity);
  const nowPlaying = usePlayer((s) => {
    const t = s.tracks.find((x) => x.id === s.currentId);
    return t ? `${t.name}${s.playing ? " · 播放中" : " · 暂停"}` : "";
  });

  // 他请求「打开对话列表」时，落到这一页
  const openPanel = useApp((s) => s.openPanel);
  useEffect(() => {
    if (openPanel?.id !== "chat_drawer") return;
    useApp.getState().setPanel(null);
    setMenu(true);
  }, [openPanel]);

  // 抽屉打开时把底部导航收起来（用户在抽屉里选完会关抽屉，导航就回来）
  useEffect(() => {
    const root = document.documentElement;
    if (menu) root.dataset.drawerOpen = "1";
    else delete root.dataset.drawerOpen;
    return () => {
      delete root.dataset.drawerOpen;
    };
  }, [menu]);

  /**
   * ⭐ **自动跟滚**（用户 m01498 第 4 条："ai回复消息时，界面不能翻动，会上下抽搐，
   * 改一下，即使他在回复我也可以上翻界面"）。
   *
   * 以前是"消息一变就 `scrollTop = scrollHeight`" —— 流式回复每 100ms 就改一次内容，
   * 于是你手指往上翻的同一时刻它又把你拽回底部：表现就是**抽搐**、翻不上去。
   * 现在只在"你本来就在底部"（离底 < 80px）时才跟着滚；你一上翻，它就老实待着不动，
   * 由右下角「↓ 回到最新」按钮决定什么时候回来。
   */
  const stickBottom = useRef(true);
  /**
   * ⭐ 用户 m03024 第 2 条（"只有按住不动才能弹层，滑动停留不能有弹层，跟微信一样"）：
   *   列表**只要滚动过**（手指拖动、惯性滑动、流式自动跟滚都算）就撤销"正按着的那次长按"。
   *   为什么不能只靠 pointermove 的位移阈值：安卓一旦判定为滚动手势就会发 `pointercancel`，
   *   之后再没有 pointermove；可那次 cancel **也可能是**"长按 select-none 气泡"的触感 cancel
   *   （两件事长得一模一样，见 quotePress 上面那段），所以 pointercancel 不能无条件清零。
   *   真正能区分的是**滚动本身** —— 它一定会发 scroll 事件。
   *   这里用 ref 转发，避免把 quotePress 里那三个 ref 提前声明（会打乱文件顺序）。
   */
  const cancelPressRef = useRef<() => void>(() => {});
  useEffect(() => {
    const el = scroller.current;
    if (!el || !stickBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [conv?.messages, liveId]);

  /** 翻上去超过一屏半就浮出「回到最新」 */
  const [showJump, setShowJump] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      /* 一滚动就不算"按住不动"了 —— 那条待发的长按卡片立刻作废 */
      cancelPressRef.current();
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      /* 离开底部就停手、回到最底（<24px）才重新跟上。
         中间那段（24~80）**不翻状态** —— 手指拖到一半时来回跨过 80 也不会抖 */
      if (gap > 80) stickBottom.current = false;
      else if (gap < 24) stickBottom.current = true;
      setShowJump(gap > 420);
    };
    /* ⭐ 手指一按就"放手"：流式还在蹦的时候，你指尖刚碰上去它就该停，
       而不是等你拖出 80px —— 那 80px 里它可能已经把你拽回底部一两次了 */
    const onGrab = () => {
      stickBottom.current = false;
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("pointerdown", onGrab, { passive: true });
    el.addEventListener("touchstart", onGrab, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("pointerdown", onGrab);
      el.removeEventListener("touchstart", onGrab);
    };
  }, [conv?.id]);

  /** 换会话时先当成"贴在底部"（不然上个会话翻到一半，切过来会停在半空） */
  useEffect(() => {
    stickBottom.current = true;
    setShowJump(false);
  }, [conv?.id]);

  /**
   * 对话内搜索。
   *
   * 用户："对话长了，最上面的消息不好翻了…塞一个简单的信息翻找"。
   * 做法：搜正文 + 思考过程，命中数显示成 i/N，上下键逐条跳，
   * 跳过去的那条闪一下（不然不知道跳到哪了）。
   */
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hitIndex, setHitIndex] = useState(0);
  const [flashId, setFlashId] = useState<string | null>(null);

  /**
   * **引用**（用户："长按引用就可以"）。
   *
   * 语义（跟用户定的）：引用的是**你点中的那一个气泡** —— 开着分段回复时他一条消息有
   * 好几个气泡，长按哪一段就引哪一段；关掉分段回复时只有一个气泡，于是自然就是"引整条"。
   * 发送时把 `> 引用：…` 拼在你这条消息**前面**：你和他都看得见引的是哪句，
   * 他也从上下文里知道该回应哪句 —— **不改任何数据格式**。
   */
  const [quote, setQuote] = useState<{ text: string } | null>(null);
  /** **修改消息**（用户要的最后一件）：只允许改自己发的 —— 改完把后面那条回复**重新生成**一次 */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  /**
   * 换了一对话（或从抽屉里切走）→ **退出修改**。
   * 不然输入框上那行"正在修改这一条"会跟着跑到别的对话里，
   * 而那条消息根本不在这个对话里（用户 m01893：编辑只走下面这一个输入框，别串台）。
   */
  useEffect(() => {
    setEditing(null);
  }, [activeId]);
  const pressTimer = useRef(0);
  /** 长按时的起点：手指真的滑动过（> 10px）就当"在滚列表"，撤销长按 */
  const pressFrom = useRef<{ x: number; y: number } | null>(null);
  /** 这次按下是手指还是鼠标（决定 contextmenu 要不要立刻开卡片，见 quotePress） */
  const pressType = useRef<string>("");
  /**
   * **长按菜单**（用户第 2/5 条）：长按任意消息 → **App 内**浮层（不是浏览器/系统那个），
   * 里面至少给"引用这一句"（分段时带的是**你按的那一段**）、复制，
   * 自己的消息多一个"修改"，他的消息多一个"重新生成"。
   * 下一步：把气泡下面那排图标（赞/踩/朗读/分享/收藏）也搬进来，只留统计那行。
   */
  const [msgMenu, setMsgMenu] = useState<{ id: string; part: string } | null>(null);
  /** 点图片全屏看大图（用户 m01498 第 3 条："照片要能点击放大"）—— 存 dataUrl，null = 关着 */
  const [viewImg, setViewImg] = useState<string | null>(null);
  const quotePress = (id: string, raw: string) => {
    const brief = raw.replace(/\s+/g, " ").trim();
    /**
     * ⚠️ **长按自己的消息为什么一直没卡片**（真机踩了两回，这次弄明白了）：
     *   气泡上有 `select-none`。安卓长按它时**没有可选中/可复制的东西**，
     *   所以 `contextmenu` **不来**；可它照样把 pointer 序列 `pointercancel` 掉（只有触感）。
     *   于是两条路一起死：计时器被 cancel 清掉、contextmenu 又不来。
     *   而"他"那条消息里的文字是可选的 → contextmenu 会来 → 一直是靠那个兜底生效的。
     * 现在的规则：
     *   · 计时器 **600ms**（用户 m01498 第 5 条："长按弹层的时间长一些，不然我翻上下文，
     *     还没停留多久，立马出现弹层很影响体验" —— 以前是 380ms，太灵敏）；
     *   · `pointercancel` / `pointerleave` **不再无条件清零** —— 只有真滑动过才撤销；
     *   · `pointerup`（正常松手）照旧清零，免得"点一下"过一会儿自己弹出来；
     *   · ⭐ 用户 m03024 第 2 条："**只有按住不动才能弹层，滑动停留不能有弹层**（跟微信一样）"：
     *     位移阈值收到 **8px**（原来 10px），而且**列表一滚动就作废**（`cancelPressRef`，
     *     在 scroller 的 scroll 监听里调）—— 滚完手指停在原地那 600ms 也不会再弹。
     *   · `contextmenu` **只在鼠标右键时**开卡片（用户 m02163 第 1 条：手机上"他的"气泡
     *     文字可选 → 安卓长按会提前（约 500ms）发 contextmenu → 卡片比 600ms 更早弹出来，
     *     和"我的"气泡手感不一致。现在手机上一律只认这个 600ms 计时器，两类气泡完全一样；
     *     右键仍然立刻开（那是"主动点"不是"停留"）。`preventDefault` 照旧压掉系统菜单。
     */
    const cancelIfMoved = () => {
      if (pressFrom.current === null) window.clearTimeout(pressTimer.current);
    };
    /** 立刻作废这次长按（滚动时由 scroller 调） */
    cancelPressRef.current = () => {
      pressFrom.current = null;
      window.clearTimeout(pressTimer.current);
    };
    return {
      onPointerDown: (e: React.PointerEvent) => {
        if (!brief) return;
        pressType.current = e.pointerType;
        pressFrom.current = { x: e.clientX, y: e.clientY };
        pressTimer.current = window.setTimeout(() => {
          pressFrom.current = null;
          crumb("longpress", "计时器开卡片");
          setMsgMenu({ id, part: brief });
        }, 600);
      },
      onPointerMove: (e: React.PointerEvent) => {
        const from = pressFrom.current;
        if (!from) return;
        /* 8px：手指稍微一挪就不再算"按住不动"（微信同款手感） */
        if (Math.abs(e.clientX - from.x) > 8 || Math.abs(e.clientY - from.y) > 8) {
          pressFrom.current = null;
          window.clearTimeout(pressTimer.current);
        }
      },
      onPointerUp: () => {
        pressFrom.current = null;
        window.clearTimeout(pressTimer.current);
      },
      onPointerLeave: cancelIfMoved,
      onPointerCancel: cancelIfMoved,
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        /* 手机上"停留"不该比 600ms 更早弹卡片：只让计时器那一条路说话 */
        if (pressType.current === "touch") return;
        pressFrom.current = null;
        window.clearTimeout(pressTimer.current);
        if (brief) {
          crumb("longpress", "右键开卡片");
          setMsgMenu({ id, part: brief });
        }
      },
    };
  };

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !conv) return [] as string[];
    return conv.messages
      .filter((m) => `${m.content}\n${m.thinking}`.toLowerCase().includes(q))
      .map((m) => m.id);
  }, [query, conv]);
  const hitKey = hits.join(",");

  /** 命中集合或游标一变，就滚过去并闪一下 */
  useEffect(() => {
    if (!hitKey) {
      setFlashId(null);
      return;
    }
    const ids = hitKey.split(",");
    const id = ids[Math.min(hitIndex, ids.length - 1)]!;
    const el = document.getElementById(`msg-${id}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashId(id);
    const timer = window.setTimeout(() => setFlashId(null), 1700);
    return () => window.clearTimeout(timer);
  }, [hitKey, hitIndex]);

  // 换关键词时游标回到第一条
  useEffect(() => {
    setHitIndex(0);
  }, [query]);

  return (
    /* relative：悬浮的对话框（absolute）以这一块为参照 —— 见上面 composerWrap 那段注释 */
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      {/*
        ⚠️ 顶部内边距**故意很小**（2026-11 用户装机后："是我圈起来的那块导航栏给往上稍微
        挪一点点吧，因为空的太大了"）。
        背景铺满系统栏之后，安全区高度已经由**外壳**（`.app-inset-top`）让出来了，
        这里只要再留一点点呼吸感 —— 原来是 0.75rem(12px)，加上状态栏那 30~44px 就显得空。
        ⚠️ 网页版没有外壳 inset，env() 也是 0，所以这里仍留 0.25rem 兜底，别把它删成 0。
      */}
      <header className="flex items-center gap-1 px-4 inset-top-25 pb-2">
        <button
          type="button"
          aria-label="对话列表"
          className="flex size-11 shrink-0 items-center justify-center"
          onClick={() => setMenu(true)}
        >
          <Menu className="size-6" strokeWidth={1.6} />
        </button>

        {/*
          「他现在知道什么」挪到**顶部栏中间**了。
          用户："把小克现在知道那行字挪到顶边栏吧，不要放在对话框占地方
                这样显得界面更宽阔一点"
          放不下就自己往左滚（Ticker），不用点。
        */}
        {(activity || nowPlaying) && (
          <Ticker
            className="min-w-0 flex-1 px-1"
            prefix={`${aiName} 知道`}
            text={`${activity ? `${activity.label}${activity.detail ? ` · ${activity.detail}` : ""}` : ""}${
              nowPlaying ? `${activity ? " · " : ""}正在听 ${nowPlaying}` : ""
            }`}
          />
        )}

        <div className="flex shrink-0 items-center">
          <button
            type="button"
            aria-label="搜索对话内容"
            className="flex size-11 items-center justify-center"
            onClick={() => {
              setFindOpen((v) => !v);
              if (findOpen) {
                setQuery("");
                setFlashId(null);
              }
            }}
          >
            <Search className="size-5" strokeWidth={1.7} />
          </button>
          <button
            type="button"
            aria-label="语音模式"
            className="flex size-11 items-center justify-center"
            onClick={() => void navigate({ to: "/voice" })}
          >
            <Mic className="size-6" strokeWidth={1.6} />
          </button>
          <button
            type="button"
            aria-label="临时对话"
            className="flex size-11 items-center justify-center"
            onClick={() => useApp.getState().newChat({ incognito: true })}
          >
            <Ghost className="size-6" strokeWidth={1.6} />
          </button>
        </div>
      </header>

      {/* 搜索条：命中数 + 上下切换（像浏览器里那个 2/2） */}
      {findOpen && (
        <div className="flex items-center gap-2 px-4 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-chip px-3">
            <Search className="size-3.5 shrink-0 text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits.length > 0) {
                  setHitIndex((i) => (i + 1) % hits.length);
                }
                if (e.key === "Escape") setFindOpen(false);
              }}
              placeholder="在这段对话里找…（正文和思考过程都搜）"
              className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
            {query.trim() && (
              <span className="shrink-0 text-[11px] text-muted" suppressHydrationWarning>
                {hits.length === 0 ? "没找到" : `${Math.min(hitIndex + 1, hits.length)}/${hits.length}`}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="上一条"
            disabled={hits.length === 0}
            onClick={() => setHitIndex((i) => (i - 1 + hits.length) % Math.max(1, hits.length))}
            className="flex size-9 items-center justify-center rounded-full bg-chip disabled:opacity-35"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            aria-label="下一条"
            disabled={hits.length === 0}
            onClick={() => setHitIndex((i) => (i + 1) % Math.max(1, hits.length))}
            className="flex size-9 items-center justify-center rounded-full bg-chip disabled:opacity-35"
          >
            <ChevronDown className="size-4" />
          </button>
          <button
            type="button"
            aria-label="关闭搜索"
            onClick={() => {
              setFindOpen(false);
              setQuery("");
              setFlashId(null);
            }}
            className="flex size-9 items-center justify-center rounded-full bg-chip"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* 临时对话不在抽屉里，所以这里必须给一条明确的退路 */}
      {conv?.incognito && (
        <div className="mx-4 mt-1 flex items-center gap-2.5 rounded-2xl border border-line bg-chip px-3.5 py-2.5">
          <Ghost className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 text-[11px] leading-4 text-muted">
            临时对话 · 不写进本地记录，也不出现在对话列表
          </span>
          <button
            type="button"
            onClick={() => useApp.getState().exitIncognito()}
            className="shrink-0 rounded-full bg-surface px-3.5 py-1.5 text-[12px] font-medium text-fg"
          >
            退出
          </button>
        </div>
      )}

      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
          <Avatar role="ai" size={48} />
          <h1 className="mt-6 font-serif text-[1.85rem] font-medium tracking-tight text-fg">
            {/* 问候语按「现在是几点」算 —— 服务端和客户端算出来可能不同
                （部署到 UTC 服务器时必然不同），所以挂载后再显示。 */}
            {hydrated ? greetingFor(settings.displayName) : "\u00A0"}
          </h1>
          {conv?.incognito && (
            <p className="mt-2 text-sm text-muted">临时对话不会写入本地记录</p>
          )}
        </div>
      ) : (
        /**
         * 消息区外面包一层 relative：这样「回到最新」按钮能贴在这块区域的底部
         * （= 输入框上方），而不是飘到输入框上面去压住它。
         */
        <div className="relative min-h-0 flex-1">
          <div ref={scroller} className="h-full overflow-y-auto">
            {/*
              ⚠️ **水平内边距必须跟输入框那条一致**（都是 16px）——2026-11 用户实测：
              "聊天气泡的边距能跟下面的对话框对齐吗？他俩其实是错开的，看上去很不协调。"

              原因是两边用了不同的值：气泡列 `px-2`(8px) vs 输入框外壳 `px-4`(16px)
              → 差 8px，一眼就看出"对不齐"。现在统一 16px。

              历史（别改回去）：px-5 + max-w-[86%] → 用户嫌"缩在中间太局促"，
              所以宽度仍然让它**占满内容列**（`max-w-full`），只是两侧留白跟输入框一致。
              短消息仍然靠它该靠的那一边（我的靠右、他的靠左）—— 那是气泡宽度跟着文字走，
              不是被挤住了。
            */}
            <ol
              className="space-y-5 px-3.5 pt-4"
              style={{
                fontSize: `${chatFontPx(settings.chatFontSize)}px`,
                /* paddingBottom 由悬浮对话框的实测高度决定（见 composerWrap）：
                   这样最后一条消息能滑到它**上面**，不会被浮层盖住 */
                paddingBottom: padBottom,
              }}
            >
            {/*
              ⚠️ 2026-10（用户 m09634）：这条线原来放在**整个列表最前面**，
              于是它永远钉在顶上、上方什么都没有 —— 看着像"页面被截断"、
              上面的消息翻不到了。其实原文一条都没删，只是线站错地方了。
              现在它插在"摘要覆盖的最后一条之后"，跟着数据走。
            */}
            {conv!.messages.map((m, i) => {
              const mine = m.role === "user";
              const streaming = liveId === m.id;
              /**
               * ⭐ 空壳消息（用户 m03533："定时回复的气泡会这样"——截图里是一个
               * 只有头像、没有说话内容的圆）。
               *
               * 定时任务 / 主动唤醒是**先建一条空消息、再把内容填进去**的
               * （`store.beginScheduledReply` → 模型流式 → `finalizeAssistant`）。
               * 中间那几秒 `content` 是空串，而且这类消息不走 `liveId`
               * （`liveId` 只跟聊天页自己发的请求走），于是 `streaming` 是 false，
               * 正文那段就渲染成 null —— 只剩头像 + 徽章，看着像"卡住了"。
               *
               * 兜法：内容为空的他的消息分两种 ——
               *   · 刚建出来不到 2 分钟：当占位，显示"正在写回复…"；
               *   · 更早的还是空：说明那次没写成（历史里留下的空壳），整条不渲染。
               */
              const visibleParts = (m.parts ?? []).filter(
                (p) => hasRenderedText(p) && !isPunctOnly(p),
              );
              /*
                ⚠️ 这里原来用 `hasVisibleText`（只认"有没有字"），于是正文只剩 `**`、
                `>`、`[]()` 这类 Markdown 记号的空壳仍算"有内容"，渲染出来就是一个
                只有两三个符号的小气泡（用户 m07120："定时唤醒多余气泡"）。
                改用 `hasRenderedText`：把记号剥掉之后没字，就按空壳处理。
              */
              const noBody =
                !mine &&
                !hasRenderedText(m.content) &&
                visibleParts.length === 0 &&
                !(m.attachments && m.attachments.length);
              const pendingPlaceholder =
                noBody && (streaming || Date.now() - (m.createdAt ?? 0) < 120_000);
              if (noBody && !pendingPlaceholder) return null;
              return (
                <Fragment key={m.id}>
                  {/* 摘要线：在"摘要覆盖的最后一条"之后插一条，点开才是摘要 */}
                  {i === (conv!.summary?.upToIndex ?? 0) && (
                    <li>
                      <SummaryLine conversationId={conv!.id} />
                    </li>
                  )}
                <li
                  id={`msg-${m.id}`}
                  className={cn(
                    /*
                      ⭐ 用户 m02250 / m02816 定稿的**方案丁**（"头像放在上面，气泡另起一行"）：
                        原来是一条 `flex` 行里"头像 + 气泡"并排，头像会把气泡往里顶：
                        他那边顶右 40px、我这边顶左 40px → **气泡左右边距不一样大**，
                        跟底下悬浮对话框的边也就错开（用户原话"会有交错"）。
                        现在改成**竖着一列**：第一行是"头像 + 名字 + 时间"，气泡单独一行，
                        于是气泡左右都贴同一条 14px 边距、长度也能用满整行。
                        `mine ? items-end : items-start` 只管整列靠哪边。
                    */
                    "flex flex-col rounded-3xl transition",
                    // 搜索跳过来的那条闪一圈，不然不知道跳到哪了
                    flashId === m.id && "aster-highlight",
                  )}
                >
                  {/*
                    ⭐ 方案丁：头像挪到**名字这一行**（他的名字在左、我的在右），气泡另起一行。
                    `w-full` + `items-start/end` 保证气泡能长到整条边距、靠它该靠的那边。
                  */}
                  <div
                    className={cn(
                      "flex w-full min-w-0 flex-col gap-1",
                      mine ? "items-end" : "items-start",
                    )}
                  >
                    {/*
                      名字 + 时间那一行（现在**头像也在这行**）。
                      用户那侧要**整体靠右**，所以用 justify-end。
                      ⚠️ 不能同时写 flex-row-reverse —— 它会把主轴翻过去，
                         justify-end 于是又变回"靠左"，两者互相抵消（我踩过）。
                      头像用 26px（用户 m02816 选的）：名字行里够看，整条消息又不显臃肿。
                    */}
                    <div
                      className={cn(
                        "mb-1 flex items-center gap-2",
                        mine ? "justify-end" : "justify-start",
                      )}
                    >
                      {mine ? (
                        <>
                          <span className="text-[11px] text-subtle">{formatClock(m.createdAt)}</span>
                          <span className="text-[13px] font-medium text-fg">
                            {settings.displayName}
                          </span>
                          <Avatar role="user" size={26} />
                        </>
                      ) : (
                        <>
                          <Avatar role="ai" size={26} />
                          <span className="text-[13px] font-medium text-fg">{aiName}</span>
                          {/*
                            「他这会儿在干什么」（用户 m04513 选的方案 B）：
                            名字后面一枚小胶囊 —— 钓鱼中 / 落子 / 浇花 / 空闲。
                            状态是**按条**存的（`finalizeAssistant` 收尾时抄进去），
                            所以翻历史看到的是"当时"，不是"现在"。
                          */}
                          {(() => {
                            /**
                             * 用户 m10324："把他头像旁边的状态加一个沉睡还是醒着的，
                             * 我本意是想我点开 app 他就醒着，所以现在是个什么情况"。
                             *
                             * 所以**只有最新一条**显示实时状态（醒着 / 打盹）；
                             * 更早的消息仍然显示当时那个动作状态（钓鱼中 / 浇花），
                             * 两者不能混：历史是"当时"，最新是"现在"。
                             */
                            const isLatest = i === conv!.messages.length - 1;
                            if (isLatest && !mine) {
                              const awake = awakeState === "awake";
                              return (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] leading-none",
                                    awake
                                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                                      : "border-line bg-chip text-muted",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "size-1.5 rounded-full",
                                      awake ? "bg-emerald-500" : "bg-subtle",
                                    )}
                                  />
                                  {awake ? "醒着" : "打盹"}
                                </span>
                              );
                            }
                            if (!m.status) return null;
                            return (
                              <span className="rounded-full border border-line bg-chip px-1.5 py-0.5 text-[10px] leading-none text-muted">
                                {m.status}
                              </span>
                            );
                          })()}
                          {/*
                            来源徽章：定时任务和主动唤醒**共用** `scheduled` 这个标记，
                            所以要看 `origin` 分开说（用户要求）：
                              · origin === "wake" → 「他主动说的」
                              · 其余（"cron" 或老消息没这个字段）→ 「定时 · 他自己说的」
                            ⚠️ 老消息没有 origin，必须保持原样显示，不能因为"读不到来源"就不显示。
                          */}
                          {m.scheduled && (
                            <span className="rounded-full bg-chip px-1.5 py-0.5 text-[10px] text-muted">
                              {m.origin === "wake" ? "他主动说的" : "定时 · 他自己说的"}
                            </span>
                          )}
                          <span className="text-[11px] text-subtle">{formatClock(m.createdAt)}</span>
                        </>
                      )}
                    </div>

                    {mine ? (
                      (() => {
                        const { quote: q, body } = splitQuote(m.content);
                        /**
                         * 用户 m01498 第 3 条："照片要能点击放大…另外照片不要有气泡，
                         * 就是一张图片发过去，不要把他放在汽泡里"。
                         * 所以图片/表情**裸着**摆（不套气泡）、点一下进全屏；
                         * 语音和文件还留在气泡里（它们不是"一张图"）。
                         */
                        const pics = (m.attachments ?? []).filter(
                          (a) => a.dataUrl && a.kind !== "audio",
                        );
                        /**
                         * 语音**单独一坨**（用户 m11313：像微信那样）。
                         * 它不套正文气泡：微信的语音气泡本身就是"内容"。
                         */
                        const voices = (m.attachments ?? []).filter((a) => a.kind === "audio");
                        const rest = (m.attachments ?? []).filter(
                          (a) => a.kind !== "audio" && !a.dataUrl,
                        );
                        return (
                          /* ⚠️ `w-full` 不能省：这是 flex 列里的一个 flex 项，
                             不写它就会被"内容最大宽度"撑开（长消息会横向溢出，
                             气泡的 max-w-full 也会以它为基准算错）—— 验收脚本里
                             "没有横向溢出"那条断言就是防这个的。 */
                          <div className="flex w-full flex-col items-end">
                            {pics.length > 0 && (
                              <div className="flex max-w-full flex-wrap justify-end gap-1.5">
                                {pics.map((a) => (
                                  <button
                                    key={a.id}
                                    type="button"
                                    aria-label="看大图"
                                    className="p-0"
                                    onClick={() => setViewImg(a.dataUrl!)}
                                  >
                                    <img
                                      src={a.dataUrl}
                                      alt={a.kind === "sticker" ? "表情" : a.name}
                                      className={cn(
                                        "rounded-2xl object-contain",
                                        a.kind === "sticker"
                                          ? "size-24"
                                          : "max-h-56 min-h-16 w-auto min-w-16 max-w-full",
                                      )}
                                    />
                                  </button>
                                ))}
                              </div>
                            )}
                            {voices.length > 0 && (
                              <div className="mb-1 flex w-full flex-col items-end gap-1">
                                {voices.map((a) => (
                                  <VoiceBubble
                                    key={a.id}
                                    att={a}
                                    mine
                                    convId={conv!.id}
                                    msgId={m.id}
                                  />
                                ))}
                              </div>
                            )}
                            {(body || rest.length > 0) && (
                              <div
                                {...quotePress(m.id, body)}
                                className={cn(
                                  "w-max min-w-0 max-w-full select-none [-webkit-touch-callout:none] [touch-action:manipulation] space-y-1.5 rounded-2xl bg-chip px-3.5 py-2.5 text-[1em] leading-[1.7]",
                                  pics.length > 0 && "mt-1",
                                )}
                              >
                                {rest.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {rest.map((a) => (
                                        <span
                                          key={a.id}
                                          className="flex items-center gap-1.5 rounded-xl bg-surface px-2.5 py-1.5 text-[12px]"
                                        >
                                          <Paperclip className="size-3.5 text-muted" />
                                          <span className="max-w-40 truncate">{a.name}</span>
                                          <span className="text-[10px] text-subtle">
                                            {a.text ? "已读正文" : prettySize(a.size)}
                                          </span>
                                        </span>
                                    ))}
                                  </div>
                                )}
                                {body}
                              </div>
                            )}
                            {q && <QuoteBar text={q} />}
                          </div>
                        );
                      })()
                    ) : (
                      /* ⚠️ 同上：`w-full` 必须留（否则长回复会把这一列撑成"一行不换行"） */
                      <div className="w-full min-w-0">
                        {/*
                          他发的**语音气泡**（用户 m11313："他发给我也是语音气泡"）。
                          放在正文上方：语音是这条消息本身，正文只是气泡下的转写。
                         */}
                        {(m.attachments ?? []).some((a) => a.kind === "audio") && (
                          <div className="mb-1.5 flex flex-col items-start gap-1">
                            {(m.attachments ?? [])
                              .filter((a) => a.kind === "audio")
                              .map((a) => (
                                <VoiceBubble
                                  key={a.id}
                                  att={a}
                                  convId={conv!.id}
                                  msgId={m.id}
                                />
                              ))}
                          </div>
                        )}
                        {/*
                          ⭐ agent loop 的进度：他现在走到第几步、正在执行哪个动作。
                          用户原话："这一轮我发出动作，成没成，要等下一轮结果回来才知道；
                          这一轮里我完全看不见。" —— 这一行 + 下面的「动手 N 次」明细
                          就是让他**在同一轮里**看得见。
                        */}
                        {streaming && step && (
                          <p className="mb-1.5 flex items-center gap-1.5 rounded-full bg-chip-flat px-3 py-1 text-[11px] text-muted">
                            <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                            {step.label}
                          </p>
                        )}
                        {/* 思考链不再占正文的地方 —— 点开从**底部弹一层**（Claude 那种）
                            （用户："改成 Claude 那种思考链，点开是从下面弹出来的那种，单独一层"） */}
                        {(streaming || (settings.showThinking && m.thinking)) && (
                          /* ⚠️ 胶囊上那个 `[-webkit-tap-highlight-color:transparent]` 是用户 m03024
                             第 4 条"点开之后胶囊上留一层白底"的**就地**兜底
                             （全局那条写在 styles.css 的 `:root` 里；这里再钉一遍，不依赖继承）。 */
                          <button
                            type="button"
                            onClick={() =>
                              setThinkSheet({
                                text: m.thinking,
                                ms: m.thinkingDurationMs,
                                live: Boolean(streaming && !m.content),
                              })
                            }
                            className="mb-1.5 flex items-center gap-1.5 rounded-full bg-chip-flat px-3 py-1 text-[11px] text-muted [-webkit-tap-highlight-color:transparent]"
                          >
                            {streaming && !m.content ? "正在思考…" : "已思考"}
                            {m.thinkingDurationMs && !streaming ? (
                              <span className="text-subtle">
                                （{Math.max(1, Math.round(m.thinkingDurationMs / 1000))} 秒）
                              </span>
                            ) : null}
                            <span className="text-subtle">点开看</span>
                          </button>
                        )}
                        {/* 弹层本身挂在页面根节点（见文件下方 <ThinkingSheet>）——
                            原来写在 messages.map 里面，每条消息挂一个全屏浮层，
                            既冗余又容易被消息区的滚动/重渲染带歪。 */}
                        {/* 他的回复也用气泡 —— 跟用户那条同一个尺寸和圆角，
                            差别只在左右与一条细边框，一眼能分出谁说的。 */}
                        {/*
                          **分段回复**（2026-11 用户要的："像发消息似的，可以发好几条"）：
                          · 流式期间**只显示第一段** —— 后面的等他写完再一条条冒出来。
                            不这么做的话，整条先显示出来、收尾再重排，内容会跳一下。
                          · 收尾后按 `m.parts` 一条一个气泡，**段间用 CSS 延迟**依次浮现
                            （延迟 = 设置里那个旋钮）。为什么不用计时器逐条挂载：
                            那样翻回历史会**重播一遍动画**，而且每多一条就多一份状态。
                          · `bubble-in` 只在"刚生成的那 20 秒内"加：老消息渲染出来就是全的。
                        */}
                        {(() => {
                          /**
                           * 语音模式下**正文不再单独出一个气泡**（用户 m11599：
                           * "他输出既有气泡又有文本，不可以这样，发语音就统一全是语音"）。
                           * 文字没有丢：它就在语音气泡下面那行转写里。
                           */
                          if ((m.attachments ?? []).some((a) => a.kind === "audio")) return null;
                          const parts =
                            !streaming && visibleParts.length > 1 ? visibleParts : null;
                          const delay = Math.max(400, settings.segmentDelayMs ?? 1200);
                          const fresh = Date.now() - (m.createdAt ?? 0) < 20_000;

                          if (parts) {
                            return (
                              <div className="space-y-1.5">
                                {parts.map((p, i) => (
                                  <div
                                    key={i}
                                    ref={hideIfRenderedEmpty}
                                    {...quotePress(m.id, cleanForRender(p))}
                                    className={cn(
                                      "w-max min-w-0 max-w-full select-none [-webkit-touch-callout:none] [touch-action:manipulation] rounded-2xl border border-line bg-chip px-3.5 py-2.5 text-[1em] leading-[1.7]",
                                      fresh && "bubble-in",
                                    )}
                                    style={fresh ? { animationDelay: `${i * delay}ms` } : undefined}
                                  >
                                    <Markdown text={cleanForRender(p)} />
                                  </div>
                                ))}
                              </div>
                            );
                          }

                          const liveText = streaming ? firstSegment(m.content) : m.content;
                          return hasRenderedText(liveText) && !isPunctOnly(liveText) ? (
                            <div
                              ref={hideIfRenderedEmpty}
                              {...quotePress(m.id, cleanForRender(liveText))}
                              className="w-max min-w-0 max-w-full select-none [-webkit-touch-callout:none] [touch-action:manipulation] space-y-1.5 rounded-2xl border border-line bg-chip px-3.5 py-2.5 text-[1em] leading-[1.7]"
                            >
                              {/*
                                ⚠️ 2026-10（用户："分段回复卡卡的…不是应该先出一条然后一条条吗"）：
                                **流式期间只写纯文本，不解析 Markdown** —— 原来是每 250ms 把越来越长的
                                正文整个重新解析一遍，越写越卡、还一段段地蹦。收尾那一次才解析
                                （`streaming` 转 false 之后走 Markdown）。省下的预算用来把
                                `use-chat` 的 FLUSH_MS 降到 100ms，看起来就是字一条条往外冒。
                              */}
                              {streaming ? (
                                <p className="whitespace-pre-wrap break-words">{liveText}</p>
                              ) : (
                                <Markdown text={cleanForRender(liveText)} />
                              )}
                            </div>
                          ) : pendingPlaceholder ? (
                            <p className="thinking-shimmer text-sm">正在写回复…</p>
                          ) : null;
                        })()}
                        {/*
                          他发过来的**表情包 / 图片**。
                          `sticker.send` 挑好的图挂在这条消息的 `attachments` 上（见 use-chat 收尾），
                          所以它天然跟在正文后面 —— 不会变成"两条彼此不搭的消息"。
                          表情按**表情包尺寸**渲染（不超过 128px）：贴满屏就不像表情了。
                        */}
                        {m.attachments?.length ? (
                          <div className="mt-1.5 flex flex-wrap items-end gap-1.5">
                            {m.attachments.map((a) =>
                              a.dataUrl && (a.kind === "sticker" || a.kind === "image") ? (
                                /* 点一下全屏看大图（用户 m01498 第 3 条：两种状态都要 —— 他发的图也能点） */
                                <button
                                  key={a.id}
                                  type="button"
                                  aria-label="看大图"
                                  className="p-0"
                                  onClick={() => setViewImg(a.dataUrl!)}
                                >
                                  <img
                                    src={a.dataUrl}
                                    alt={a.kind === "sticker" ? "表情" : a.name}
                                    className={cn(
                                      "rounded-xl",
                                      a.kind === "sticker"
                                        ? "max-h-32 max-w-32"
                                        : "max-h-48 max-w-[70%] rounded-2xl",
                                    )}
                                  />
                                </button>
                              ) : null,
                            )}
                          </div>
                        ) : null}
                        {/*
                          他这一轮真的动过手（原生 tools 的记录）—— 如实摆出来，失败不美化。
                          ⚠️ 不再要求 `!streaming`：每一步的结果**当场**就写进消息了
                          （见 use-chat 的 onRound），流式期间当然也要看得见 ——
                          这正是"执行结果那一栏永远有回话"。
                        */}
                        {m.rounds && m.rounds.length > 0 && <ToolProcess rounds={m.rounds} />}
                        {/* ⚠️ 「改」和编辑框**不在这里**了：它们原先写在这个分支里，
                            而这里只有"他的"消息才会渲染 —— 于是长按自己的消息点了"修改"、
                            状态设了却什么都不出来（跟长按菜单同一个坑）。
                            现在它们在 mine/他 分支**之外**（本函数靠后那一段），一处渲染、两种消息都对。 */}
                        {m.usage && (m.usage.prompt || m.usage.completion || m.usage.tools) && (
                          <p className="mt-1 px-1 text-[10px] text-subtle">
                            {m.usage.prompt
                              ? `输入 ${m.usage.prompt}${
                                  typeof m.usage.tools === "number" && m.usage.tools > 0
                                    ? `（工具 ${m.usage.tools}）`
                                    : ""
                                }`
                              : ""}
                            {m.usage.completion ? ` · 输出 ${m.usage.completion}` : ""}
                            {/*
                              缓存显示成**命中率**（用户："改成缓存命中率，
                              比如百分之多少，方便好看一点，不然我还得自己计算"）。
                              分母用输入 token —— 缓存本来就是"输入里有多少被命中了"。
                            */}
                            {typeof m.usage.cached === "number" &&
                            m.usage.cached > 0 &&
                            m.usage.prompt
                              ? ` · 缓存命中率 ${Math.round((m.usage.cached / m.usage.prompt) * 100)}%`
                              : ""}
                            {/*
                              工具定义也吃输入 token（用户 m08850 / m08970）：它**已含在输入里**，
                              所以写成「输入 14577（工具 2903）」而不是另加一段；
                              降级模式没有 tools 字段 → 这里是 0 → 不显示括号。
                            */}
                          </p>
                        )}
                      </div>
                    )}
                      {/* ⚠️ **这三个块（长按菜单 / 改 / 编辑框）必须放在 mine 与 他 的分支之外**：
                          以前它们写在「他的」那个分支里 —— 长按自己的消息时状态设了、却什么都不渲染，
                          表现成“长按我的消息没卡片、只有触感”（用户报了两回）；「改」和编辑框同一个坑。 */}
                        {/* **长按菜单**（用户第 2/5 条）：App 内浮层，不是浏览器/系统那个 —— 引用这一句 / 复制 /（自己的）修改 /（他的）重新生成 */}
                        {msgMenu?.id === m.id && createPortal(
                          <div
                            className="fixed inset-0 z-[80] flex items-center justify-center bg-fg/45 p-6"
                            onClick={() => setMsgMenu(null)}
                          >
                            <div
                              className="w-full max-w-[16rem] rounded-3xl border border-line bg-bg p-2 shadow-xl"
                              onClick={(e) => e.stopPropagation()}
                            >
                              
                              <button
                                type="button"
                                className="block w-full rounded-2xl px-3 py-3 text-left text-[13px]"
                                onClick={() => {
                                  setQuote({ text: msgMenu.part.replace(/\s+/g, " ").trim().slice(0, 60) });
                                  setMsgMenu(null);
                                }}
                              >
                                引用这一句
                              </button>
                              <button
                                type="button"
                                className="block w-full rounded-2xl px-3 py-3 text-left text-[13px]"
                                onClick={() => {
                                  void navigator.clipboard?.writeText(m.content);
                                  setMsgMenu(null);
                                }}
                              >
                                复制
                              </button>
                              {mine && !busy && (
                                <button
                                  type="button"
                                  className="block w-full rounded-2xl px-3 py-3 text-left text-[13px]"
                                  onClick={() => {
                                    setEditing({ id: m.id, text: splitQuote(m.content).body });
                                    setMsgMenu(null);
                                  }}
                                >
                                  修改
                                </button>
                              )}
                              {!mine && !streaming && (
                                <button
                                  type="button"
                                  className="block w-full rounded-2xl px-3 py-3 text-left text-[13px]"
                                  onClick={() => {
                                    void regenerate(m.id);
                                    setMsgMenu(null);
                                  }}
                                >
                                  重新生成
                                </button>
                              )}
                              {/* 赞/踩/朗读/分享/收藏/重新生成 —— 从气泡下面搬进来的（用户第 2/5 条） */}
                              {!mine && !streaming && (
                                <div className="mt-2 border-t border-line pt-2">
                          {m.content && !streaming && (
                            <MessageActions
                              content={m.content}
                              feedback={m.feedback}
                              busy={busy}
                              saved={m.savedToDocs}
                              onFeedback={(fb) =>
                                useApp.getState().patchMessage(conv!.id, m.id, {
                                  feedback: m.feedback === fb ? undefined : fb,
                                })
                              }
                              onRegenerate={() => void regenerate(m.id)}
                              onSaveDoc={() => {
                                useApp.getState().saveDoc({
                                  title: conv!.title,
                                  content: m.thinking
                                    ? `## 思考\n\n${m.thinking}\n\n## 回复\n\n${m.content}`
                                    : m.content,
                                  source: "chat",
                                  conversationId: conv!.id,
                                });
                                useApp.getState().markSavedToDocs(conv!.id, m.id);
                              }}
                            />
                          )}
                                </div>
                              )}
                            </div>
                          </div>,
                          document.body,
                        )}
                        {/* **修改自己发的消息**：入口只有一个 —— 长按卡片里的「修改」
                            （用户 m01893："把改字也挪到长按弹层里，太累赘了……并且改字去掉，
                            放到卡片里就行，然后对话框只留一个，不要加对话框，打完字点下面对话框的发送就行"）。
                            所以气泡下面**不再有**「改」，也不再有第二个输入框：
                            点「修改」→ 正文填进下面那个唯一的输入框 → 发送 = 保存并重答。 */}
                  </div>
                </li>
                </Fragment>
              );
            })}
            </ol>
          </div>

          {/* 长对话翻上去之后，回到底部要有一键（用户："最上面的消息不好翻"）。
              贴在消息区底部 = 输入框上方，不会压住输入框。 */}
          {showJump && (
            <button
              type="button"
              onClick={() => {
                const el = scroller.current;
                /* 先表态"我又要跟了"：不然平滑滚动还在路上、内容又长了一截，
                   滚到的是**旧**的底，最后停在离底一屏的地方 */
                stickBottom.current = true;
                el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                /* 平滑滚动会被"正文刚刚收尾重排"打断（实测停在半路），兜一道：
                   半秒后还没到底就直接钉到底（点这一下就是要看到最新，必须真的到底） */
                window.setTimeout(() => {
                  const box = scroller.current;
                  if (!box) return;
                  if (box.scrollHeight - box.scrollTop - box.clientHeight > 8) box.scrollTop = box.scrollHeight;
                }, 500);
              }}
              /* 贴在消息区底部、**悬浮对话框的上面**（不然会压在输入框上） */
              style={{ bottom: padBottom + 6 }}
              className="absolute left-1/2 z-20 -translate-x-1/2 rounded-full border border-line bg-surface/92 px-3.5 py-2 text-[12px] text-fg shadow-sm backdrop-blur"
            >
              ↓ 回到最新
            </button>
          )}
        </div>
      )}
      {/* **会话 ⋯ 菜单**：放在根级（列表容器会裁掉 fixed 浮层 → 之前"点了没反应"就是这个），屏幕中间一张卡片 */}
      {rowMenu && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-fg/45 p-6"
          onClick={() => setRowMenu(null)}
        >
          <div
            className="w-full max-w-[16rem] overflow-hidden rounded-3xl border border-line bg-bg p-1.5 text-[13px] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="block w-full rounded-2xl px-3 py-3 text-left"
              onClick={() => {
                const c = conversations.find((x) => x.id === rowMenu);
                if (c) setRenameFor({ id: c.id, text: c.title });
                setRowMenu(null);
              }}
            >
              重命名
            </button>
            <button
              type="button"
              className="block w-full rounded-2xl px-3 py-3 text-left"
              onClick={() => {
                useApp.getState().pinChat(rowMenu);
                setRowMenu(null);
              }}
            >
              置顶 / 取消置顶
            </button>
            <button
              type="button"
              className="block w-full rounded-2xl px-3 py-3 text-left"
              onClick={() => {
                useApp.getState().deleteChat(rowMenu);
                setRowMenu(null);
              }}
            >
              删除
            </button>
          </div>
        </div>,
        document.body,
      )}
      {/* **自绘改名对话框**（用户第 7 条：系统那个白底 CANCEL/OK 太不搭） */}
      {renameFor && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-fg/45 p-6"
          onClick={() => setRenameFor(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-line bg-bg p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-[13px] font-medium">给这段对话起个名字</p>
            <input
              autoFocus
              value={renameFor.text}
              onChange={(e) => setRenameFor({ id: renameFor.id, text: e.target.value })}
              className="h-10 w-full rounded-2xl bg-chip px-3 text-[13px] outline-none"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-full px-4 py-1.5 text-[12px] text-muted"
                onClick={() => setRenameFor(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-full bg-fg px-4 py-1.5 text-[12px] text-bg"
                onClick={() => {
                  const name = renameFor.text.trim();
                  if (name) useApp.getState().renameChat(renameFor.id, name);
                  setRenameFor(null);
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/*
        **悬浮对话框**（用户 m02002："对话框独立，改成悬浮聊天浮层，然后消息是可滚动消息流，
        滑动时会一条条从对话框过去，而对话框保持不动"）。

        · `absolute inset-x-0 bottom-0` + `pointer-events-none` 外壳：
          它是浮层，但**没覆盖到的地方必须还能滑消息**（外层的 none + 内层的 auto）；
        · 引用条跟着它一起浮（引用是"这一句要发给谁"的提示，跟输入框是一体）；
        · 高度用 ResizeObserver 量给消息列表当底部留白（见上面的 composerWrap）。
      */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-2 pb-2">
        <div ref={composerWrap} className="pointer-events-auto">
          {/* 引用中的小条（长按气泡之后出现；点 × 取消） */}
          {quote && (
            <div className="mx-1 mb-1 flex items-center gap-2 rounded-2xl border border-line bg-chip px-3 py-2 text-[11px] text-muted">
              <span className="min-w-0 flex-1 truncate">引用：{quote.text}</span>
              <button
                type="button"
                aria-label="取消引用"
                className="shrink-0 px-1 text-[13px]"
                onClick={() => setQuote(null)}
              >
                ×
              </button>
            </div>
          )}
          <Composer
            onSend={(text, atts) => {
              /**
               * **正在「修改这一条」**（用户 m01893：只留一个输入框，改完点发送就行）。
               * 输入框里现在是新正文 → 存回去，再让后面那条回复重答；
               * 引用头（`> 引用：…`）不参与编辑，保存时从**原来那条**里原样接回去。
               */
              if (editing) {
                const next = text.trim();
                if (!next) return;
                const orig = (conv?.messages ?? []).find((x) => x.id === editing.id)?.content ?? "";
                const quoted = splitQuote(orig).quote;
                const content = quoted ? `> 引用：${quoted}\n\n${next}` : next;
                const list = conv?.messages ?? [];
                const at = list.findIndex((x) => x.id === editing.id);
                const after = list.slice(at + 1).find((x) => x.role !== "user");
                if (conv) useApp.getState().patchMessage(conv.id, editing.id, { content });
                setEditing(null);
                setQuote(null);
                if (after) void regenerate(after.id);
                const bel = scroller.current;
                if (bel) bel.scrollTop = bel.scrollHeight;
                return;
              }
              /** 把引用拼在**你这条消息前面**（他也能从上下文看到引的是哪句） */
              const full = quote ? `> 引用：${quote.text}\n\n${text}` : text;
              setQuote(null);
              /* 你自己发消息 = 你要看最新的：先贴回底部，不然上翻着发完会停在半空 */
              stickBottom.current = true;
              send(full, atts);
              const el = scroller.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
            disabled={busy}
            streaming={busy}
            editingText={editing?.text ?? null}
            onCancelEdit={() => setEditing(null)}
          />
        </div>
      </div>

      {/* 看大图（用户 m01498 第 3 条）：整页只挂这一个，点哪儿都关 */}
      {viewImg &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-3"
            onClick={() => setViewImg(null)}
          >
            <img src={viewImg} alt="看大图" className="max-h-full max-w-full object-contain" />
            <button
              type="button"
              aria-label="关闭"
              className="absolute right-4 top-4 rounded-full bg-white/15 px-3 py-1 text-[13px] text-white"
              onClick={() => setViewImg(null)}
            >
              ×
            </button>
          </div>,
          document.body,
        )}

      {/* 思考链弹层：整个页面**只挂这一个**，内容跟着被点开的那条消息走 */}
      <ThinkingSheet
        open={thinkSheet !== null}
        text={thinkSheet?.text ?? ""}
        durationMs={thinkSheet?.ms}
        live={thinkSheet?.live}
        onClose={() => setThinkSheet(null)}
      />

      {menu && (
        /*
          抽屉 z-50。底部导航 z-[60] 比它高，但抽屉打开时**要把导航收起来** ——
          用户反馈："展开对话列表，导航栏就不留了吧，看看这怪怪的"
          （导航横在抽屉下沿，抽屉的圆角跟它叠在一起确实别扭）。
          做法：在 <html> 上挂 data-drawer-open，由 CSS 把导航藏掉。
          这样不用把 menu 状态提到 AppShell，也不用每帧重渲染。
        */
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="关闭"
            className="absolute inset-0 bg-fg/20"
            onClick={() => setMenu(false)}
          />
          <aside className="glass-panel relative z-10 flex h-full w-[84%] max-w-sm flex-col inset-top-75">
            {/* 上：整片星野铺在抽屉顶部（标题和按钮浮在它上面）。
                用户："上面那个从顶部开始，不是从我画的框开始" */}
            <DrawerSky />

            <div className="relative z-10 flex items-center justify-between px-4 pb-3">
              <p className="font-serif text-lg">对话</p>
              <button type="button" aria-label="关闭" onClick={() => setMenu(false)} className="size-10">
                <X className="size-5" />
              </button>
            </div>
            <button
              type="button"
              className="relative z-10 mx-4 mb-1 flex items-center gap-2 rounded-full bg-chip px-4 py-3 text-sm font-medium"
              onClick={() => {
                useApp.getState().newChat();
                setMenu(false);
              }}
            >
              <Plus className="size-4" />
              新对话
            </button>

            <ul className="relative z-10 min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 pt-1">
              {conversations.filter((c) => !c.incognito).length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-muted">还没有保存的对话</li>
              )}
              {conversations
                .filter((c) => !c.incognito)
                .slice()
                .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
                .map((c) => (
                  <li key={c.id}>
                    {/*
                      对话条目：用户反馈"这一整个大方块，改成柔和一点，带着边框，
                      上下留白一些，材质要统一"。
                      · 圆角从 rounded-full（整条胶囊，太"实"）收到 rounded-2xl
                      · 补一条 border-line 边框 —— 跟 App 里其它卡片同一套材质
                      · 左右内边距对称（原来左边 pl-6、右边 pr-1，文字被挤在左边）
                      · 上下用 space-y-2.5 留白，不再一条贴一条
                    */}
                    <div
                      className={cn(
                        "flex items-center gap-0.5 rounded-2xl border border-line bg-chip py-1 pr-0.5 pl-3.5",
                        c.id === activeId && "glass-active",
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate py-3 text-left text-sm"
                        onClick={() => {
                          useApp.getState().setActive(c.id);
                          setMenu(false);
                        }}
                      >
                        <span className="font-medium">{c.title}</span>
                        <span className="text-muted">
                        </span>
                      </button>
                      {/*
                        **改名**（用户："对话列表可以重命名"）—— `chat.rename` 动作早就有、
                      {/* 第 3 条：三个内联按钮 → 一个 ⋯（点开才有 重命名/置顶/删除） */}
                      <button
                        type="button"
                        aria-label="更多"
                        className="size-9 shrink-0 text-[15px] leading-none text-muted"
                        onClick={() => setRowMenu(rowMenu === c.id ? null : c.id)}
                      >
                        ⋯
                      </button>
                    </div>
                  </li>
                ))}
            </ul>

            {/*
              下：小宇宙（带星环的行星 + 小卫星 + 碎钻粒子），跟上面的星月呼应。
              · 这里原来是给底部导航让位的留白（h-[4.5rem]）——
                但抽屉一打开导航就收走了，那段留白只是空着，显得像"大方块"，
                所以让装饰接管它
                    {rowMenu === c.id && (
              · 用户："下面……不要有线，看着割裂" → 去掉那条分隔线
            */}
            <DrawerCosmos />
          </aside>
        </div>
      )}
    </div>
  );
}


/** 语音消息气泡：放的是真录音，不是合成音。 */
/**
 * 语音气泡（用户 m11313 定稿："跟微信一样"）。
 *
 * 形状：`[▶][波形][7"]` 一条横的实色气泡，宽度随时长变。
 * 上方那行转写文字放在气泡**下面**（用户要求："转文字的显示内容放在下面"）。
 *
 * 两个细节是踩过的坑：
 *   · 录出来的 webm 没有时长元信息（`el.duration` 是 Infinity）→ 进度条用我们量的秒数；
 *   · 太老的语音音频会被清掉（只留最近 200 条）→ 这时要**说清楚**，不能点了没反应。
 */
function VoiceBubble({
  att,
  mine,
  convId,
  msgId,
}: {
  att: Attachment;
  mine?: boolean;
  convId?: string;
  msgId?: string;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [text, setText] = useState(att.text ?? "");
  /**
   * 转写**默认不显示**（用户 m11699："发语音时都不显示文本，只有我长按转文字
   * 才会在气泡下面出现文本"）。文字其实一直在 `att.text` 里给他读，
   * 只是不摆到屏幕上 —— 长按点了"转成文字"才摊开。
   */
  const [showText, setShowText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState("");
  /** 长按菜单的位置（视口坐标）：贴着被长按的那个气泡 */
  const [menu, setMenu] = useState<{ left: number; top: number; up: boolean; arrow: number } | null>(
    null,
  );
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const secs = Math.max(1, Math.round((att.durationMs ?? 0) / 1000));
  const gone = !att.dataUrl;
  /**
   * 宽度按时长长——跟微信一样，短消息窄、长消息宽。
   * 用 `minWidth` 而不是 `width`：短语音的波形+时长其实放不进 96px，
   * 定死宽度会把文字挤出气泡（探针里 4 秒那条就溢出过）。
   */
  const minWidth = Math.min(210, 104 + secs * 4);
  /** 波形根数也按时长来，短气泡别塞 18 根 */
  const bars = Math.max(8, Math.min(20, Math.round(6 + secs * 1.1)));

  function toggle() {
    const el = ref.current;
    if (!el || gone) return;
    if (playing) el.pause();
    else void el.play().catch(() => setPlaying(false));
  }

  /**
   * 长按 → 菜单贴着这个气泡（用户 m11599："弹层跟消息贴近点，就跟微信这样"）。
   * 优先出在气泡**上方**，上面空间不够就落到下方，小箭头跟着换向。
   */
  function openMenu() {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const H = 150;
    const W = 168;
    const up = r.top > H + 16;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - W - 8);
    /** 小箭头对准气泡中心（微信那种"指着这条消息"的感觉） */
    const arrow = Math.min(Math.max(16, r.left + r.width / 2 - left), W - 16);
    setMenu({ left, top: up ? r.top - 10 : r.bottom + 10, up, arrow });
  }

  async function transcribeNow() {
    if (busy || text || gone || !att.dataUrl) return;
    setBusy(true);
    setSay("");
    try {
      const blob = await (await fetch(att.dataUrl)).blob();
      const r = await transcribe(blob);
      if (!r.ok) {
        setSay(r.reason);
        return;
      }
      setText(r.text);
      setShowText(true);
      // 存回消息里，下次打开就不用再转一遍
      if (convId && msgId) {
        const conv = useApp.getState().conversations.find((c) => c.id === convId);
        const msg = conv?.messages.find((m) => m.id === msgId);
        if (msg) {
          const atts = (msg.attachments ?? []).map((a) =>
            a.id === att.id ? { ...a, text: r.text } : a,
          );
          useApp.getState().patchMessage(convId, msgId, { attachments: atts });
        }
      }
    } catch (e) {
      setSay(e instanceof Error ? e.message : "转不成文字");
    } finally {
      setBusy(false);
    }
  }

  /** 存到手机：走浏览器下载（安卓会落到「下载」目录） */
  function saveToPhone() {
    if (!att.dataUrl) return;
    const a = document.createElement("a");
    a.href = att.dataUrl;
    a.download = `语音-${secs}秒.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setSay("已存到手机的「下载」里");
  }

  /** 删掉这条语音：把这个音频附件从消息里去掉（没别的了就整条空掉） */
  function removeThis() {
    if (!convId || !msgId) return;
    const conv = useApp.getState().conversations.find((c) => c.id === convId);
    const msg = conv?.messages.find((m) => m.id === msgId);
    if (!msg) return;
    const others = (msg.attachments ?? []).filter((a) => a.id !== att.id);
    useApp.getState().patchMessage(convId, msgId, {
      attachments: others,
      ...(others.length === 0 ? { content: "" } : {}),
    });
  }

  const down = () => {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      openMenu();
    }, 480);
  };
  const up = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const item =
    "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[13px] text-fg";

  return (
    <div className={cn("flex max-w-full flex-col gap-1", mine ? "items-end" : "items-start")}>
      <button
        ref={btnRef}
        type="button"
        aria-label={playing ? "暂停语音" : "播放语音"}
        onClick={() => {
          if (!longPressed.current) toggle();
          longPressed.current = false;
        }}
        onPointerDown={down}
        onPointerUp={up}
        onPointerLeave={up}
        onPointerCancel={up}
        style={{ minWidth }}
        className={cn(
          "flex select-none items-center gap-2 rounded-[18px] px-2.5 py-2 [-webkit-touch-callout:none] [touch-action:manipulation]",
          // 跟着全局玻璃走（`--aster-surface` 就是 B 档那层），只用自己的暖边区分左右
          mine
            ? "border-accent/30 bg-surface text-fg"
            : "border-line bg-surface text-fg",
          "border",
          gone && "opacity-60",
        )}
      >
        <audio
          ref={ref}
          src={att.dataUrl}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            const total = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : secs;
            setProgress(Math.min(1, el.currentTime / total));
          }}
          className="hidden"
        />
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full",
            mine ? "bg-accent/15 text-accent" : "bg-chip text-fg",
          )}
        >
          {gone ? (
            <span className="text-[11px]">✕</span>
          ) : playing ? (
            <Pause className="size-3.5 fill-current" />
          ) : (
            <Play className="size-3.5 fill-current" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-[2.5px]">
          {Array.from({ length: bars }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "w-[2px] shrink-0 rounded-full transition-colors",
                i / bars <= progress
                  ? "bg-accent"
                  : mine
                    ? "bg-accent/35"
                    : "bg-fg/25",
              )}
              style={{ height: `${5 + ((i * 11) % 13)}px` }}
            />
          ))}
        </span>
        <span className={cn("shrink-0 text-[11px] tabular-nums", mine ? "text-muted" : "text-muted")}>
          {secs}"
        </span>
      </button>

      {/*
        转写**就放在气泡下面**（用户 m11599），浅灰小字、最多两行。
        长按才看文字会把页面弄得很空，也让他"不知道你说了什么"。
      */}
      {showText && text ? (
        <div className="max-w-[240px] whitespace-pre-wrap break-words text-left text-[11px] leading-[1.5] text-muted">
          {text}
        </div>
      ) : busy ? (
        <div className="text-[10.5px] text-subtle">正在转文字…</div>
      ) : gone ? (
        <div className="text-[10.5px] text-subtle">这条太久远了，音频已经清掉</div>
      ) : null}
      {say && <div className="max-w-[86%] text-[10.5px] text-warn">{say}</div>}

      {/* 贴着气泡的菜单（用完即卸，点空白处关掉） */}
      {menu
        ? createPortal(
            <div className="fixed inset-0 z-[97] bg-black/10" onPointerDown={() => setMenu(null)}>
              <div
                className="absolute w-[168px] rounded-[13px] border border-line bg-[rgba(253,250,245,0.99)] py-1 shadow-[0_12px_32px_rgba(40,26,18,0.30)]"
                style={{
                  left: menu.left,
                  ...(menu.up
                    ? { bottom: window.innerHeight - menu.top }
                    : { top: menu.top }),
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {text && showText ? (
                  <button
                    type="button"
                    className={item}
                    onClick={() => {
                      void navigator.clipboard?.writeText(text).catch(() => undefined);
                      setMenu(null);
                      setSay("文字已复制");
                    }}
                  >
                    复制文字
                  </button>
                ) : (
                  <button
                    type="button"
                    className={item}
                    onClick={() => {
                      setMenu(null);
                      if (text) setShowText(true);
                      else void transcribeNow();
                    }}
                  >
                    转成文字
                  </button>
                )}
                <button
                  type="button"
                  className={item}
                  onClick={() => {
                    setMenu(null);
                    saveToPhone();
                  }}
                >
                  存到手机
                  <span className="text-[10px] text-subtle">.webm</span>
                </button>
                <div className="mx-3 my-1 h-px bg-line" />
                <button
                  type="button"
                  className={cn(item, "text-warn")}
                  onClick={() => {
                    setMenu(null);
                    removeThis();
                  }}
                >
                  删掉这条
                </button>
                {/* 指着被长按的那个气泡 */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute size-3 rotate-45 border-line bg-[rgba(253,250,245,0.99)]",
                    menu.up
                      ? "-bottom-[6.5px] border-b border-r"
                      : "-top-[6.5px] border-t border-l",
                  )}
                  style={{ left: menu.arrow }}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
