import { WebSourceList } from "@/components/chat/web-source-list";
import { sourcesForReceipt, webReceiptFromCall } from "@/lib/web-sources";
import type { ToolCallRecord } from "@/lib/types";

/** Search cards stay outside the step's toggle button, so their links remain independent. */
export function WebToolResult({ call }: { call: ToolCallRecord }) {
  const receipt = webReceiptFromCall(call);
  if (!receipt) return <p className="k-tool-result-text">{call.result.slice(0, 4000)}{call.result.length > 4000 && "\n（此处展示前 4000 字）"}</p>;
  const sources = sourcesForReceipt(receipt);
  return <div className="k-web-result">
    <p className="k-source-card__note">{receipt.kind === "web.search" && receipt.query ? `搜索「${receipt.query}」 · ` : ""}{receipt.summary}</p>
    {sources.length > 0 ? <WebSourceList sources={sources} /> : <p role="status" className="k-source-card__note">{receipt.why || "未取得可用网页来源，可换一组关键词再试。"}</p>}
  </div>;
}
