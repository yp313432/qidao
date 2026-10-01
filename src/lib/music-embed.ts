import { uid } from "@/lib/utils";
import type { MusicEmbed } from "@/lib/types";

/**
 * 外链歌单：把你从各个音乐 App 复制的分享链接，换成**官方的外链播放器地址**。
 *
 * 这里**只做官方嵌入**，不去抓音频直链 —— 抓直链等于绕过对方的播放器、
 * 广告和会员限制，属于违规而且随时会失效。官方嵌入是对方主动给网站用的。
 *
 * 已知限制（写在这里免得日后忘了）：
 *  · 会员/付费歌在官方播放器里只能试听约 1 分钟；
 *  · 网易云的外链播放器很久没维护了，手机上有可能显示不出来 —— 优先用 QQ音乐；
 *  · 手机上对方页面可能自己弹「打开 App」，那不是我们能控制的。
 */

export const SERVICE_LABEL = {
  netease: "网易云音乐",
  qq: "QQ音乐",
  spotify: "Spotify",
} as const;

export type ParseResult =
  | { ok: true; embed: MusicEmbed }
  | { ok: false; message: string };

const KIND_LABEL: Record<string, string> = {
  song: "单曲",
  playlist: "歌单",
  album: "专辑",
  radio: "电台",
  artist: "歌手",
};

function digits(s: string | null | undefined): string | null {
  const m = (s ?? "").match(/\d{3,}/);
  return m ? m[0] : null;
}

/** 网易云：outchain 的 type —— 1 专辑 / 2 单曲 / 3 歌单 / 4 电台 */
const NETEASE_TYPE: Record<string, number> = {
  album: 1,
  song: 2,
  playlist: 3,
  radio: 4,
};

/** Spotify 的链接里叫 track，我们内部统一叫 song */
const SP_KIND: Record<string, MusicEmbed["kind"]> = {
  track: "song",
  album: "album",
  playlist: "playlist",
  artist: "artist",
};

export function parseMusicLink(raw: string): ParseResult {
  const input = raw.trim();
  if (!input) return { ok: false, message: "先粘贴一个链接" };

  /* ---------------- Spotify ---------------- */
  const spUri = input.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)$/);
  if (spUri) {
    return {
      ok: true,
      embed: build("spotify", SP_KIND[spUri[1]!] ?? "song", spUri[2]!, input),
    };
  }
  if (/open\.spotify\.com/i.test(input)) {
    const m = input.match(/open\.spotify\.com\/(?:embed\/)?(track|album|playlist|artist)\/([A-Za-z0-9]+)/i);
    if (!m) {
      return { ok: false, message: "这是 Spotify 链接，但没认出是单曲 / 专辑 / 歌单 / 歌手。" };
    }
    return {
      ok: true,
      embed: build("spotify", SP_KIND[m[1]!.toLowerCase()] ?? "song", m[2]!, input),
    };
  }

  /* ---------------- 网易云 ---------------- */
  if (/music\.163\.com|163cn\.tv|y\.music\.163\.com/i.test(input)) {
    const q = (name: string) => {
      const m = input.match(new RegExp(`[?&#/]${name}=?(\\d{3,})`, "i"));
      return m ? m[1]! : null;
    };
    // 形如 /song?id=123、/#/playlist?id=456、/song/123
    let kind: MusicEmbed["kind"] = "song";
    if (/playlist/i.test(input)) kind = "playlist";
    else if (/album/i.test(input)) kind = "album";
    else if (/dj|radio|program/i.test(input)) kind = "radio";

    const id =
      q("id") ??
      digits(input.match(/\/(?:song|playlist|album|program)\/(\d{3,})/)?.[1]) ??
      digits(input.match(/(\d{6,})/)?.[1]);
    if (!id) {
      return {
        ok: false,
        message: "这是网易云链接，但里面没有歌曲/歌单 ID。请在网页版点「分享 → 复制链接」再粘过来。",
      };
    }
    return { ok: true, embed: build("netease", kind, id, input) };
  }

  /* ---------------- QQ音乐 ---------------- */
  if (/y\.qq\.com|qq\.com\/n\/ryqq|i\.y\.qq\.com/i.test(input)) {
    const songId = input.match(/songid=(\d{3,})/i)?.[1] ?? input.match(/songDetail\/(\d{3,})/i)?.[1];
    if (!songId) {
      if (/fcgi-bin\/u/i.test(input)) {
        return {
          ok: false,
          message:
            "这是 QQ音乐的短链（c6.y.qq.com/base/fcgi-bin/u?...），短链要在它服务器上才能展开，我这边解不开。请在 PC 网页版的歌曲页点「更多 → 分享 → 复制链接」，或者在手机浏览器里打开那个短链、切成桌面版再复制一次。",
        };
      }
      return { ok: false, message: "这是 QQ音乐链接，但没找到 songid。" };
    }
    return { ok: true, embed: build("qq", "song", songId, input) };
  }

  /* ---------------- 认不出来 ---------------- */
  return {
    ok: false,
    message:
      "没认出这是哪家的链接。目前支持：网易云（music.163.com）、QQ音乐（y.qq.com / i.y.qq.com）、Spotify（open.spotify.com）。",
  };
}

function build(
  service: MusicEmbed["service"],
  kind: MusicEmbed["kind"],
  sourceId: string,
  sourceUrl: string,
): MusicEmbed {
  let embedUrl = "";
  let height = 66;

  if (service === "netease") {
    const type = NETEASE_TYPE[kind] ?? 2;
    // 它自己的单曲播放器是固定 66px 高，留太多会露一条白边
    height = type === 2 ? 74 : 430;
    embedUrl = `https://music.163.com/outchain/player?type=${type}&id=${sourceId}&auto=0&height=${Math.max(0, height - 8)}`;
  } else if (service === "qq") {
    // 官方地址；它这个播放器会跟着宽度自适应，80 刚好不露白边
    height = 80;
    embedUrl = `https://i.y.qq.com/n2/m/outchain/player/index.html?songid=${sourceId}&songtype=0`;
  } else {
    height = kind === "song" ? 152 : kind === "album" ? 352 : 380;
    // 内部统一叫 song，但 Spotify 的地址路径用的是 track —— 别把内部命名漏到 URL 上
    const path = kind === "song" ? "track" : kind;
    embedUrl = `https://open.spotify.com/embed/${path}/${sourceId}`;
  }

  return {
    id: uid("emb"),
    service,
    serviceLabel: SERVICE_LABEL[service],
    kind,
    sourceId,
    embedUrl,
    height,
    sourceUrl,
    addedAt: Date.now(),
  };
}

export function kindLabel(kind: MusicEmbed["kind"]): string {
  return KIND_LABEL[kind] ?? "链接";
}

/**
 * 播放器该留多高。
 *
 * **故意不读数据里存的 height** —— 那样我以后调好了尺寸，已经加过的链接还是旧高度。
 * 按「服务 + 类型」现算，改进立刻对全部链接生效。
 */
export function embedHeight(service: MusicEmbed["service"], kind: MusicEmbed["kind"]): number {
  if (service === "qq") return 80;
  if (service === "netease") return kind === "song" ? 74 : 430;
  return kind === "song" ? 152 : kind === "album" ? 352 : 380;
}
