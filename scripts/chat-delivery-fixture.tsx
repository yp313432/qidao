// Real input, delivery, settings, store, chat loop and sticker/emotion actions. Only upstream is simulated.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { Composer } from "../src/components/chat/composer";
import { SegmentBubbles } from "../src/components/chat/segment-bubbles";
import { ChatDeliverySettings } from "../src/components/me/chat-delivery-settings";
import { ActionGate } from "../src/components/shared/action-gate";
import { useChatStream } from "../src/lib/use-chat";
import { useApp } from "../src/lib/store";
import { waitHydrated } from "../src/lib/store-ready";
import { splitSegments } from "../src/lib/segment";
import "../src/styles.css";

await waitHydrated();
const history = new URLSearchParams(location.search).has("history");
const empty = new URLSearchParams(location.search).has("empty");
const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
useApp.setState((s) => ({ settings: { ...s.settings,
  customBaseUrl: "http://127.0.0.1:4650/v1", customApiKey: "fixture-key", upstreamModel: "fixture-model",
  toolProtocol: "native", toolProbeOk: true, voiceReplies: false, notifications: false,
  segmentReply: true, segmentMaxParts: 6, segmentMaxSentences: 1, segmentSmartDelay: true, segmentCharDelayMs: 60,
  mergeSend: true, mergeSendDelayMs: 600, assistantAutoClean: true,
  aiStickers: !new URLSearchParams(location.search).has("no-stickers"),
  permissions: Object.fromEntries(Object.keys(s.settings.permissions).map((key) => [key, "allow"])),
}, conversations: [], activeId: null, pendingActions: [], actionLog: [], emotionEvents: [], mcp: [], httpTools: [],
  stickerLib: empty ? [] : [{ id: "gif", group: "开心", url: gif },
    { id: "svg", group: "开心", url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Ctext y='45' font-size='40'%3E%E2%98%BA%3C/text%3E%3C/svg%3E" }],
}));
const clean = (text: string) => text;
const noMessages = [];
function Fixture() {
  const { busy, replying, send, stop, pendingCount, liveId } = useChatStream({ forceProtocol: "native" });
  const allowSupplements = useApp((s) => s.settings.replyWhileBusy !== false);
  const messages = useApp((s) => s.conversations.find((c) => c.id === s.activeId)?.messages ?? noMessages);
  const emotionEvents = useApp((s) => s.emotionEvents);
  const charDelay = useApp((s) => s.settings.segmentCharDelayMs);
  const [draft, setDraft] = useState(["第一句话。", "第二句话，我们慢慢说。", "第三句话，不用着急把所有的话一次发完。"]);
  const [paceReady, setPaceReady] = useState(history);
  return <main className="mx-auto max-w-3xl space-y-5 p-4">
    <h1 className="text-lg font-medium">聊天节奏</h1>
    <button className="k-btn" onClick={() => setPaceReady(true)}>演示逐条发送</button>
    <section data-testid="pace">{paceReady && <SegmentBubbles parts={draft} fresh={!history} deliveryKey="pace"
      cleanPart={clean} cleanTail={clean} />}</section>
    <button className="k-btn" onClick={() => setDraft(["换个说法。", "新的补充。"])}>修订回复</button>
    <section data-testid="settings"><ChatDeliverySettings /></section>
    <section data-testid="chat" className="space-y-3">{messages.map((m) => <div key={m.id} data-role={m.role}>
      {m.role === "user" ? <p className="k-bubble">{m.content}</p> : m.content && <SegmentBubbles
        parts={m.parts || splitSegments(m.content)} liveTail={liveId === m.id} fresh deliveryKey={m.id}
        cleanPart={clean} cleanTail={clean} />}
      {m.attachments?.map((a) => <img key={a.id} data-testid="sticker" src={a.dataUrl} alt="表情" width="60" height="60" />)}
    </div>)}</section>
    <Composer streaming={busy} disabled={replying && !allowSupplements} queuedCount={pendingCount} onStop={stop} onSend={(text, atts) => void send(text, atts)} />
    <output data-testid="busy">{busy ? "busy" : "idle"}</output>
    <pre hidden data-testid="messages">{JSON.stringify(messages)}</pre>
    <pre hidden data-testid="emotions">{JSON.stringify(emotionEvents)}</pre>
    <output hidden data-testid="pace-setting">{charDelay}</output>
    <ActionGate />
  </main>;
}
const route = createRootRoute({ component: Fixture });
const router = createRouter({ routeTree: route, history: createMemoryHistory({ initialEntries: ["/"] }) });
createRoot(document.getElementById("fixture")!).render(<RouterProvider router={router} />);
