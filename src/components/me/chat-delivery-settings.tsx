import { useApp } from "@/lib/store";
import { KOpt, KOpts } from "@/components/ui-kit";
import { Row, Sub } from "./me-widgets";

export function ChatDeliverySettings() {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  return <Sub title="说话方式">
    <Row label="按标点分句" checked={settings.segmentReply !== false} onChange={(v) => patch({ segmentReply: v })} />
    {settings.segmentReply !== false && <>
      <Row label="逐条发送" hint="关闭后，各句直接同时显示" checked={settings.segmentPacing !== false}
        onChange={(v) => patch({ segmentPacing: v })} />
      {settings.segmentPacing !== false && <>
      <Row label="智能发送节奏" hint="按句子长度等待，每条依次出现" checked={settings.segmentSmartDelay !== false}
        onChange={(v) => patch({ segmentSmartDelay: v })} />
      <KOpts cols={3}>{(settings.segmentSmartDelay !== false ? [30, 60, 90] : [800, 1200, 2000]).map((v, i) => <KOpt key={v}
        active={(settings.segmentSmartDelay !== false ? settings.segmentCharDelayMs ?? 60 : settings.segmentDelayMs ?? 1200) === v}
        onClick={() => patch(settings.segmentSmartDelay !== false ? { segmentCharDelayMs: v } : { segmentDelayMs: v })}>
        {settings.segmentSmartDelay !== false ? ["轻快", "自然", "慢一点"][i] : `${v / 1000} 秒`}
      </KOpt>)}</KOpts>
      </>}
      <p className="k-sect__title mt-4">每条几句</p>
      <KOpts cols={3}>{[1, 2, 3].map((v) => <KOpt key={v} active={(settings.segmentMaxSentences ?? 1) === v}
        onClick={() => patch({ segmentMaxSentences: v })}>{v} 句</KOpt>)}</KOpts>
      <p className="k-sect__title mt-4">每次最多几条</p>
      <KOpts cols={3}>{[3, 6, 12].map((v) => <KOpt key={v} active={(settings.segmentMaxParts ?? 6) === v}
        onClick={() => patch({ segmentMaxParts: v })}>{v} 条</KOpt>)}</KOpts>
    </>}
    <Row label="合并发送" hint="发送前等待片刻，收齐连续消息再回复"
      checked={settings.mergeSend !== false} onChange={(v) => patch({ mergeSend: v })} />
    {settings.mergeSend !== false && <KOpts cols={3}>{[600, 1200, 2000].map((v) => <KOpt key={v}
      active={(settings.mergeSendDelayMs ?? 1200) === v} onClick={() => patch({ mergeSendDelayMs: v })}>{v / 1000} 秒</KOpt>)}</KOpts>}
    <Row label="回复时允许补充消息" hint="保持输入可用；补充合并排队，当前回复结束后自动处理"
      checked={settings.replyWhileBusy !== false} onChange={(v) => patch({ replyWhileBusy: v })} />
    <Row label="自动清理内部标记" hint="隐藏情绪参数和表情占位文字，保留正常对话"
      checked={settings.assistantAutoClean !== false} onChange={(v) => patch({ assistantAutoClean: v })} />
  </Sub>;
}

export function ChatStickerSettings() {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  return <Sub title="表情包">
    <Row label="AI 主动发表情" hint="关闭后，AI 不再发送图片表情"
      checked={settings.aiStickers !== false} onChange={(v) => patch({ aiStickers: v })} />
    <Row label="传表情时自动去白底" checked={settings.stickerRemoveWhite !== false}
      onChange={(v) => patch({ stickerRemoveWhite: v })} />
  </Sub>;
}
