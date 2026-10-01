import { createFileRoute } from "@tanstack/react-router";

/**
 * 自动找歌词：走 LRCLIB（https://lrclib.net）。
 *
 * 为什么用它：它是**开源、免费、公开给程序调用**的歌词库，不需要密钥，
 * 也能给出**逐行时间轴**（syncedLyrics），所以找回来的歌词会跟着滚。
 *
 * 为什么放在服务端而不是浏览器里直接调：省得赌对方的 CORS 设置；
 * 顺带能统一超时和报错。代价是这条路依赖服务端（静态化的 APK 里会失效）。
 *
 * 已知：这个公共实例**会过载**，忙的时候回 503 —— 那种情况要如实告诉用户稍后再试，
 * 而不是假装"没这首歌"。
 */

const UA = "qidao-personal-app/1.0 (lyrics lookup)";

type Hit = {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

async function lrclib(path: string): Promise<Response> {
  return fetch(`https://lrclib.net${path}`, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(9000),
  });
}

/** 从搜索结果里挑一条：优先有逐行时间轴的，其次时长最接近的。 */
function pick(list: Hit[], seconds: number): Hit | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const synced = list.filter((h) => (h.syncedLyrics ?? "").trim().length > 0);
  const pool = synced.length ? synced : list.filter((h) => (h.plainLyrics ?? "").trim().length > 0);
  if (pool.length === 0) return null;
  if (!seconds) return pool[0]!;
  return pool.reduce((best, h) =>
    Math.abs((h.duration ?? 0) - seconds) < Math.abs((best.duration ?? 0) - seconds) ? h : best,
  );
}

function respond(hit: Hit) {
  return Response.json({
    ok: true,
    title: hit.trackName,
    artist: hit.artistName,
    album: hit.albumName ?? "",
    synced: hit.syncedLyrics ?? "",
    plain: hit.plainLyrics ?? "",
    source: "lrclib",
  });
}

export const Route = createFileRoute("/api/lyrics")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        const raw = (u.searchParams.get("q") ?? "").trim();
        const seconds = Number(u.searchParams.get("duration") ?? "0") || 0;
        if (!raw) return Response.json({ ok: false, message: "没给歌名" });

        // 文件名常见两类：「歌手 - 歌名」和「歌名 - 歌手」，两种都试
        const pairs: { artist: string; track: string }[] = [];
        const dash = raw.split(/\s+[-–—]\s+/);
        if (dash.length === 2) {
          pairs.push({ artist: dash[0]!.trim(), track: dash[1]!.trim() });
          pairs.push({ artist: dash[1]!.trim(), track: dash[0]!.trim() });
        }

        const queries: string[] = [];
        for (const p of pairs) {
          if (!p.artist || !p.track) continue;
          queries.push(
            `/api/search?track_name=${encodeURIComponent(p.track)}&artist_name=${encodeURIComponent(p.artist)}`,
          );
        }
        queries.push(`/api/search?q=${encodeURIComponent(raw)}`);
        // 去掉括号里的补充说明（「（荣耀全球品牌主题曲）」这种）再搜一次
        const simplified = raw.replace(/[（(【\[].*?[)）】\]]/g, " ").replace(/\s+/g, " ").trim();
        if (simplified && simplified !== raw) {
          queries.push(`/api/search?q=${encodeURIComponent(simplified)}`);
        }

        let busy = false;
        for (const path of queries) {
          try {
            const r = await lrclib(path);
            if (r.status === 503) {
              busy = true;
              continue;
            }
            if (r.status === 404) continue;
            if (!r.ok) continue;
            const data = (await r.json()) as Hit[] | Hit;
            const hit = Array.isArray(data) ? pick(data, seconds) : data;
            if (hit && ((hit.syncedLyrics ?? "").trim() || (hit.plainLyrics ?? "").trim())) {
              return respond(hit);
            }
          } catch {
            /* 单条查询失败就试下一条 */
          }
        }

        return Response.json({
          ok: false,
          busy,
          message: busy
            ? "歌词库现在繁忙（它是个免费公共服务），稍后再试一次。"
            : "歌词库里没有匹配的这首歌 —— 可以手动粘贴。",
        });
      },
    },
  },
});
