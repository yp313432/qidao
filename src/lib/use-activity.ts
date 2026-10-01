import { useEffect } from "react";
import { useApp } from "@/lib/store";

/**
 * 上报「我在干什么」。
 *
 * 这就是「他知道我在听歌 / 在玩五子棋」的落地方式：每个页面在自己的
 * 关键状态变化时调一次，信息进本地 store，发消息时随请求带上去。
 * 目前「知道我在干什么」默认是放开的（只读、不改变任何东西）。
 */
export function useActivity(label: string, detail = "") {
  const setActivity = useApp((s) => s.setActivity);
  useEffect(() => {
    const path = typeof window === "undefined" ? "" : window.location.pathname;
    setActivity({ label, detail, path });
  }, [label, detail, setActivity]);
}
