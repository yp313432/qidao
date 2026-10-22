import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  Mic,
  Paperclip,
  Plus,
  Smile,
  Square,
  X,
} from "lucide-react";
import { FileButton } from "@/components/file-button";
import { filesToAttachments, prettySize, stickerFromFile } from "@/lib/attachments";
import { stripWhiteBackground } from "@/lib/white-removal";
import { getModel, isOwnApi, MODELS, QUOTA_LIMIT } from "@/lib/models";
import {
  DEFAULT_STICKER_GROUP,
  guessGroupFromName,
  stickerGroupList,
} from "@/lib/stickers";
import { recordSupported, startRecording, type Recorder } from "@/lib/record";
import { transcribe } from "@/lib/voice-service";
import { startListening } from "@/lib/voice";
import { IS_APP } from "@/lib/platform";
import { resolveVoiceLang } from "@/lib/voice";
import { resolveAiName } from "@/lib/branding";
import { resetLabel } from "@/lib/greeting";
import type { Attachment } from "@/lib/types";
import { useDismissOutside } from "@/lib/ux";
import { cn, uid } from "@/lib/utils";
import { useApp } from "@/lib/store";

type Props = {
  onSend: (text: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
  streaming?: boolean;
  /**
   * 正在**修改**的那一条的正文（null = 没在改）。
   *
   * 用户 m01893："把改字也挪到长按弹层里，太累赘了……对话框只留一个，
   * 不要加对话框，打完字点下面对话框的发送就行" ——
   * 所以改消息**不再开第二个输入框**：把正文填进这一个，发送 = 保存并重答。
   */
  editingText?: string | null;
  onCancelEdit?: () => void;
};

export function Composer({ onSend, disabled, streaming, editingText, onCancelEdit }: Props) {
  const [value, setValue] = useState("");
  const activeChatId = useApp((s) => s.activeId);
  /**
   * 草稿保存。
   *
   * 原来输入框的字只存在组件里 —— 一跳到别的页面，组件卸载，字就没了，
   * 回来得重打。这里按对话存进 store（会跟着持久化），
   * 改动后 300ms 写一次，**卸载前再写一次**（这才是"跳页面也不丢"的关键）。
   */
  /**
   * 草稿用**固定键**。
   *
   * 早先按 activeId（对话 id）存，结果踩坑：新建对话时那个 id 会变，
   * 于是"存进去的键"和"回来取的键"不是一个 —— 字看起来还是丢了，
   * 而且卸载时还会把旧键擦成空。输入框只有一个，一份草稿就够了。
   */
  const draftKey = "composer";
  /** 最新值的镜像：卸载时要用它，不能用闭包里可能已经过期的 value */
  const valueRef = useRef("");
  valueRef.current = value;

  /**
   * 用户**是不是真的动过输入框**。
   *
   * 用它把两种情况分开（这是"删了又复活"那个 bug 的关键）：
   *   · 刚挂载、还没填 → 别写，否则把草稿擦掉
   *   · 用户真删光了   → **必须写空**，否则旧草稿会复活
   * 原来只用 `if (value)` 判断，把这两种混成一谈 ——
   * 于是删光之后 store 里还是旧字，去别的页再回来又出现了（用户实测）。
   */
  const editedRef = useRef(false);

  useEffect(() => {
    editedRef.current = false;
    const saved = useApp.getState().chatDrafts[draftKey] ?? "";
    setValue(saved);
  }, [draftKey]);

  /**
   * 节流保存：**用户动过就存，空值也存**（空 = 他删干净了）。
   *
   * 清理函数里仍然不写 —— 那会在挂载/卸载的那一瞬误擦草稿（早先踩过）。
   * 但卸载另有一个 effect 负责兜底（见下），两件事分开做。
   */
  useEffect(() => {
    if (!editedRef.current) return;
    const timer = window.setTimeout(() => {
      useApp.getState().setChatDraft(draftKey, value);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [value, draftKey]);

  /**
   * 卸载（跳到别的页面）时用 ref 补写一次 —— 这才是"字不丢"的关键。
   *
   * 同样要 `editedRef` 把关：没动过就不写，避免 StrictMode 二次挂载把草稿擦掉。
   */
  useEffect(() => {
    const key = draftKey;
    return () => {
      if (editedRef.current) useApp.getState().setChatDraft(key, valueRef.current);
    };
  }, [draftKey]);

  const [modelOpen, setModelOpen] = useState(false);
  /** 第二层：具体模型列表（第一层点「模型」才展开） */
  const [modelPickOpen, setModelPickOpen] = useState(false);
  /** 第二层：三档推理力度（第一层点「推理等级」才展开） */
  const [reasonOpen, setReasonOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [pending, setPending] = useState<Attachment[]>([]);
  /** 录音中：非空表示正在录，值是已录毫秒 */
  const [recMs, setRecMs] = useState<number | null>(null);
  /** 录音音量（0~1），画按住说话时的波形 */
  const [recLevel, setRecLevel] = useState(0);
  /**
   * 真的在录吗 —— 用 ref 而不是 `recMs`：
   * `setRecMs(0)` 是异步的，手指抬得比 React 刷新快时（用户 m11719：
   * "我手已经拿开了…但它不停止"）`micUp` 里还看到 null，于是既不停止也不发送。
   */
  const recOn = useRef(false);
  /** 手指上滑到"取消"那条线了 */
  const [recCancel, setRecCancel] = useState(false);
  const downAt = useRef(0);
  const downY = useRef(0);
  const [recErr, setRecErr] = useState("");
  const recRef = useRef<Recorder | null>(null);
  /** App 里用原生识别时，这里是它的句柄（跟录音二选一） */
  const asrRef = useRef<{ stop: () => void } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const model = useApp((s) => s.model);
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const setModel = useApp((s) => s.setModel);
  const aiName = useApp((s) => resolveAiName(s.settings.aiName));
  const customStickers = useApp((s) => s.stickerLib);
  const stickerGroups = useApp((s) => s.stickerGroups);
  /** 表情面板当前分组（"全部" = 不分组的整库） */
  const [stickerTab, setStickerTab] = useState<string>("全部");
  /** 长按进来后的"管理态"：这时点一张 = 删掉它 */
  const [stickerManage, setStickerManage] = useState(false);
  /*
    管理态的**多选**（用户 m07859："欧克，补吧，不然不方便"）：
    长按进去以后，点一张是"勾上"，不再是原来的"点一张删一张"。
    攒一批再统一移到某组 / 新建组 / 删除 —— 这样从相册导入的一堆
    没名字的图（IMG_2041…）可以一次性整理完，不用改文件名重导。
  */
  const [stickerPick, setStickerPick] = useState<string[]>([]);
  const [stickerGroupMenu, setStickerGroupMenu] = useState(false);
  const [stickerNewGroup, setStickerNewGroup] = useState(false);
  const [stickerNewGroupName, setStickerNewGroupName] = useState("");
  /*
    长按抬起时浏览器还会补一个 click —— 如果不吞掉，刚被长按选中的那张
    会立刻被 toggle 成"取消选中"（真机上表现为"长按之后一张都没选上"）。
  */
  const longPressedRef = useRef(false);
  /** 刚导入的一批（停「全部」时导入的）—— 导完问一句"归到哪组"（用户 m07934 第 2 条） */
  const [stickerFresh, setStickerFresh] = useState<string[]>([]);
  /** 长按某个分组页签 → 改名 / 删组（用户 m07934 第 3 条） */
  const [stickerTabMenu, setStickerTabMenu] = useState<string | null>(null);
  const [stickerRename, setStickerRename] = useState<string | null>(null);
  const [stickerRenameText, setStickerRenameText] = useState("");
  /*
    「今天 N 次 · 输入/输出 · 缓存命中率」那条**已删除**（用户要求：
    "到时候直接上设置里看，这地方就不留了"）。
    所以这里不再订阅 requestLog —— 完整用量在「我的 → 模型与用量」。
  */
  /** 自己带 key = 花自己的钱 → 只统计；走服务端 → 才有窗口额度 */
  const ownApi = isOwnApi(settings);
  const quota = useApp((s) => s.quota);
  const resetAt = useApp((s) => s.quotaResetAt());
  const usedPct = Math.min(100, Math.round((quota.used / QUOTA_LIMIT) * 100));
  const showQuota = !ownApi && usedPct >= 70;

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  /**
   * 点长按卡片里的「修改」→ 把那条的正文填进**这一个**输入框（用户 m01893）。
   *
   * 只认"**新一次**修改"：`editingText` 从 null 变成某条正文时填一次；
   * 之后用户自己敲字、或点「取消」，都不会被这里覆盖回去（拿上一次的值挡一道）。
   */
  const editingRef = useRef<string | null>(null);
  useEffect(() => {
    if (editingText == null) {
      editingRef.current = null;
      return;
    }
    if (editingRef.current === editingText) return;
    editingRef.current = editingText;
    /* 当"动过"：不然草稿那套会认为没填过，把刚填进来的正文又擦掉 */
    editedRef.current = true;
    setValue(editingText);
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [editingText]);

  function submit() {
    const t = value.trim();
    if ((!t && pending.length === 0) || disabled) return;
    const atts = pending;
    setValue("");
    // 发出去了，草稿跟着清掉（这是唯一一条"主动清空草稿"的路径）
    useApp.getState().setChatDraft(draftKey, "");
    setPending([]);
    // 底部导航现在是**常驻**的（"打字时收下去"那个机制整个删了），
    // 所以这里不需要再操心导航的显隐。
    onSend(t, atts.length ? atts : undefined);
  }

  async function pickFiles(files: File[]) {
    setPlusOpen(false);
    const list = await filesToAttachments(files);
    if (list.length) setPending((p) => [...p, ...list].slice(0, 8));
  }

  /**
   * 把选中的图片**收进表情库**（跟"发图"那条路分开）：
   *   · 动图/透明格式**不重画**（canvas 会把 GIF 动画吃掉，表情包就废一半）
   *   · 自动**去白底** —— 照片/白底截图变成真正透明的表情（用户要的"表情包格式"）
   */
  async function addStickers(files: File[]) {
    /*
      用户 m07934 第 2 条：「不能直接导入分好的组，要先传到未分组，再长按编辑移动到
      其他组里，很麻烦」。所以：
        · 正停在某个**具体分组**里导入 → 直接进那组（最省事，符合直觉）
        · 停在「全部」→ 按文件名猜（猜不出就「未分组」），导完弹一条"这 N 张归到哪"，
          点一下就整体挪过去，不点就当没分组
    */
    const pinned = stickerTab !== "全部" ? stickerTab : "";
    const fresh: string[] = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      let url = await stickerFromFile(f);
      if (useApp.getState().settings.stickerRemoveWhite !== false) {
        const transparent = await stripWhiteBackground(url);
        if (transparent) url = transparent;
      }
      useApp.getState().addSticker(url, pinned || guessGroupFromName(f.name));
      /* addSticker 是插在最前面，所以刚进来的那张是 [0] */
      const lib = useApp.getState().stickerLib;
      if (lib[0]) fresh.push(lib[0].id);
    }
    if (pinned) {
      setStickerTab(pinned);
      return;
    }
    if (fresh.length > 0) {
      setStickerTab("全部");
      setStickerFresh(fresh);
    }
  }

  /** 把这批刚导入的挪到某组（`setStickerFresh([])` = 就这样，不分组） */
  function assignFresh(group: string) {
    for (const id of stickerFresh) useApp.getState().moveSticker(id, group);
    setStickerFresh([]);
  }

  function sendSticker(dataUrl: string) {
    if (disabled) return;
    setStickerOpen(false);
    const att: Attachment = {
      id: uid("att"),
      kind: "sticker",
      name: "表情",
      mime: "image/png",
      size: 0,
      dataUrl,
    };
    onSend("", [att]);
  }

  /* ---------------- 语音消息 ---------------- */

  async function startRec() {
    if (disabled || recRef.current || asrRef.current) return;
    setRecErr("");
    setPlusOpen(false);

    /**
     * App 里走**原生语音识别**。
     *
     * 安卓 WebView 没有 SpeechRecognition，原来那条路永远拿不到文字 ——
     * 用户实测："语音条也不可以、转文字是空的"。
     * 另外安卓不允许"识别"和"录音"同时占麦克风，所以这里只做识别：
     * 识别出来的文字直接写进输入框，你确认（或改一下）再发。
     */
    if (IS_APP) {
      /**
       * 走 startListening（它内部会按情况选路）：
       *   配了语音服务 → 自己录音 + 上传转文字（**唯一在荣耀上真能用的路** ✅）
       *   没配 → 退回系统识别
       *
       * 之前这里直接调 startNativeListening，等于绕过了语音服务 ——
       * 用户实测："语音通话欧克了，但是对话框旁边那个还是不行，录不上语音，一直是零秒" ✅
       */
      const t0 = Date.now();
      const tick = window.setInterval(() => setRecMs(Date.now() - t0), 200);
      const handle = startListening({
        lang: resolveVoiceLang(settings.voiceLang),
        onPartial: (t) => {
          // 服务那条路会推一句"录音中…"，当提示显示；识别到的中间结果照常显示
          if (t && !t.startsWith("（")) setRecErr("");
        },
        onFinal: (text) =>
          setValue((v) => (v ? `${v}${/\s$/.test(v) ? "" : " "}${text}` : text)),
        onEnd: () => {
          window.clearInterval(tick);
          asrRef.current = null;
          setRecMs(null);
        },
        onError: (msg) => {
          window.clearInterval(tick);
          setRecErr(msg);
          asrRef.current = null;
          setRecMs(null);
        },
      });
      if (!handle) {
        window.clearInterval(tick);
        setRecErr("这个版本没接上语音，装最新版再试。");
        return;
      }
      asrRef.current = handle;
      setRecMs(0);
      return;
    }

    if (!recordSupported()) {
      setRecErr("这个浏览器不给录音。需要 https 或 localhost —— 局域网明文 http 下麦克风是被禁的。");
      return;
    }
    try {
      const rec = await startRecording((ms) => setRecMs(ms));
      recRef.current = rec;
      setRecMs(0);
    } catch (err) {
      const name = (err as { name?: string }).name;
      setRecErr(
        name === "NotAllowedError" || name === "SecurityError"
          ? "麦克风权限被拒了（也可能是 http 页面不给用）。要在浏览器设置里允许麦克风。"
          : name === "NotFoundError"
            ? "没找到麦克风设备。"
            : `录音起不来：${(err as Error).message || name || "未知原因"}`,
      );
      setRecMs(null);
    }
  }

  /**
   * 按住说话（用户 m11313："直接发语音气泡…跟微信发语音一样"）。
   *
   * 真机上的手势约定：
   *   · **按住**（>250ms）→ 录音，松手发语音气泡；
   *   · **短按**（<250ms）→ 取消这次录音，改走"转成文字"（原来那个语音输入）；
   *   · **按住往上滑**（>64px）→ 取消，不发。
   * 短按保留转文字，是因为很多人习惯"点一下说一句、变成文字"，
   * 而想发语音的人自然会按住。
   */
  async function startVoiceRec(): Promise<boolean> {
    if (!recordSupported()) {
      setRecErr("这个浏览器不给录音。需要 https 或 localhost —— 局域网明文 http 下麦克风是被禁的。");
      return false;
    }
    try {
      const rec = await startRecording((ms) => setRecMs(ms), {
        maxMs: 60_000,
        onLevel: (r) => setRecLevel(r),
      });
      recRef.current = rec;
      recOn.current = true;
      setRecMs(0);
      return true;
    } catch (err) {
      const name = (err as { name?: string }).name;
      setRecErr(
        name === "NotAllowedError" || name === "SecurityError"
          ? "麦克风权限被拒了（也可能是 http 页面不给用）。要在浏览器设置里允许麦克风。"
          : name === "NotFoundError"
            ? "没找到麦克风设备。"
            : `录音起不来：${(err as Error).message || name || "未知原因"}`,
      );
      setRecMs(null);
      return false;
    }
  }

  function micDown(e: React.PointerEvent) {
    if (disabled || recMs !== null) return;
    if (value.trim() || pending.length) {
      submit();
      return;
    }
    downAt.current = Date.now();
    downY.current = e.clientY;
    setRecCancel(false);
    void startVoiceRec();
  }

  function micMove(e: React.PointerEvent) {
    if (!recOn.current) return;
    setRecCancel(e.clientY - downY.current < -64);
  }

  /**
   * 松手 = 立刻停止 + 直接发出去（用户 m11719："长按说，松手直接发送，
   * 不用再点第二次停止再发"）。
   *
   * 原来这里有一条"短按 <250ms 就走旧的点击转文字"的分支，它把"松手"吃掉了：
   * 轻点一下 → 开始录音后一直录，要再点一次才停。现在整条删掉，
   * 手势只有一种：按下录、松手发、上滑取消。
   */
  function micUp(e: React.PointerEvent) {
    if (!recOn.current) return;
    const cancel = e.clientY - downY.current < -64;
    setRecCancel(false);
    void stopRec(!cancel);
  }

  async function stopRec(send: boolean) {
    // App 里"停止"= 结束识别；文字已经写进输入框了，不用再发音频
    if (asrRef.current) {
      asrRef.current.stop();
      asrRef.current = null;
      setRecMs(null);
      return;
    }
    const rec = recRef.current;
    recRef.current = null;
    recOn.current = false;
    setRecMs(null);
    if (!rec) return;
    if (!send) {
      rec.cancel();
      return;
    }
    const att = await rec.stop();
    if (!att) {
      setRecErr("没录到声音，再试一次？");
      return;
    }
    /**
     * 发语音之前**先把话转成文字**（用户 m11599）。
     *
     * 他"听不见"：模型只拿得到文字。以前不知道这一步，于是他收到一条只有
     * 「3 秒」的语音，只能回"这条在我这儿是空的"——正是用户看到的那一幕。
     * 转写失败不拦着发：气泡下面会诚实写「没转成文字」。
     */
    if (att.dataUrl) {
      // 转写在后台做，**不显示任何提示**（用户 m11723："转文字放在后台，不要显示"）
      try {
        const blob = await (await fetch(att.dataUrl)).blob();
        const r = await transcribe(blob);
        if (r.ok) att.text = r.text;
      } catch {
        /* 转写不了就发一条纯语音；他要读的时候长按还能再转 */
      }
    }
    onSend("", [att]);
  }

  useEffect(() => {
    // 卸载时必须停掉，否则麦克风指示灯一直亮着
    return () => {
      recRef.current?.cancel();
      recRef.current = null;
    };
  }, []);

  // 点弹层外面就收起（不用等抬手，手机上更顺手）
  const cardRef = useRef<HTMLDivElement>(null);
  const closeAll = useCallback(() => {
    setPlusOpen(false);
    setModelOpen(false);
    setModelPickOpen(false);
    setReasonOpen(false);
    setStickerOpen(false);
  }, []);
  useDismissOutside(
    cardRef,
    closeAll,
    plusOpen || modelOpen || modelPickOpen || reasonOpen || stickerOpen,
  );

  return (
    <div className="px-1.5 pb-composer">
      {/*
        ⚠️ 玻璃用**哪一档**：`.glass-panel`（半透明 + 30px 模糊 + 投影）。
        用户三次口径叠起来才是这个结论，别再走回头路：
          · "把它浮起来，做成一个单独的组件，不跟底下的背景融合" →
            不能用最透的 `.aster-card`（在花背景图上跟背景糊成一片）；
          · "对话框好歹要跟玻璃组件统一吧……要是换白色字体，直接啥也看不清了" →
            不能自造底色（我上一版拿 `--aster-bg` 自造了个实底，出了"浅底浅字"）；
          · "也把它弄成玻璃那种呢，这样白色的看着不好看" →
            `.glass-menu`（94% 不透明）在浅色主题下几乎就是**一块白板**，用户还是不满意。
        所以取中间那档：**看得出背景在下面**（跟底部导航那条玻璃一致），
        又有投影 + 边框把它跟背景分开；跟着主题走（深色主题深玻璃、浅色主题浅玻璃），
        文字用主题的 `--aster-fg`，不会再出现"白字看不见"。
      */}
      {/* glass-float：**悬浮**在消息流上面的那一层（比 glass-panel 实，见 styles.css 注释）
          ⭐ 用户 m02163 第 3/4 条 + m02254「然后选B」：形状改**细长**（卡片 p-1.5、输入框 min-h-9、
          两边圆钮 size-9，整块矮约 20px：125px → 101px），玻璃改成 **B 档：82% + 模糊 48px**（见 .glass-float）。
          侧边留白 8px（浮层外壳）+ 6px（这里）= 14px —— 用户要"别贴着侧边栏、也别太局促"。 */}
      <div ref={cardRef} className="glass-float rounded-3xl border border-line p-1.5 shadow-lg">
        {/*
          「{aiName} 现在知道」那行**已经挪到顶部栏**了（chat-view 的 header）。
          用户："不要放在对话框占地方，这样显得界面更宽阔一点"。

          「今天 N 次 · 输入/输出 · 缓存命中率」那一条**整个删掉**了。
          用户："这个也去掉吧，到时候直接上设置里看，这地方就不留了"。
          那些数字在「我的 → 模型与用量」里本来就有完整版，这里没必要重复占地方。
        */}
        {/* 走内置服务端：这里才真的会拦（花的是服务端那把 key）—— 打字时也先藏起来 */}
        {showQuota && (
          <div className="mb-1 flex items-center justify-between gap-3 rounded-2xl bg-chip px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg">本窗口已用 {usedPct}%</p>
              <p className="text-[12px] text-muted" suppressHydrationWarning>
                {resetAt <= Date.now() ? "窗口已过，下次发送重新计数" : resetLabel(resetAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate({ to: "/me" })}
              className="shrink-0 rounded-full bg-elevated px-3.5 py-1.5 text-[13px] font-medium text-fg shadow-sm"
            >
              详情
            </button>
          </div>
        )}
        {recMs !== null && (
          <div
            className={cn(
              "mb-1.5 flex items-center gap-2.5 rounded-2xl border px-3 py-2.5",
              recCancel ? "border-warn/60 bg-warn/15" : "border-line bg-chip",
            )}
          >
            <span className={cn("size-2.5 shrink-0 animate-pulse rounded-full", recCancel ? "bg-warn" : "bg-accent")} />
            <span className="flex h-6 min-w-0 flex-1 items-end gap-[2px]">
              {Array.from({ length: 22 }).map((_, i) => {
                // 中段高、两端低，像真的波形；再用音量调制
                const bell = 1 - Math.abs(i - 10.5) / 12;
                const h = 4 + Math.round((bell * 0.55 + recLevel * 0.9) * 16);
                return (
                  <span
                    key={i}
                    className={cn("w-[3px] shrink-0 rounded-full transition-[height] duration-100", recCancel ? "bg-warn/70" : "bg-accent/80")}
                    style={{ height: `${Math.max(4, Math.min(24, h))}px` }}
                  />
                );
              })}
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-fg">
              {Math.floor(recMs / 1000)}"
            </span>
            <span className="shrink-0 text-[11px] text-muted">
              {recCancel ? "松开取消" : "松开发送 · 上滑取消"}
            </span>
          </div>
        )}
        {recErr && (
          <p className="mb-1.5 rounded-2xl bg-warn/10 px-3 py-2 text-[11px] leading-4 text-warn">
            {recErr}
          </p>
        )}
        {pending.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-2 px-1">
            {pending.map((a) => (
              <span
                key={a.id}
                className="relative flex items-center gap-2 rounded-2xl border border-line bg-chip px-2 py-1.5"
              >
                {a.dataUrl ? (
                  <img src={a.dataUrl} alt={a.name} className="size-10 rounded-xl object-cover" />
                ) : (
                  <Paperclip className="size-4 text-muted" />
                )}
                <span className="max-w-28 truncate text-[11px]">{a.name}</span>
                <span className="text-[10px] text-subtle">
                  {a.text ? "可读正文" : prettySize(a.size)}
                </span>
                <button
                  type="button"
                  aria-label={`移除 ${a.name}`}
                  onClick={() => setPending((p) => p.filter((x) => x.id !== a.id))}
                  className="text-muted"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/*
          表情面板（用户 m07420："跟微信一样，在对话框加一个表情键，点开就是表情包，
          点击就发"）。

          ⚠️ 面板只可能从输入框**上方**展开：下面是常驻的底部导航，没有它的位置。
          所以这里是"输入框上方升起的一块面板"，不是微信那种压住输入法的高度。
        */}
        {stickerOpen && (
          <div className="sticker-sheet mb-1.5">
            <div className="flex items-center gap-1.5 px-1 pb-1.5">
              <div className="sticker-tabs min-w-0 flex-1">
                {["全部", ...stickerGroupList(customStickers, stickerGroups)].map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      /* 长按抬手还会补一个 click —— 别把刚打开菜单的组又切过去 */
                      if (longPressedRef.current) {
                        longPressedRef.current = false;
                        return;
                      }
                      setStickerTab(g);
                      setStickerTabMenu(null);
                    }}
                    onPointerDown={(e) => {
                      if (g === "全部") return;
                      const sx = e.clientX;
                      const sy = e.clientY;
                      const cancel = () => {
                        window.clearTimeout(timer);
                        window.removeEventListener("pointermove", onMove);
                        window.removeEventListener("pointerup", cancel);
                        window.removeEventListener("pointercancel", cancel);
                      };
                      const onMove = (ev: PointerEvent) => {
                        if (Math.abs(ev.clientX - sx) > 8 || Math.abs(ev.clientY - sy) > 8) cancel();
                      };
                      const timer = window.setTimeout(() => {
                        longPressedRef.current = true;
                        setStickerTabMenu(g);
                        cancel();
                      }, 500);
                      window.addEventListener("pointermove", onMove);
                      window.addEventListener("pointerup", cancel, { once: true });
                      window.addEventListener("pointercancel", cancel, { once: true });
                    }}
                    className={cn("sticker-tab", stickerTab === g && "sticker-tab-on")}
                  >
                    {g}
                    <span className="ml-1 text-[9px] opacity-60">
                      {g === "全部"
                        ? customStickers.length
                        : customStickers.filter((x) => (x.group || DEFAULT_STICKER_GROUP) === g)
                            .length}
                    </span>
                  </button>
                ))}
              </div>
              <FileButton
                ariaLabel="导入表情"
                accept="image/*"
                multiple
                className="sticker-import shrink-0"
                onPick={(files) => void addStickers(files)}
              >
                ＋ 导入
              </FileButton>
              <button
                type="button"
                aria-label="收起表情"
                onClick={() => {
                  setStickerOpen(false);
                  setStickerManage(false);
                }}
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-chip text-muted"
              >
                <X className="size-3.5" />
              </button>
            </div>

            {/* 刚导入的这批归到哪组（用户 m07934 第 2 条）*/}
            {stickerFresh.length > 0 && (
              <div className="sticker-fresh">
                <span className="sticker-fresh-label">这 {stickerFresh.length} 张归到</span>
                {Array.from(
                  new Set([
                    DEFAULT_STICKER_GROUP,
                    ...stickerGroupList(customStickers, stickerGroups).filter((g) => g !== "全部"),
                  ]),
                ).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => assignFresh(g)}
                    className="sticker-group-item"
                  >
                    {g}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setStickerFresh([])}
                  className="sticker-group-item sticker-skip"
                >
                  就这样
                </button>
              </div>
            )}

            {/* 长按分组页签 → 改名 / 删组（用户 m07934 第 3 条）*/}
            {stickerTabMenu && (
              <div className="sticker-tabmenu">
                <span className="sticker-tabmenu-name">{stickerTabMenu}</span>
                <button
                  type="button"
                  className="sticker-op"
                  onClick={() => {
                    setStickerRename(stickerTabMenu);
                    setStickerRenameText(stickerTabMenu);
                    setStickerTabMenu(null);
                  }}
                >
                  改名
                </button>
                <button
                  type="button"
                  className="sticker-op sticker-op-del"
                  onClick={() => {
                    useApp.getState().removeStickerGroup(stickerTabMenu);
                    if (stickerTab === stickerTabMenu) setStickerTab("全部");
                    setStickerTabMenu(null);
                  }}
                >
                  删组
                </button>
                <button
                  type="button"
                  className="sticker-op"
                  onClick={() => setStickerTabMenu(null)}
                >
                  取消
                </button>
              </div>
            )}

            {stickerRename && (
              <div className="sticker-tabmenu">
                <input
                  value={stickerRenameText}
                  onChange={(e) => setStickerRenameText(e.target.value)}
                  aria-label="新组名"
                  className="sticker-rename-input"
                  placeholder="新组名"
                />
                <button
                  type="button"
                  className="sticker-op sticker-op-done"
                  onClick={() => {
                    const g = stickerRenameText.trim();
                    if (g && g !== stickerRename) {
                      useApp.getState().renameStickerGroup(stickerRename, g);
                      if (stickerTab === stickerRename) setStickerTab(g);
                    }
                    setStickerRename(null);
                    setStickerRenameText("");
                  }}
                >
                  确定
                </button>
                <button
                  type="button"
                  className="sticker-op"
                  onClick={() => {
                    setStickerRename(null);
                    setStickerRenameText("");
                  }}
                >
                  取消
                </button>
              </div>
            )}

            <div className="sticker-grid">
              {customStickers
                  .filter(
                    (x) =>
                      stickerTab === "全部" ||
                      (x.group || DEFAULT_STICKER_GROUP) === stickerTab,
                  )
                  .map((s) => {
                    const picked = stickerPick.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        aria-label={
                          stickerManage
                            ? picked
                              ? "取消选中"
                              : "选中这张"
                            : "发送这张表情"
                        }
                        onClick={() => {
                          if (stickerManage) {
                            if (longPressedRef.current) {
                              longPressedRef.current = false;
                              return;
                            }
                            setStickerPick((p) =>
                              p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id],
                            );
                            return;
                          }
                          sendSticker(s.url);
                        }}
                        onPointerDown={(e) => {
                          if (stickerManage) return;
                          /*
                            用户 m07934 第 1 条：「长按编辑改成和气泡一样的，滑动时不触发，
                            只有固定按的时候触发」。所以按下记坐标，**手指一动就取消**；
                            按住不动到 420ms 才进管理态（比原来的 550ms 好按）。
                          */
                          const sx = e.clientX;
                          const sy = e.clientY;
                          const cancel = () => {
                            window.clearTimeout(timer);
                            window.removeEventListener("pointermove", onMove);
                            window.removeEventListener("pointerup", cancel);
                            window.removeEventListener("pointercancel", cancel);
                          };
                          const onMove = (ev: PointerEvent) => {
                            if (Math.abs(ev.clientX - sx) > 8 || Math.abs(ev.clientY - sy) > 8) {
                              cancel();
                            }
                          };
                          const timer = window.setTimeout(() => {
                            longPressedRef.current = true;
                            setStickerManage(true);
                            setStickerPick([s.id]);
                            cancel();
                          }, 420);
                          window.addEventListener("pointermove", onMove);
                          window.addEventListener("pointerup", cancel, { once: true });
                          window.addEventListener("pointercancel", cancel, { once: true });
                        }}
                        className={cn(
                          "sticker-cell",
                          stickerManage && "sticker-manage",
                          picked && "sticker-cell-on",
                        )}
                      >
                        <img src={s.url} alt="" className="size-full object-contain" />
                        {picked && <span className="sticker-tick">✓</span>}
                      </button>
                    );
                  })}

              {customStickers.length === 0 && (
                <p className="col-span-5 px-2 py-6 text-center text-[11px] leading-5 text-muted">
                  还没有表情包。点右上「＋ 导入」选几张图；
                  <br />
                  文件名里带中文的（比如「无语_气死了.gif」）会自动分到「无语」那组。
                </p>
              )}
            </div>

            {/*
              「移到分组」的组名选择（管理态下点「移到分组」才出现）
            */}
            {stickerManage && stickerGroupMenu && (
              <div className="sticker-groups">
                {[DEFAULT_STICKER_GROUP, ...stickerGroupList(customStickers, stickerGroups)]
                  .filter((g, i, a) => a.indexOf(g) === i)
                  .map((g) => (
                    <button
                      key={g}
                      type="button"
                      className="sticker-group-item"
                      onClick={() => {
                        for (const id of stickerPick) useApp.getState().moveSticker(id, g);
                        setStickerPick([]);
                        setStickerGroupMenu(false);
                        setStickerManage(false);
                      }}
                    >
                      {g}
                      <span className="ml-1 text-[9px] opacity-60">
                        {
                          customStickers.filter(
                            (x) => (x.group || DEFAULT_STICKER_GROUP) === g,
                          ).length
                        }
                      </span>
                    </button>
                  ))}
              </div>
            )}

            {/*
              「新建分组」：输入名字，选中的这些图直接归进去
            */}
            {stickerManage && stickerNewGroup && (
              <div className="sticker-newgroup">
                <input
                  value={stickerNewGroupName}
                  onChange={(e) => setStickerNewGroupName(e.target.value)}
                  placeholder="分组名，比如 猫"
                  className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  className="shrink-0 rounded-full bg-ink px-3 py-1 text-[11px] text-ink-fg"
                  onClick={() => {
                    const g = stickerNewGroupName.trim();
                    if (!g) return;
                    useApp.getState().addStickerGroup(g);
                    for (const id of stickerPick) useApp.getState().moveSticker(id, g);
                    setStickerNewGroupName("");
                    setStickerNewGroup(false);
                    setStickerPick([]);
                    setStickerManage(false);
                  }}
                >
                  确定
                </button>
                <button
                  type="button"
                  className="shrink-0 text-[11px] text-muted"
                  onClick={() => {
                    setStickerNewGroup(false);
                    setStickerNewGroupName("");
                  }}
                >
                  取消
                </button>
              </div>
            )}

            {stickerManage ? (
              <div className="sticker-ops">
                <span className="shrink-0 text-[10.5px] text-subtle">
                  已选 {stickerPick.length} 张
                </span>
                <button
                  type="button"
                  className="sticker-op"
                  disabled={stickerPick.length === 0}
                  onClick={() => {
                    setStickerGroupMenu((v) => !v);
                    setStickerNewGroup(false);
                  }}
                >
                  移到分组
                </button>
                <button
                  type="button"
                  className="sticker-op"
                  disabled={stickerPick.length === 0}
                  onClick={() => {
                    setStickerNewGroup(true);
                    setStickerGroupMenu(false);
                  }}
                >
                  新建分组
                </button>
                <button
                  type="button"
                  className="sticker-op sticker-op-del"
                  disabled={stickerPick.length === 0}
                  onClick={() => {
                    for (const id of stickerPick) useApp.getState().removeSticker(id);
                    setStickerPick([]);
                  }}
                >
                  删除
                </button>
                <button
                  type="button"
                  className="sticker-op sticker-op-done"
                  onClick={() => {
                    setStickerManage(false);
                    setStickerPick([]);
                    setStickerGroupMenu(false);
                    setStickerNewGroup(false);
                  }}
                >
                  完成
                </button>
              </div>
            ) : (
              <p className="flex items-center justify-between px-1 pt-1 text-[10px] text-subtle">
                <span>导进来的图会按文件名自动分组</span>
                <span>点一下直接发 · 长按管理</span>
              </p>
            )}
          </div>
        )}

        {/*
          「正在修改」的那条提示（用户 m01893）：整页**只有这一个输入框**，
          所以这里只说明"发送 = 保存并重答"，再加一个「取消」。
        */}
        {editingText != null && (
          <div className="mb-1.5 flex items-center justify-between gap-2 rounded-2xl border border-line bg-chip px-2.5 py-1.5">
            <span className="truncate text-[11px] text-muted">
              正在修改这一条 · 发送就是「保存并重答」
            </span>
            <button
              type="button"
              className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted"
              onClick={() => {
                setValue("");
                useApp.getState().setChatDraft(draftKey, "");
                onCancelEdit?.();
              }}
            >
              取消
            </button>
          </div>
        )}

        <textarea
          ref={ta}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            // 标记"用户动过"——这样删成空也会被存下来（不然旧草稿会复活）
            editedRef.current = true;
            setValue(e.target.value);
          }}
          /*
            ⚠️ 这里原来挂了一对 onFocus/onBlur 去收放底部导航（keyboardUp）。
            整个机制**已删除** —— 用户说了不止一次：
              "我点开键盘之后导航栏没有了，中间空了一块，
               退出键盘之后要点一下界面才出现导航栏，
               能不能直接就让导航栏不消失"
            真相是：收下去换来的那块地方**本来就是空的**，什么也没省。
            现在导航栏常驻，键盘开开关关都不受影响。
          */
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length) {
              e.preventDefault();
              void pickFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={`和${aiName}聊聊…`}
          className="min-h-9 w-full resize-none bg-transparent px-3 py-2 text-[16px] text-fg outline-none placeholder:text-subtle"
        />
        <div className="flex items-center gap-2 px-1 pb-1">
          <div className="relative">
            <button
              type="button"
              aria-label="添加"
              onClick={() => {
                setPlusOpen((v) => !v);
                setModelOpen(false);
                setStickerOpen(false);
              }}
              className="flex size-9 items-center justify-center rounded-full bg-chip text-fg"
            >
              <Plus className="size-5" strokeWidth={1.75} />
            </button>
            {plusOpen && (
              <div className="glass-menu absolute bottom-13 left-0 z-20 w-44 overflow-hidden rounded-2xl border border-line py-1">
                <FileButton
                  ariaLabel="选择图片"
                  accept="image/*"
                  multiple
                  className="w-full justify-start px-3 py-2.5 text-sm"
                  onPick={(files) => void pickFiles(files)}
                >
                  图片
                </FileButton>
                <FileButton
                  ariaLabel="选择文件"
                  multiple
                  className="w-full justify-start px-3 py-2.5 text-sm"
                  onPick={(files) => void pickFiles(files)}
                >
                  文件
                </FileButton>
                {/*
                  用户 m07644："这个加号里塞了这么多没用的，把录音、表情、附加说明、
                  插件和 MCP、已保存文档都删了" —— 所以这里只剩图片和文件两件，
                  别再加回去（录音在右边的语音键、表情在自己的键、文档在工具区）。
                */}
              </div>
            )}
          </div>
          <div className="relative min-w-0 flex-1">
            {/*
              用户 m07473（原话）：
                "对话框高度长度都不变，里面有四个组件，一个加号，一个模型，
                 强度和他合并，还有一个表情包按键和一个语音，所有的位置都不变"

              所以这里**只占一格**：原来"模型"和"推理"两颗胶囊合成一颗，
              分成上下两行（上行模型名、下行推理档），空出来的那一格给表情键。
              点这颗胶囊才弹出第一层菜单（模型 / 推理等级），再点才是具体选项。

              ⚠️ 别把它拆回两颗、也别挪到输入框上方 —— 位置必须还是原来那格。
            */}
            <button
              type="button"
              onClick={() => {
                setModelOpen((v) => !v);
                setReasonOpen(false);
                setPlusOpen(false);
                setStickerOpen(false);
              }}
              aria-label="模型与推理等级"
              className="flex h-9 w-full flex-col items-start justify-center gap-px rounded-2xl bg-chip px-3 text-left"
            >
              <span className="flex w-full items-center gap-1">
                <span className="truncate font-mono text-[10.5px] leading-none text-fg">
                  {settings.upstreamModel || "未选模型"}
                </span>
                <ChevronDown className="ml-auto size-3 shrink-0 text-muted" />
              </span>
              <span className="truncate text-[9px] leading-none text-muted">
                推理 · {getModel(model).label}
              </span>
            </button>

            {/*
              第一层（用户 m07473 的"三级弹层"）：只列两件事 ——
              模型 / 推理等级，各自右侧一个 ›。点哪一项才展开第二层。
            */}
            {modelOpen && (
              <div className="glass-menu absolute bottom-13 left-0 z-20 w-full overflow-hidden rounded-2xl border border-line py-1">
                <button
                  type="button"
                  onClick={() => {
                    setModelOpen(false);
                    setModelPickOpen(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                >
                  <span className="w-14 shrink-0 text-[12px] text-muted">模型</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                    {settings.upstreamModel || "未选模型"}
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModelOpen(false);
                    setReasonOpen(true);
                  }}
                  className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left"
                >
                  <span className="w-14 shrink-0 text-[12px] text-muted">推理等级</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                    {getModel(model).label}
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted" />
                </button>
              </div>
            )}

            {/* 第二层：模型列表 */}
            {modelPickOpen && (
              <div className="glass-menu absolute bottom-13 left-0 z-20 w-full overflow-hidden rounded-2xl border border-line py-1">
                {settings.upstreamModels.length > 0 ? (
                  settings.upstreamModels.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        patch({ upstreamModel: m });
                        setModelPickOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left",
                        m === settings.upstreamModel && "bg-chip",
                      )}
                    >
                      <span className="truncate font-mono text-[13px]">{m}</span>
                      {m === settings.upstreamModel && <Check className="size-3.5 text-accent" />}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2.5">
                    <p className="text-[12px] leading-5 text-muted">
                      还没配模型 —— 要先告诉栖岛用哪家、用哪个模型。
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setModelPickOpen(false);
                        void navigate({ to: "/me" });
                      }}
                      className="mt-2 rounded-full bg-chip px-3 py-1.5 text-[12px] font-medium"
                    >
                      去「我的 → 自定义上游」配
                    </button>
                  </div>
                )}
                <p className="border-t border-line px-3 py-2 text-[11px] leading-4 text-muted">
                  这里列的是你上游真实可用的模型名（在「我的 → 自定义上游」里拉取或手填）。
                </p>
              </div>
            )}

            {/* 第二层：推理等级 */}
            {reasonOpen && (
              <div className="glass-menu absolute bottom-13 left-0 z-20 w-full overflow-hidden rounded-2xl border border-line py-1">
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setModel(m.id);
                      setReasonOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left",
                      m.id === model && "bg-chip",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{m.label}</span>
                      <span className="mt-0.5 block text-[11px] text-subtle">{m.subtitle}</span>
                    </span>
                    {m.id === model && <Check className="size-3.5 shrink-0 text-accent" />}
                  </button>
                ))}
                <p className="border-t border-line px-3 py-2 text-[11px] leading-4 text-muted">
                  决定想多深、以及单次最大输出。跟上面那个模型名是两件事。
                </p>
              </div>
            )}
          </div>
          {/* 第四格左边这一格：表情（用户 m07473："一个表情包按键"） */}
          <button
            type="button"
            aria-label="表情"
            onClick={() => {
              setStickerOpen((v) => !v);
              setPlusOpen(false);
              setModelOpen(false);
              setReasonOpen(false);
            }}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              stickerOpen ? "bg-accent-soft text-accent" : "bg-chip text-accent",
            )}
          >
            <Smile className="size-5" strokeWidth={1.7} />
          </button>
          <button
            type="button"
            aria-label={
              recOn.current ? "松开发送语音" : value.trim() || pending.length ? "发送" : "按住说话"
            }
            disabled={disabled}
            onPointerDown={micDown}
            onPointerMove={micMove}
            onPointerUp={micUp}
            onPointerCancel={() => void stopRec(false)}
            className={cn(
              "flex size-9 items-center justify-center rounded-full bg-ink text-ink-fg disabled:opacity-50",
              recMs !== null && "bg-warn",
            )}
          >
            {streaming ? (
              <span className="size-3.5 rounded-sm bg-ink-fg" />
            ) : recMs !== null ? (
              <Square className="size-4 fill-current" />
            ) : value.trim() || pending.length ? (
              <ArrowUp className="size-5" strokeWidth={2.2} />
            ) : (
              <Mic className="size-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: Array<Array<{ transcript: string }>> }) => void) | null;
  start: () => void;
};
