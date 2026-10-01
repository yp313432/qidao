/**
 * 环境自检：把「这台设备 + 这个外壳到底能干什么」摆出来。
 *
 * 做这个的直接原因：麦克风、通知、摄像头这类能力**不是代码问题，是环境问题** ——
 * 同一个页面在 localhost、局域网 http、部署后的 https、封装成 APP 之后，
 * 结论完全不同。所以与其猜，不如让它自己报。
 */

export type EnvStatus = "ok" | "warn" | "no";

export type EnvItem = {
  id: string;
  label: string;
  status: EnvStatus;
  detail: string;
  /** 用不了的话，怎么才能用 */
  fix?: string;
};

const HTTPS_HINT =
  "需要安全地址：https 或 localhost。局域网明文 http（像 http://192.168.x.x:8080）浏览器一定会拦。";

export async function collectEnv(): Promise<EnvItem[]> {
  const items: EnvItem[] = [];
  const hasWindow = typeof window !== "undefined";
  const secure = hasWindow ? window.isSecureContext : false;
  const origin = hasWindow ? window.location.origin : "（服务端）";
  const ua = hasWindow ? navigator.userAgent : "";

  /* ---------- 1. 安全上下文：后面一大半能力的前提 ---------- */
  items.push({
    id: "secure",
    label: "安全上下文",
    status: secure ? "ok" : "no",
    detail: secure
      ? `${origin} 被浏览器视为安全`
      : `${origin} 不是安全地址`,
    fix: secure ? undefined : HTTPS_HINT,
  });

  /* ---------- 2. 麦克风（录音 / 语音识别 / 语音对话都要它） ---------- */
  const hasGum = hasWindow && Boolean(navigator.mediaDevices?.getUserMedia);
  const hasRecorder = hasWindow && typeof MediaRecorder !== "undefined";
  let mic: EnvItem;
  if (!hasGum && !secure) {
    // 非安全地址下浏览器会**直接把这个接口藏起来**，连「不支持」都不算
    mic = {
      id: "mic",
      label: "麦克风 · 录音",
      status: "no",
      detail: "地址不安全，浏览器把录音接口整个藏起来了（navigator.mediaDevices 是 undefined）",
      fix: HTTPS_HINT,
    };
  } else if (!hasGum || !hasRecorder) {
    mic = {
      id: "mic",
      label: "麦克风 · 录音",
      status: "no",
      detail: "这个外壳没提供录音接口",
      fix: "换 Chrome / Edge；封装成 APP 时要在原生层声明并申请录音权限。",
    };
  } else {
    let micCount = -1;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      micCount = devices.filter((d) => d.kind === "audioinput").length;
    } catch {
      micCount = -1;
    }
    const ok = secure && micCount !== 0;
    mic = {
      id: "mic",
      label: "麦克风 · 录音",
      status: ok ? "ok" : micCount === 0 ? "no" : "warn",
      detail:
        micCount === 0
          ? "没找到麦克风设备"
          : micCount > 0
            ? `接口可用，设备 ${micCount} 个${secure ? "" : "（但地址不安全，一按就被拒）"}`
            : "接口可用（设备数读不到，通常是还没授权）",
      fix: ok ? undefined : secure ? "去系统设置里允许麦克风。" : HTTPS_HINT,
    };
  }
  items.push(mic);

  /* ---------- 3. 语音识别 ---------- */
  const w = hasWindow
    ? (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
    : {};
  const hasSR = Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
  items.push({
    id: "stt",
    label: "语音识别（说话转文字）",
    status: hasSR && secure ? "ok" : hasSR ? "warn" : "no",
    detail: hasSR ? "接口可用（识别过程在云端，要联网）" : "这个外壳没提供语音识别（一般是 Safari / 部分安卓内核）",
    fix:
      hasSR && secure
        ? undefined
        : hasSR
          ? HTTPS_HINT
          : "用 Chrome / Edge；或者封装成 APP 后改用原生识别。",
  });

  /* ---------- 4. 语音合成 ---------- */
  const synth = hasWindow ? window.speechSynthesis : undefined;
  const voices = synth?.getVoices?.() ?? [];
  items.push({
    id: "tts",
    label: "语音合成（把回复念出来）",
    status: synth ? (voices.length ? "ok" : "warn") : "no",
    detail: synth
      ? voices.length
        ? `可用，${voices.length} 个声音`
        : "接口可用，但还没加载出声音（点一下朗读通常会加载）"
      : "这个外壳没有语音合成",
    fix: synth ? undefined : "换一个浏览器；纯离线环境可能没装语音包。",
  });

  /* ---------- 5. 音频播放格式（决定录音能不能放回来） ---------- */
  let audioFmt = "不支持";
  if (hasWindow && typeof Audio !== "undefined") {
    const a = new Audio();
    if (a.canPlayType('audio/webm;codecs="opus"')) audioFmt = "webm/opus";
    else if (a.canPlayType("audio/mp4")) audioFmt = "mp4/aac";
    else if (a.canPlayType("audio/ogg")) audioFmt = "ogg";
  }
  items.push({
    id: "audio",
    label: "音频回放格式",
    status: audioFmt === "不支持" ? "no" : "ok",
    detail: `这台设备能放：${audioFmt}`,
    fix: audioFmt === "不支持" ? "录音能录但放不回来，换浏览器或装入 APP。" : undefined,
  });

  /* ---------- 6. 摄像头 ---------- */
  const hasCam = hasWindow && Boolean(navigator.mediaDevices?.getUserMedia);
  items.push({
    id: "camera",
    label: "摄像头",
    status: hasCam && secure ? "ok" : "no",
    detail: !hasCam
      ? secure
        ? "这个外壳没提供摄像头接口"
        : "地址不安全，浏览器把摄像头接口藏起来了"
      : "接口可用",
    fix: hasCam && secure ? undefined : HTTPS_HINT,
  });

  /* ---------- 7. 通知 ---------- */
  const notifApi = hasWindow && typeof Notification !== "undefined";
  const perm = notifApi ? Notification.permission : "unsupported";
  items.push({
    id: "notify",
    label: "系统通知",
    status: !notifApi ? "no" : perm === "granted" ? "ok" : perm === "denied" ? "no" : "warn",
    detail: !notifApi
      ? "这个外壳没有通知接口"
      : perm === "granted"
        ? "已授权"
        : perm === "denied"
          ? "被拒绝了（要去浏览器设置里改）"
          : "还没问过，点开关时会申请",
    fix: !notifApi || perm === "denied" ? "在浏览器/系统设置里允许通知。" : undefined,
  });

  /* ---------- 8. Service Worker / 离线 / 推送 ---------- */
  const hasSW = hasWindow && "serviceWorker" in navigator;
  let swReady = false;
  try {
    swReady = Boolean(hasSW && (await navigator.serviceWorker.getRegistration()));
  } catch {
    swReady = false;
  }
  items.push({
    id: "sw",
    label: "Service Worker（离线 / 后台）",
    status: !hasSW ? "no" : swReady ? "ok" : "warn",
    detail: !hasSW ? "这个外壳不支持" : swReady ? "已注册" : "接口可用但还没注册成功",
    fix: !hasSW ? HTTPS_HINT : undefined,
  });

  const hasPush = hasWindow && "PushManager" in window;
  items.push({
    id: "push",
    label: "后台推送",
    status: hasPush && secure ? "warn" : "no",
    detail: hasPush
      ? "接口可用（还需要服务端推送通道；现在走的是本地提醒）"
      : "这个外壳没有推送接口",
    fix: hasPush ? undefined : HTTPS_HINT,
  });

  /* ---------- 9. 存储 ---------- */
  let persisted = false;
  let quota = 0;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
    quota = (await navigator.storage?.estimate?.())?.quota ?? 0;
  } catch {
    /* ignore */
  }
  items.push({
    id: "storage",
    label: "本地存储",
    status: quota > 0 ? (persisted ? "ok" : "warn") : "warn",
    detail:
      quota > 0
        ? `可用 ${(quota / 1024 / 1024).toFixed(0)}MB${persisted ? "，已申请持久化" : "，未持久化（系统可能回收）"}`
        : "读不到容量（一般仍可用）",
    fix: persisted ? undefined : "不影响使用；想更稳可以点「申请持久化」。",
  });

  /* ---------- 10. 外壳信息 ---------- */
  const standalone =
    hasWindow &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);
  items.push({
    id: "shell",
    label: "当前外壳",
    status: "ok",
    detail: standalone
      ? "以独立应用方式打开（已安装 / 已封装）"
      : /Android|iPhone|iPad/i.test(ua)
        ? "在手机浏览器里打开（不是独立应用）"
        : "在桌面浏览器里打开",
  });

  return items;
}

export function summarize(items: EnvItem[]): { ok: number; warn: number; no: number } {
  return {
    ok: items.filter((i) => i.status === "ok").length,
    warn: items.filter((i) => i.status === "warn").length,
    no: items.filter((i) => i.status === "no").length,
  };
}
