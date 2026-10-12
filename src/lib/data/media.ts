/**
 * **媒体资产的统一入口**（PH4）—— 音乐与照片的唯一访问门。
 *
 * 按用户拍板的 D1（`qidao-docs/数据架构-①设计.md`）：
 *   **存储位置不搬**（`qidao-music` / `qidao-play-photos` 各自还是独立小库 ——
 *   它们本来就是"一条音频一个 Blob"的正确形状，搬家只有风险没有收益），
 *   但**访问收口到这一处**：别的文件不许再直接 `import "@/lib/music-db"`。
 *
 * 为什么这一步重要（用户原话）："不能哪里出问题再补哪一块了，拆东补西。"
 * 存储位置散着的时候，"音乐为什么没了"这种问题要在 N 个文件里找；收口之后只有一个地方要看。
 *
 * ⚠️ 本文件**只做转发**，不改行为（PH4 的纪律：一次搬一个、每搬一个不改行为）。
 */
export {
  isPersistent as musicIsPersistent,
  /** 兼容旧名字：调用方（player.ts）原来直接引 `isPersistent` */
  isPersistent,
  listTracks,
  putTrack,
  deleteTrack,
  saveLyrics,
  type LyricsSource,
  type MusicTrack,
} from "@/lib/music-db";
export {
  isPersistent as photosArePersistent,
  listPhotos,
  putPhoto,
  deletePhoto,
  makePhoto,
  type PlayPhoto,
} from "@/lib/play-photos-db";
