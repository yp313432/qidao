import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

export function PlayHeader({
  title,
  extra,
  backTo = "/play",
  backLabel = "返回玩乐",
}: {
  title: string;
  extra?: ReactNode;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <header className="flex items-center gap-1 px-2 pt-[max(0.6rem,env(safe-area-inset-top))] pb-1">
      <Link to={backTo} aria-label={backLabel} className="flex size-11 items-center justify-center">
        <ChevronLeft className="size-6" strokeWidth={1.6} />
      </Link>
      <h1 className="flex-1 font-serif text-lg font-medium">{title}</h1>
      {extra}
    </header>
  );
}
