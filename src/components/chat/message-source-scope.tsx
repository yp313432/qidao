import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { WebSourcesContext } from "@/components/chat/web-sources-context";
import { SourcesSheet } from "@/components/chat/sources-sheet";
import { messageWebSources } from "@/lib/web-sources";
import type { ChatMessage } from "@/lib/types";

export function MessageSourceScope({ message, children }: { message: ChatMessage; children: ReactNode }) {
  const sources = useMemo(() => messageWebSources(message), [message]);
  const [focusedUrl, setFocusedUrl] = useState<string | null>(null);
  const onSelect = useCallback((url: string) => setFocusedUrl(url), []);
  const context = useMemo(() => ({ sources, onSelect }), [sources, onSelect]);
  return <WebSourcesContext.Provider value={context}>
    <div className="w-full min-w-0">
      {children}
      {sources.length > 0 && <button type="button" className="k-source-entry" onClick={() => setFocusedUrl("")}>
        <ExternalLink aria-hidden="true" />查看来源 · {sources.length}
      </button>}
      {focusedUrl !== null && <SourcesSheet sources={sources} focusedUrl={focusedUrl || undefined} onClose={() => setFocusedUrl(null)} />}
    </div>
  </WebSourcesContext.Provider>;
}
