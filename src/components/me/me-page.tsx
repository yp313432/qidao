import { PageHeader } from "@/components/shared/page-header";
import { APP_NAME, BUILD_TAG } from "@/lib/branding";
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

      {/* 二级页统一左右留白：所有设置页都走这一个外壳（用户 m04469 第 3 条：
          「从对话往后 push 出来的二级页直接贴到两侧，跟外观那种离边有距离的不一致」）。
          内层页面自己别再套 `k-page`，否则会双份 16px。 */}
      <div className="k-page">
        <MeSections tab={tab} />
      </div>

      <div className="px-5 py-8 text-center text-[12px] text-subtle">
        {APP_NAME} · 思考链保存在这台设备 · {BUILD_TAG}
      </div>
    </div>
  );
}
