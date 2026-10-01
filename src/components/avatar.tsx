import { AsterMark } from "@/components/aster-mark";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * 圆形头像。
 *
 * AI 与我各自可以上传头像（存本地）；没上传时 AI 用星芒标识、我用名字首字。
 * 只要在「我的 → 形象」里换一次，全站所有出现头像的地方都会跟着变。
 */
export function Avatar({
  role,
  size = 32,
  className,
}: {
  role: "ai" | "user";
  size?: number;
  className?: string;
}) {
  const settings = useApp((s) => s.settings);
  const src = role === "ai" ? settings.aiAvatar : settings.userAvatar;
  const initial = (settings.displayName || "Y").trim().slice(0, 1).toUpperCase() || "Y";

  return (
    <span
      className={cn(
        "flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-line bg-chip",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : role === "ai" ? (
        <AsterMark size={Math.round(size * 0.6)} />
      ) : (
        <span className="text-[13px] font-medium text-fg">{initial}</span>
      )}
    </span>
  );
}
