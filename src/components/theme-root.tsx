import { useEffect } from "react";
import { applyAppearance, applyTheme, useApp } from "@/lib/store";

export function ThemeRoot({ children }: { children: React.ReactNode }) {
  const settings = useApp((s) => s.settings);
  const hydrated = useApp((s) => s.hydrated);
  const setHydrated = useApp((s) => s.setHydrated);

  useEffect(() => {
    const apply = () => {
      const current = useApp.getState().settings;
      applyTheme(current.theme);
      applyAppearance(current);
    };
    const unsub = useApp.persist.onFinishHydration(() => {
      setHydrated(true);
      apply();
    });
    if (useApp.persist.hasHydrated()) {
      setHydrated(true);
      apply();
    }
    return unsub;
  }, [setHydrated]);

  useEffect(() => {
    if (hydrated) {
      applyTheme(settings.theme);
      applyAppearance(settings);
    }
  }, [settings, hydrated]);

  // 启动时按保留策略清一次思考档案（0 表示永久保留，不动）
  useEffect(() => {
    if (!hydrated) return;
    const days = useApp.getState().settings.thinkingKeepDays;
    if (days > 0) useApp.getState().pruneThinking(days);
  }, [hydrated]);

  return <>{children}</>;
}