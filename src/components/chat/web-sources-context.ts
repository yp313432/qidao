import { createContext } from "react";
import type { WebSource } from "@/lib/web-sources";

export type WebSourcesContextValue = { sources: WebSource[]; onSelect: (url: string) => void };
export const WebSourcesContext = createContext<WebSourcesContextValue | null>(null);
