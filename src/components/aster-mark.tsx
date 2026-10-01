import { cn } from "@/lib/utils";

export function AsterMark({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={cn("text-accent", className)}
      aria-hidden="true"
    >
      <g fill="currentColor">
        <rect x="30" y="6" width="4" height="22" rx="2" />
        <rect x="30" y="36" width="4" height="22" rx="2" />
        <rect x="6" y="30" width="22" height="4" rx="2" />
        <rect x="36" y="30" width="22" height="4" rx="2" />
        <rect x="14.2" y="30" width="22" height="4" rx="2" transform="rotate(-45 14.2 30)" />
        <rect x="30" y="14.2" width="22" height="4" rx="2" transform="rotate(45 30 14.2)" />
        <rect x="19.5" y="19.5" width="18" height="3.4" rx="1.7" transform="rotate(-45 19.5 19.5)" />
        <rect x="32.2" y="19.5" width="18" height="3.4" rx="1.7" transform="rotate(45 32.2 19.5)" />
      </g>
    </svg>
  );
}
