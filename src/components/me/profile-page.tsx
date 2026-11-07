import { useApp } from "@/lib/store";
import { BUILD_TAG } from "@/lib/branding";
import { useActivity } from "@/lib/use-activity";
import { useScrollMemory } from "@/lib/ux";
import { PageHeader } from "@/components/shared/page-header";
import { DateTimeField } from "@/components/ui/datetime-picker";
import { KButton, KFold } from "@/components/ui-kit";

/**
 * 账号与资料（`/profile`）。
 *
 * ── 2026-11-07 用户 m03042 回头砍掉了一大半 ──────────────────
 * 原话："我的设置区里第一个账号与资料点进去是头像、名字修改、还有他对我的性别称呼，
 *        这几个完全都是小图标。咱们在我的那个首页那个大卡片里面就直接可以设置了，
 *        就不用单列出来，这就是繁琐之一。…所以第一个账号与资料修完之后，
 *        就只剩一个认识的日子了。"
 *
 * 所以头像、名字、称呼三件事都搬回首页大卡片（点名字改名、名字后面那颗符号换称呼），
 * 这一页**只剩「认识的日子」**。以后要加资料项就往这里加，别再拆一页出去。
 *
 * 另外：原来头像/名字/称呼用了 k-card + 一堆行，现在整页一张卡都不到，
 * 就一张折叠卡 —— 页面短了，反而更好找。
 */
export function ProfilePage() {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const scrollRef = useScrollMemory("me-profile");
  useActivity("在看账号与资料");

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-above-nav">
      <PageHeader title="账号与资料" description="目前只有「认识的日子」" />

      <div className="k-page k-list">
        <KFold
          title="认识的日子"
          meta={
            settings.togetherSince
              ? new Date(settings.togetherSince).toLocaleDateString("zh-CN")
              : "还没设"
          }
          defaultOpen
        >
          <DateTimeField
            mode="date"
            value={settings.togetherSince ?? ""}
            onChange={(v) => patch({ togetherSince: v })}
            label="认识的日子"
          />
          <p className="k-hint">设了之后他会记得你们认识多久，偶尔提一句「第几天」。</p>
          {settings.togetherSince ? (
            <KButton
              variant="dashed"
              className="k-btn--block"
              onClick={() => patch({ togetherSince: "" })}
            >
              清掉这个日子
            </KButton>
          ) : null}
        </KFold>
      </div>

      <div className="px-5 py-8 text-center text-[12px] text-subtle">
        栖岛 · 思考链保存在这台设备 · {BUILD_TAG}
      </div>
    </div>
  );
}
