import { PageHeader } from "@/components/shared/page-header";
import { BUILD_TAG } from "@/lib/branding";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import type { MeTab } from "./me-types";
import { MeSections } from "./me-sections";

/**
 * 第二层页面外壳：左上角返回 + 标题 + 可滚动内容区。
 * /space · /usage · /data · /system 四个路由共用一个外壳，内容由 MeSections 按 tab 给。
 */

/* ───────────────────────── 第二层：四组区块 ───────────────────────── */

/** 第二层页面共用外壳：左上角返回 + 标题 + 可滚动内容区。 */
export function MePage({ tab, title, subtitle }: { tab: MeTab; title: string; subtitle: string }) {
  // 报给 AI「我在看什么」（跟其它二级页一样），纯 UI 迁移顺手补上
  useActivity(`在看${title}`);
  const scrollRef = useScrollMemory(`me-${tab}`);

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <PageHeader title={title} description={subtitle} />

      <MeSections tab={tab} />

      <div className="px-5 py-8 text-center text-[12px] text-subtle">
        栖岛 · 思考链保存在这台设备 · {BUILD_TAG}
      </div>
    </div>
  );
}
