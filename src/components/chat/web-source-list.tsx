import { memo, useState, type Ref } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { sourceKey, type WebSource } from "@/lib/web-sources";
import { openPluginWeb } from "@/lib/plugin-open";
import { pushToast } from "@/lib/toast";

export const WebSourceList = memo(function WebSourceList({ sources, maxVisible = 3, focusedUrl, focusedRef }: {
  sources: WebSource[]; maxVisible?: number; focusedUrl?: string; focusedRef?: Ref<HTMLAnchorElement>;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded || focusedUrl ? sources : sources.slice(0, maxVisible);
  return <div className="k-web-sources">
    {visible.map((source) => {
      const focused = !!focusedUrl && sourceKey(focusedUrl) === sourceKey(source.url);
      const domain = new URL(source.url).hostname.replace(/^www\./, "");
      return <article key={sourceKey(source.url)} className="k-source-card" data-highlighted={focused || undefined}>
        <div className="k-source-card__meta">
          <Globe aria-hidden="true" />
          <span>{domain}</span>
          <span className="k-source-card__state" data-state={source.state}>
            {source.state === "read" ? "已读正文" : source.state === "unavailable" ? "正文未读到" : "搜索摘要"}
          </span>
        </div>
        <a ref={focused ? focusedRef : undefined} href={source.url} target="_blank" rel="noopener noreferrer"
          className="k-source-card__title" aria-label={`来源 ${source.index}：${source.title}，打开原网页`}
          onClick={(event) => {
            event.preventDefault(); event.stopPropagation();
            void openPluginWeb(source.url).catch(() => pushToast("暂时无法打开，可长按来源标题复制网址。"));
          }}>
          <span className="k-source-card__number">{source.index}</span>
          <span>{source.title}</span><ExternalLink aria-hidden="true" />
        </a>
        {source.snippet && <p className="k-source-card__snippet">{source.snippet}</p>}
        {source.state === "summary" && !source.snippet && <p className="k-source-card__note">搜索未提供摘要，可打开原网页查看。</p>}
        {source.state === "unavailable" && <p className="k-source-card__note">{source.why || "暂时未取得这页正文。"}{source.snippet ? " 搜索摘要仍可查看。" : " 可打开原网页查看。"}</p>}
        {source.state === "read" && source.excerpt && <details className="k-source-card__excerpt">
          <summary>查看已读取的正文{source.truncated ? "（部分）" : ""}</summary>
          <p>{source.excerpt}</p>
        </details>}
      </article>;
    })}
    {!focusedUrl && sources.length > maxVisible && <button type="button" className="k-btn" onClick={() => setExpanded(!expanded)}>
      {expanded ? "收起来源" : `展开其余 ${sources.length - maxVisible} 个来源`}
    </button>}
  </div>;
});
