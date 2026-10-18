import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TarotBack, TarotFace } from "@/components/play/tarot-card-svg";
import { buildContext } from "@/lib/awareness";
import { resolveAiName } from "@/lib/branding";
import type { ChatRequest } from "@/lib/chat-client";
import { gardenTurn } from "@/lib/garden-play";
import { useApp } from "@/lib/store";
import { describeDraw, spreadOf, type SpreadId } from "@/lib/tarot";
import { useActivity } from "@/lib/use-activity";
import { stripActions } from "@/lib/use-chat";

/**
 * `/play/garden/tarot` —— 棋桌的三级页：真塔罗。
 *
 * 用户 m06018："在新加一个塔罗牌游戏，是真正的塔罗牌，我写上想问的，
 * 他按照顺序抽卡占卜，卡牌随机选……最后还有牌面解读"。
 *
 * 分工（照真塔罗的流程拆的）：
 *   你写问题（可不写）→ 选牌阵 → **他洗牌、按顺序抽**（`store.startTarot`，
 *   规则在 `lib/tarot.ts`：78 张、不放回、逆位约 1/3）→ 你一张张点开
 *   → 他把牌读给你（一次模型请求，逐张 + 串起来 + 一句建议）。
 *
 * 牌面不随机"演"：翻开的顺序、正逆位、牌名全部来自 store，
 * 解读要落在**这几张具体的牌**上 —— 所以他拿到的提示里带着位置和牌义。
 */

export const Route = createFileRoute("/_app/play/garden/tarot")({
  component: TarotView,
});

const POSITION_ZH = ["过去", "现在", "未来"];

function TarotView() {
  useActivity("在花园的棋桌边摆塔罗");

  const aiName = useApp((s) => resolveAiName(s.settings.aiName));
  const tarot = useApp((s) => s.gardenTarot);
  const startTarot = useApp((s) => s.startTarot);
  const revealTarot = useApp((s) => s.revealTarot);
  const setTarotReading = useApp((s) => s.setTarotReading);
  const clearTarot = useApp((s) => s.clearTarot);

  const [questionDraft, setQuestionDraft] = useState("");
  const [spreadDraft, setSpreadDraft] = useState<SpreadId>("three");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const readFor = useRef<number>(-1);

  const spread = tarot ? spreadOf(tarot.spread) : spreadOf(spreadDraft);
  const allOpen = Boolean(tarot && tarot.revealed >= tarot.cards.length);

  /** 牌全翻开后，他讲一次（只讲一次：按这一副牌的 at 去重） */
  useEffect(() => {
    if (!tarot || !allOpen || busy) return;
    if (tarot.reading) return;
    if (readFor.current === tarot.at) return;
    readFor.current = tarot.at;
    void read(tarot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarot?.at, allOpen, busy, tarot?.reading]);

  async function read(current: NonNullable<typeof tarot>) {
    const st = useApp.getState();
    const setting = st.settings;
    setBusy(true);
    setFailed("");
    setStreaming("");

    const positions = spreadOf(current.spread).positions;
    const lines = describeDraw(positions, current.cards);

    const instruction =
      `（花园的棋桌，塔罗这一角。我刚洗完牌，按顺序抽好了，正一张张翻开。）\n` +
      (current.question ? `我问的是：「${current.question}」\n` : "我没写具体问题，你看着这牌说话。\n") +
      `牌阵：${spreadOf(current.spread).zh}（${positions.join(" / ")}）\n` +
      `抽到的牌：\n${lines}\n\n` +
      `照着这三件事讲：\n` +
      `1. 一张一张说：这张牌落在这个位置上是什么意思 —— 要落到我这件事上，别背牌义表；\n` +
      `2. 把牌串成一条线：我现在处在什么局面、卡在哪；\n` +
      `3. 最后给一句我马上能做的事，具体一点（别说"要相信自己的内心"这种）。\n` +
      `用你平时跟我说话的语气，像坐在对面讲，不要标题、不要列表、不要 "作为 AI"。\n` +
      `长度三五百字就够。`;

    const req: ChatRequest = {
      model: st.model,
      messages: [{ role: "user", content: instruction }],
      style: setting.replyStyle,
      tools: [],
      customBaseUrl: setting.customBaseUrl || undefined,
      customApiKey: setting.customApiKey || undefined,
      upstreamModel: setting.upstreamModel || undefined,
      maxTokens: setting.maxTokens,
      name: setting.displayName,
      aiName: resolveAiName(setting.aiName),
      persona: setting.persona || undefined,
      context: {
        activity: `在花园的棋桌边摆塔罗（${spreadOf(current.spread).zh}牌阵）`,
        now: new Date().toLocaleString("zh-CN"),
        granted: buildContext().granted,
      },
      permissions: setting.permissions,
    };

    try {
      const r = await gardenTurn({
        req,
        allow: [],
        onText: (text) => setStreaming(text),
      });
      const clean = stripActions(r.text).trim();
      if (r.failed) {
        // 没接上模型时网关会回一句人话（"还没接模型：去……"），当提示显示，别当成牌面解读
        setFailed(clean || "他没接上（模型那边没通），牌留着，等下再让他讲一次。");
      } else if (clean) {
        setTarotReading(clean);
        useApp.getState().appendGardenTalk([{ role: "assistant", content: clean }]);
      }
    } catch {
      setFailed("这次没讲成，牌还在桌上，再试一次。");
    } finally {
      setBusy(false);
      setStreaming("");
    }
  }

  const shown = tarot?.reading || streaming;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#191209] text-[#f6ead3]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(64% 52% at 50% 32%, #4b3520 0%, #2b1f14 52%, #191209 100%)",
        }}
      />

      <header
        className="relative z-20 px-4"
        style={{ paddingTop: "max(14px, env(safe-area-inset-top))" }}
      >
        <div className="relative flex h-11 items-center justify-center">
          <Link
            to="/play/garden/tavolo"
            aria-label="返回棋桌"
            className="absolute left-0 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center text-[#e6cf9f]/80"
          >
            <ChevronLeft className="size-6" strokeWidth={1.4} />
          </Link>
          <div className="text-center">
            <p className="text-[15px] tracking-[0.42em] text-[#f4e4c4]">塔 罗</p>
            <p className="mt-1 text-[8.5px] tracking-[0.34em] text-[#c9a24a]/70">
              TAROCCHI{tarot ? ` · ${spread.it.toUpperCase()}` : ""}
            </p>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[440px] flex-col px-5 pb-12">
        {/* ── 还没摆牌：写问题 + 选牌阵 ── */}
        {!tarot && (
          <section data-anchor="tarot-question" className="mt-4">
            <p className="text-center text-[11px] tracking-[0.3em] text-[#c9a24a]/75">我 想 问</p>
            <textarea
              value={questionDraft}
              onChange={(e) => setQuestionDraft(e.target.value.slice(0, 120))}
              placeholder="（可以不写。写上，他会照着你这句话讲）"
              rows={3}
              className="mt-3 w-full resize-none rounded-lg border border-[#c9a24a]/25 bg-[#2a1e14]/70 px-3 py-3 text-[14px] leading-6 text-[#f4e4c4] placeholder:text-[#a08a63]/70 focus:border-[#c9a24a]/60 focus:outline-none"
            />
            <p className="mt-1 text-right text-[10px] text-[#a08a63]/80">{questionDraft.length}/120</p>

            <div data-anchor="tarot-spread" className="mt-5">
              <p className="text-center text-[11px] tracking-[0.3em] text-[#c9a24a]/75">选 牌 阵</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {(["one", "three"] as const).map((id) => {
                  const sp = spreadOf(id);
                  const on = spreadDraft === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSpreadDraft(id)}
                      className={`rounded-lg border px-3 py-3 text-left transition ${
                        on
                          ? "border-[#c9a24a]/80 bg-[#3b2b1b]/80"
                          : "border-[#c9a24a]/22 bg-[#2a1e14]/60 hover:border-[#c9a24a]/45"
                      }`}
                    >
                      <span className="flex items-baseline justify-between">
                        <span className="text-[14px] tracking-[0.2em] text-[#f4e4c4]">{sp.zh}</span>
                        <span className="text-[9px] italic text-[#c9a24a]/75">{sp.it}</span>
                      </span>
                      <span className="mt-1 block text-[10.5px] leading-4 text-[#d8c3a0]/75">
                        {sp.positions.join(" · ")}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-center text-[10.5px] leading-4 text-[#a08a63]/90">{spread.note}</p>
            </div>

            <button
              type="button"
              onClick={() => startTarot({ question: questionDraft, spread: spreadDraft })}
              className="mt-6 w-full rounded-lg border border-[#c9a24a]/70 bg-[#c9a24a]/18 py-3 text-[14px] tracking-[0.28em] text-[#f6e2b8] transition hover:bg-[#c9a24a]/28"
            >
              洗 牌 · 请 他 抽
            </button>
            <p className="mt-2 text-center text-[10px] leading-4 text-[#a08a63]/75">
              78 张韦特塔罗，抽过不放回；正逆位由洗牌决定（约三成逆位）
            </p>
          </section>
        )}

        {/* ── 摆了牌 ── */}
        {tarot && (
          <>
            <section className="mt-3">
              <div className="rounded-lg border border-[#c9a24a]/18 bg-[#241a11]/60 px-3 py-2.5">
                <p className="text-[10px] tracking-[0.24em] text-[#c9a24a]/70">我 想 问</p>
                <p className="mt-1 text-[13.5px] leading-6 text-[#f1e1c2]">
                  {tarot.question ? `「${tarot.question}」` : "（没写问题，他自己看着牌说）"}
                </p>
              </div>
            </section>

            <section
              data-anchor="tarot-cards"
              className={`mt-6 flex items-end justify-center ${
                tarot.spread === "three" ? "gap-2.5" : ""
              }`}
            >
              {tarot.cards.map((d, i) => {
                const open = i < tarot.revealed;
                const next = i === tarot.revealed;
                return (
                  <div key={`${d.card.id}-${i}`} className="flex min-w-0 flex-1 flex-col items-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (!open && next) revealTarot();
                      }}
                      aria-label={
                        open
                          ? `${POSITION_ZH[i] ?? `第 ${i + 1} 张`}：${d.card.zh}${d.reversed ? "（逆位）" : ""}`
                          : `翻开${POSITION_ZH[i] ?? `第 ${i + 1} 张`}`
                      }
                      className={`relative w-full transition-transform duration-300 ${
                        next ? "animate-pulse hover:scale-[1.03]" : ""
                      }`}
                      style={{ maxWidth: tarot.spread === "three" ? 120 : 190 }}
                    >
                      <div
                        className="relative w-full"
                        style={{ perspective: "700px", aspectRatio: "220 / 360" }}
                      >
                        <div
                          className="absolute inset-0 transition-transform duration-700"
                          style={{
                            transformStyle: "preserve-3d",
                            transform: open ? "rotateY(180deg)" : "rotateY(0deg)",
                          }}
                        >
                          <div className="absolute inset-0" style={{ backfaceVisibility: "hidden" }}>
                            <TarotBack className="h-full w-full drop-shadow-[0_6px_18px_rgba(0,0,0,.45)]" />
                          </div>
                          <div
                            className="absolute inset-0"
                            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                          >
                            <TarotFace
                              drawn={d}
                              className="h-full w-full drop-shadow-[0_6px_18px_rgba(0,0,0,.45)]"
                            />
                          </div>
                        </div>
                      </div>
                    </button>
                    <p className="mt-2 text-[11px] tracking-[0.22em] text-[#e8cf9b]/85">
                      {tarot.spread === "three" ? POSITION_ZH[i] : "此刻"}
                    </p>
                    <p className="mt-0.5 h-4 text-[9.5px] text-[#a08a63]/85">
                      {open ? `${d.card.zh}${d.reversed ? " · 逆位" : ""}` : "点开"}
                    </p>
                  </div>
                );
              })}
            </section>

            {!allOpen && (
              <p className="mt-4 text-center text-[11px] tracking-[0.2em] text-[#c9a24a]/70">
                按顺序一张张点开 · 还剩 {tarot.cards.length - tarot.revealed} 张
              </p>
            )}

            {allOpen && (
              <section data-anchor="tarot-reading" className="mt-7">
                <div className="rounded-lg border border-[#c9a24a]/22 bg-[#241a11]/70 px-4 py-4">
                  <p className="text-[11px] tracking-[0.26em] text-[#c9a24a]/80">
                    {aiName} · 牌面解读
                  </p>
                  {shown ? (
                    <div className="mt-2 space-y-2 text-[13.5px] leading-6 text-[#f2e3c6]">
                      {shown
                        .split(/\n+/)
                        .filter(Boolean)
                        .map((para, i) => (
                          <p key={i}>{para}</p>
                        ))}
                      {busy && <span className="inline-block h-3 w-1.5 animate-pulse bg-[#c9a24a]" />}
                    </div>
                  ) : (
                    <p className="mt-2 text-[13px] leading-6 text-[#d8c3a0]/80">
                      {failed || "他在看牌……"}
                    </p>
                  )}
                  {failed && (
                    <button
                      type="button"
                      onClick={() => {
                        readFor.current = -1;
                        void read(tarot);
                      }}
                      className="mt-3 rounded-md border border-[#c9a24a]/40 px-3 py-1.5 text-[11.5px] text-[#f0d9ab]/90"
                    >
                      让他再讲一次
                    </button>
                  )}
                </div>

                <div className="mt-4 flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      const q = tarot.question;
                      const sp = tarot.spread;
                      readFor.current = -1;
                      clearTarot();
                      window.setTimeout(() => startTarot({ question: q, spread: sp }), 30);
                    }}
                    className="flex-1 rounded-lg border border-[#c9a24a]/45 bg-[#2a1e14]/70 py-2.5 text-[12.5px] tracking-[0.16em] text-[#f0d9ab]"
                  >
                    再抽一次
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearTarot();
                      readFor.current = -1;
                      setStreaming("");
                      setFailed("");
                    }}
                    className="flex-1 rounded-lg border border-[#c9a24a]/25 py-2.5 text-[12.5px] tracking-[0.16em] text-[#d8c3a0]/85"
                  >
                    换个问题
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        <p className="mt-8 text-center text-[10px] tracking-[0.2em] text-[#a08a63]/60">
          洗牌 · 切牌 · 依次翻开
        </p>
      </main>
    </div>
  );
}
