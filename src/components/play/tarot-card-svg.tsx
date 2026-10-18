import { useId } from "react";
import { romanOf, type DrawnCard, type TarotCard } from "@/lib/tarot";

/**
 * 塔罗牌面（纯 SVG 画出来的）。
 *
 * 风格照用户 m06018 定的"意式罗马"：羊皮纸底 + 双层金线 + 拱形壁龛，
 * 里面是单色剪影/线条的象征物，底下一行中文 + 一行意大利语斜体。
 * 大阿卡纳 22 张各有自己的图形，小阿卡纳用花色 + 点数排布。
 *
 * 为什么不用图片：78 张手绘不现实，矢量图能跟着卡片尺寸缩放、逆位直接转 180°。
 */

const INK = "#4a3020";
const GOLD = "#b08a45";
const GOLD_DEEP = "#8d6b2c";
const PAPER = "#fcf4e1";
const PAPER_DEEP = "#e9d5ae";

/** 拱形壁龛的路径（220×360 的卡片里） */
const NICHE = "M34 306 L34 132 A76 76 0 0 1 186 132 L186 306 Z";

function pennant(x: number, y: number, dir: 1 | -1) {
  return (
    <path
      d={`M${x} ${y} l${dir * 18} 6 l${-dir * 18} 7 z`}
      fill={INK}
      opacity={0.75}
    />
  );
}

/* ────────────────────────── 大阿卡纳的图形 ────────────────────────── */

function majorEmblem(rank: number) {
  switch (rank) {
    case 0: // 愚者：太阳 + 悬崖 + 挑着行囊的杖
      return (
        <>
          <circle r="20" fill="none" stroke={GOLD_DEEP} strokeWidth="1.2" />
          {Array.from({ length: 12 }).map((_, i) => (
            <line
              key={i}
              x1={Math.sin((i * Math.PI) / 6) * 24}
              y1={-Math.cos((i * Math.PI) / 6) * 24}
              x2={Math.sin((i * Math.PI) / 6) * 32}
              y2={-Math.cos((i * Math.PI) / 6) * 32}
              stroke={GOLD_DEEP}
              strokeWidth="1.1"
            />
          ))}
          <path d="M-58 44 L-14 44 L4 52 L58 52" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M22 44 L22 -20" stroke={INK} strokeWidth="1.8" />
          <path d="M22 -20 C10 -28 -6 -26 -14 -18" fill="none" stroke={INK} strokeWidth="1.5" />
          <path d="M-16 -16 C-24 -12 -24 -2 -16 2 C-14 -6 -10 -12 -4 -14 Z" fill={INK} />
          <circle cx="42" cy="30" r="4" fill={INK} />
          <path d="M30 34 q8 -6 16 0" fill="none" stroke={INK} strokeWidth="1.2" />
        </>
      );
    case 1: // 魔术师：杖、杯、币 + 无限符号
      return (
        <>
          <path
            d="M-24 -44 C-24 -54 -10 -54 -10 -44 C-10 -34 -24 -34 -24 -24 C-24 -14 -10 -14 -10 -24"
            fill="none"
            stroke={GOLD_DEEP}
            strokeWidth="1.8"
          />
          <path d="M-46 46 L46 46" stroke={INK} strokeWidth="2" />
          <path d="M-30 46 L-30 -6" stroke={INK} strokeWidth="2" />
          <path d="M-30 -6 l-6 -8 M-30 -6 l6 -8" stroke={INK} strokeWidth="1.6" />
          <path d="M2 20 h20 l-2 10 h-16 z" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M6 20 v-8 h12 v8" fill="none" stroke={INK} strokeWidth="1.3" />
          <circle cx="30" cy="34" r="7" fill="none" stroke={GOLD_DEEP} strokeWidth="1.3" />
          <path d="M30 27 v14 M23 34 h14" stroke={GOLD_DEEP} strokeWidth="0.9" />
        </>
      );
    case 2: // 女祭司：两根柱子 + 月牙 + 书
      return (
        <>
          <path d="M-52 52 L-52 -40 M52 52 L52 -40" stroke={INK} strokeWidth="2.4" />
          <path d="M-60 -40 h16 M44 -40 h16" stroke={INK} strokeWidth="2.4" />
          <path
            d="M-2 -56 C8 -46 8 -34 -2 -26 C-12 -34 -12 -46 -2 -56 Z"
            fill="none"
            stroke={GOLD_DEEP}
            strokeWidth="1.4"
          />
          <path d="M-24 24 h48 v18 h-48 z" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M-24 32 h48" stroke={GOLD_DEEP} strokeWidth="0.9" />
          <circle cx="0" cy="45" r="3" fill={GOLD_DEEP} />
        </>
      );
    case 3: // 皇后：麦穗 + 星冠 + 心
      return (
        <>
          {[-1, 1].map((s) => (
            <path
              key={s}
              d={`M${s * 26} 52 C${s * 26} 18 ${s * 34} -6 ${s * 30} -34`}
              fill="none"
              stroke={INK}
              strokeWidth="1.8"
            />
          ))}
          {[-1, 1].map((s) =>
            [0, 1, 2].map((i) => (
              <ellipse
                key={`${s}-${i}`}
                cx={s * (26 + i * 4)}
                cy={38 - i * 20}
                rx="4"
                ry="8"
                transform={`rotate(${s * 22} ${s * (26 + i * 4)} ${38 - i * 20})`}
                fill={GOLD}
                opacity={0.6}
              />
            )),
          )}
          <path d="M0 -30 l5 10 h10 l-8 7 4 11 -11 -7 -11 7 4 -11 -8 -7 h10 z" fill={GOLD_DEEP} />
          <path
            d="M0 6 C-10 0 -18 6 -18 14 C-18 24 -8 30 0 36 C8 30 18 24 18 14 C18 6 10 0 0 6 Z"
            fill="none"
            stroke={INK}
            strokeWidth="1.6"
          />
        </>
      );
    case 4: // 皇帝：王座 + 羊角 + 剑
      return (
        <>
          <path d="M-34 52 L-34 -18 L34 -18 L34 52" fill="none" stroke={INK} strokeWidth="2" />
          <path d="M-34 -18 C-46 -26 -46 -40 -34 -44 C-30 -34 -26 -26 -22 -22" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M34 -18 C46 -26 46 -40 34 -44 C30 -34 26 -26 22 -22" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M0 -50 L0 30" stroke={INK} strokeWidth="2.4" />
          <path d="M-6 -50 h12 l-6 -8 z" fill={INK} />
          <path d="M-10 24 h20" stroke={INK} strokeWidth="2" />
          <circle cx="0" cy="0" r="10" fill="none" stroke={GOLD_DEEP} strokeWidth="1.2" />
          <circle cx="0" cy="0" r="3" fill={GOLD_DEEP} />
        </>
      );
    case 5: // 教皇：三重十字 + 两把钥匙
      return (
        <>
          <path d="M0 -50 L0 46" stroke={INK} strokeWidth="2.4" />
          {[-26, -10, 6].map((y, i) => (
            <path key={i} d={`M${-16 + i * 2} ${y} h${32 - i * 4}`} stroke={INK} strokeWidth="2" />
          ))}
          <circle cx="0" cy="-56" r="4" fill={INK} />
          {[-1, 1].map((s) => (
            <g key={s} transform={`translate(${s * 28} 30) rotate(${s * 30})`}>
              <circle r="5" fill="none" stroke={GOLD_DEEP} strokeWidth="1.4" />
              <path d="M0 5 v18" stroke={GOLD_DEEP} strokeWidth="1.2" />
              <path d="M-4 16 h8" stroke={GOLD_DEEP} strokeWidth="1.1" />
            </g>
          ))}
        </>
      );
    case 6: // 恋人：两个交叠的环 + 上方的太阳
      return (
        <>
          <circle cx="-16" cy="10" r="26" fill="none" stroke={INK} strokeWidth="1.6" />
          <circle cx="16" cy="10" r="26" fill="none" stroke={INK} strokeWidth="1.6" />
          <circle r="14" fill={GOLD} opacity={0.35} stroke={GOLD_DEEP} strokeWidth="1.2" />
          {Array.from({ length: 8 }).map((_, i) => (
            <line
              key={i}
              x1={Math.sin((i * Math.PI) / 4) * 18}
              y1={-Math.cos((i * Math.PI) / 4) * 18}
              x2={Math.sin((i * Math.PI) / 4) * 24}
              y2={-Math.cos((i * Math.PI) / 4) * 24}
              stroke={GOLD_DEEP}
              strokeWidth="1"
            />
          ))}
          <path d="M-40 46 h80" stroke={INK} strokeWidth="1.6" />
        </>
      );
    case 7: // 战车：车体 + 两个轮 + 星幕
      return (
        <>
          <path d="M-34 -6 h68 v30 h-68 z" fill="none" stroke={INK} strokeWidth="1.8" />
          <path d="M-40 -14 h80" stroke={INK} strokeWidth="2" />
          <circle cx="-20" cy="34" r="11" fill="none" stroke={INK} strokeWidth="1.6" />
          <circle cx="20" cy="34" r="11" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M-20 23 v22 M-31 34 h22" stroke={GOLD_DEEP} strokeWidth="0.9" />
          <path d="M20 23 v22 M9 34 h22" stroke={GOLD_DEEP} strokeWidth="0.9" />
          {[-26, 0, 26].map((x, i) => (
            <path key={i} d={`M${x} -30 l4 8 l-8 0 z`} fill={GOLD_DEEP} />
          ))}
          <path d="M-32 -40 h64" stroke={GOLD_DEEP} strokeWidth="1" />
        </>
      );
    case 8: // 力量：狮首 + 无限
      return (
        <>
          <path
            d="M-20 -46 C-20 -54 -6 -54 -6 -46 C-6 -38 -20 -38 -20 -30 C-20 -22 -6 -22 -6 -30"
            fill="none"
            stroke={GOLD_DEEP}
            strokeWidth="1.8"
          />
          <circle cx="0" cy="14" r="26" fill="none" stroke={INK} strokeWidth="1.8" />
          {Array.from({ length: 14 }).map((_, i) => (
            <path
              key={i}
              d="M0 -14 C6 -12 8 -6 6 0"
              transform={`translate(0 14) rotate(${i * (360 / 14)}) translate(0 -26)`}
              fill="none"
              stroke={GOLD_DEEP}
              strokeWidth="1"
            />
          ))}
          <circle cx="-9" cy="10" r="2.4" fill={INK} />
          <circle cx="9" cy="10" r="2.4" fill={INK} />
          <path d="M-6 22 h12 l-6 6 z" fill={INK} />
        </>
      );
    case 9: // 隐士：提灯（里面一颗星）+ 杖
      return (
        <>
          <path d="M-34 52 L-34 -30" stroke={INK} strokeWidth="2" />
          <path d="M-14 4 h28 v22 h-28 z" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M-14 4 L0 -10 L14 4" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M0 -4 l3 6 h7 l-6 4 3 7 -7 -4 -7 4 3 -7 -6 -4 h7 z" fill={GOLD_DEEP} />
          <path d="M-4 26 v6 M4 26 v6" stroke={INK} strokeWidth="1.4" />
          <path d="M-30 -30 C-24 -40 -16 -40 -10 -32" fill="none" stroke={INK} strokeWidth="1.4" />
        </>
      );
    case 10: // 命运之轮：大轮 + 四角小轮
      return (
        <>
          <circle r="34" fill="none" stroke={INK} strokeWidth="2" />
          <circle r="24" fill="none" stroke={GOLD_DEEP} strokeWidth="1.1" />
          <circle r="26" fill="none" stroke={GOLD_DEEP} strokeWidth="1.1" />
          {Array.from({ length: 8 }).map((_, i) => (
            <line
              key={i}
              x1={Math.sin((i * Math.PI) / 4) * 8}
              y1={-Math.cos((i * Math.PI) / 4) * 8}
              x2={Math.sin((i * Math.PI) / 4) * 32}
              y2={-Math.cos((i * Math.PI) / 4) * 32}
              stroke={GOLD_DEEP}
              strokeWidth="1.1"
            />
          ))}
          <circle r="5" fill={GOLD_DEEP} />
          {[
            [-40, -46],
            [40, -46],
            [-40, 46],
            [40, 46],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="5" fill="none" stroke={INK} strokeWidth="1.1" />
          ))}
        </>
      );
    case 11: // 正义：天平 + 竖剑
      return (
        <>
          <path d="M0 -52 L0 34" stroke={INK} strokeWidth="2.4" />
          <path d="M-40 -18 H40" stroke={INK} strokeWidth="2" />
          <path d="M-30 -18 l-8 16 h16 z" fill="none" stroke={INK} strokeWidth="1.5" />
          <path d="M30 -18 l-8 16 h16 z" fill="none" stroke={INK} strokeWidth="1.5" />
          <path d="M-6 -50 h12 l-6 -8 z" fill={INK} />
          <path d="M-8 34 h16" stroke={INK} strokeWidth="2" />
          <circle cx="0" cy="0" r="4" fill={GOLD_DEEP} />
        </>
      );
    case 12: // 倒吊人：倒三角 + 绳
      return (
        <>
          <path d="M-44 -46 H44 L0 46 Z" fill="none" stroke={INK} strokeWidth="1.8" />
          <path d="M0 -46 v-8" stroke={INK} strokeWidth="1.6" />
          <circle cx="0" cy="-58" r="5" fill="none" stroke={GOLD_DEEP} strokeWidth="1.2" />
          <path d="M-16 10 h32" stroke={GOLD_DEEP} strokeWidth="1.2" />
          {pennant(-44, -46, 1)}
          {pennant(44, -46, -1)}
        </>
      );
    case 13: // 死神：镰刀 + 沙漏 + 柏树
      return (
        <>
          <path d="M-30 52 L-26 -30" stroke={INK} strokeWidth="2.2" />
          <path d="M-26 -30 C-42 -36 -56 -28 -60 -14 C-46 -18 -34 -22 -26 -30 Z" fill={INK} opacity={0.85} />
          <path d="M-26 -28 C-18 -36 -6 -38 2 -34" fill="none" stroke={INK} strokeWidth="1.2" />
          <path d="M18 30 h20 v10 h-20 z M18 46 h20" fill="none" stroke={INK} strokeWidth="1.4" />
          <path d="M18 30 l20 10 M38 30 l-20 10" stroke={GOLD_DEEP} strokeWidth="0.9" />
          <path d="M44 -10 v-40 M36 -50 h16" stroke={INK} strokeWidth="1.4" />
        </>
      );
    case 14: // 节制：两只杯子 + 水流
      return (
        <>
          <path d="M-44 -6 h20 l-3 14 h-14 z" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M-38 8 v16 M-30 8 v16" stroke={INK} strokeWidth="1.2" />
          <path d="M24 -12 h20 l-3 14 h-14 z" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M30 2 v16 M38 2 v16" stroke={INK} strokeWidth="1.2" />
          <path
            d="M-24 -14 C-16 -26 0 -20 4 -8 C8 4 16 6 24 0"
            fill="none"
            stroke={GOLD_DEEP}
            strokeWidth="1.6"
            strokeDasharray="3 3"
          />
          <path d="M-44 40 h88" stroke={GOLD_DEEP} strokeWidth="0.9" />
          <circle cx="-4" cy="40" r="6" fill="none" stroke={GOLD_DEEP} strokeWidth="1" />
        </>
      );
    case 15: // 恶魔：羊角 + 倒五角星 + 锁链
      return (
        <>
          <path d="M-24 -40 C-38 -46 -44 -34 -36 -26" fill="none" stroke={INK} strokeWidth="2" />
          <path d="M24 -40 C38 -46 44 -34 36 -26" fill="none" stroke={INK} strokeWidth="2" />
          <path
            d="M0 -26 L10 -2 L34 4 L16 20 L20 44 L0 32 L-20 44 L-16 20 L-34 4 L-10 -2 Z"
            fill="none"
            stroke={INK}
            strokeWidth="1.8"
          />
          <circle r="12" fill="none" stroke={GOLD_DEEP} strokeWidth="1.1" />
          {[-1, 1].map((s) => (
            <g key={s} transform={`translate(${s * 40} 30)`}>
              <ellipse rx="6" ry="9" fill="none" stroke={GOLD_DEEP} strokeWidth="1.2" />
              <ellipse rx="6" ry="9" cy="16" fill="none" stroke={GOLD_DEEP} strokeWidth="1.2" />
            </g>
          ))}
        </>
      );
    case 16: // 塔：塔身 + 闪电 + 掉落的冠
      return (
        <>
          <path d="M-22 52 L-22 -26 h44 v78" fill="none" stroke={INK} strokeWidth="2" />
          <path d="M-22 -26 L-30 -40 H30 L22 -26" fill="none" stroke={INK} strokeWidth="2" />
          <path d="M-8 8 h16 v16 h-16 z" fill="none" stroke={GOLD_DEEP} strokeWidth="1.1" />
          <path d="M28 -46 l-14 22 h10 l-8 18" fill="none" stroke={GOLD_DEEP} strokeWidth="2" />
          <path d="M-38 -40 l-8 -8 l8 -4 l-4 -8" fill="none" stroke={GOLD_DEEP} strokeWidth="1.2" />
          <circle cx="-40" cy="34" r="4" fill={INK} opacity={0.7} />
        </>
      );
    case 17: // 星星：大星 + 七颗小星 + 水面
      return (
        <>
          <path
            d="M0 -56 L8 -20 L44 -20 L15 0 L26 36 L0 16 L-26 36 L-15 0 L-44 -20 L-8 -20 Z"
            fill="none"
            stroke={INK}
            strokeWidth="1.6"
          />
          <circle r="6" fill={GOLD_DEEP} />
          {[
            [-40, -34],
            [40, -30],
            [-32, 12],
            [34, 16],
            [-16, -46],
            [20, -44],
            [0, 44],
          ].map(([x, y], i) => (
            <path
              key={i}
              d={`M${x} ${y - 5} l2 4 h5 l-4 3 1 5 -4 -3 -4 3 1 -5 -4 -3 h5 z`}
              fill={GOLD_DEEP}
              opacity={0.8}
            />
          ))}
          <path d="M-46 52 q14 -8 26 0 q14 8 26 0 q14 -8 26 0" fill="none" stroke={GOLD_DEEP} strokeWidth="1.1" />
        </>
      );
    case 18: // 月亮：月牙 + 双塔 + 落下的水滴
      return (
        <>
          <path
            d="M-6 -54 C18 -46 18 -14 -6 -6 C6 -20 6 -40 -6 -54 Z"
            fill="none"
            stroke={INK}
            strokeWidth="1.8"
          />
          <circle cx="14" cy="-40" r="4" fill={GOLD_DEEP} />
          <path d="M-44 52 L-44 6 h18 v46" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M26 52 L26 6 h18 v46" fill="none" stroke={INK} strokeWidth="1.6" />
          <path d="M-44 6 L-35 -6 L-26 6" fill="none" stroke={INK} strokeWidth="1.4" />
          <path d="M26 6 L35 -6 L44 6" fill="none" stroke={INK} strokeWidth="1.4" />
          {[-24, -8, 8, 24].map((x, i) => (
            <path key={i} d={`M${x} 14 c-4 6 -4 10 0 10 c4 0 4 -4 0 -10 z`} fill={GOLD_DEEP} opacity={0.75} />
          ))}
        </>
      );
    case 19: // 太阳：日轮 + 光 + 墙头的花
      return (
        <>
          <circle r="22" fill={GOLD} opacity={0.3} stroke={GOLD_DEEP} strokeWidth="1.4" />
          {Array.from({ length: 16 }).map((_, i) => (
            <line
              key={i}
              x1={Math.sin((i * Math.PI) / 8) * 26}
              y1={-Math.cos((i * Math.PI) / 8) * 26}
              x2={Math.sin((i * Math.PI) / 8) * (i % 2 ? 36 : 40)}
              y2={-Math.cos((i * Math.PI) / 8) * (i % 2 ? 36 : 40)}
              stroke={i % 2 ? INK : GOLD_DEEP}
              strokeWidth="1.2"
            />
          ))}
          <path d="M-52 46 h104" stroke={INK} strokeWidth="2" />
          {[-36, -12, 12, 36].map((x, i) => (
            <g key={i} transform={`translate(${x} 40)`}>
              <path d="M0 6 v-8" stroke={INK} strokeWidth="1.2" />
              <circle cy="-10" r="4" fill={GOLD_DEEP} opacity={0.8} />
            </g>
          ))}
        </>
      );
    case 20: // 审判：号角 + 旗 + 云
      return (
        <>
          <path d="M-44 -20 C-30 -34 -14 -34 -6 -24" fill="none" stroke={INK} strokeWidth="1.4" />
          <path d="M-8 -24 l34 -14 l6 12 l-34 14 z" fill="none" stroke={INK} strokeWidth="1.8" />
          <path d="M26 -26 l10 -18 l14 10 l-10 18 z" fill={GOLD} opacity={0.5} stroke={GOLD_DEEP} strokeWidth="1.2" />
          <path d="M-6 -10 l4 12 h-8 z" fill={INK} />
          <path d="M-44 40 q10 -10 24 -4 q12 6 22 -2 q10 -8 22 0" fill="none" stroke={GOLD_DEEP} strokeWidth="1.1" />
          <path d="M-20 52 h40" stroke={INK} strokeWidth="1.4" />
        </>
      );
    default: // 21 世界：月桂椭圆 + 四角 + 星
      return (
        <>
          <ellipse rx="40" ry="52" fill="none" stroke={GOLD_DEEP} strokeWidth="1.6" />
          {Array.from({ length: 18 }).map((_, i) => {
            const a = (i * Math.PI * 2) / 18;
            return (
              <ellipse
                key={i}
                cx={Math.cos(a) * 46}
                cy={Math.sin(a) * 58}
                rx="3.4"
                ry="7"
                transform={`rotate(${(i * 360) / 18 + 90} ${Math.cos(a) * 46} ${Math.sin(a) * 58})`}
                fill={GOLD}
                opacity={0.55}
              />
            );
          })}
          <path d="M0 -22 l6 12 h13 l-10 8 4 13 -13 -8 -13 8 4 -13 -10 -8 h13 z" fill={GOLD_DEEP} />
          {[
            [-52, -52],
            [52, -52],
            [-52, 52],
            [52, 52],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="4" fill="none" stroke={GOLD_DEEP} strokeWidth="1.1" />
          ))}
        </>
      );
  }
}

/* ────────────────────────── 小阿卡纳 ────────────────────────── */

function suitGlyph(arcana: TarotCard["arcana"], scale = 1) {
  switch (arcana) {
    case "wands":
      return (
        <g transform={`scale(${scale})`}>
          <path d="M-1.9 -19 L1.9 -19 L2.6 16 L-2.6 16 Z" fill={INK} opacity={0.9} />
          <path d="M-2.2 -6 h4.4 M-2.4 4 h4.8" stroke={GOLD} strokeWidth="1.2" opacity={0.8} />
          <path d="M0 -19 C-5 -23 -9 -21 -10 -17 C-6 -15 -2 -16 0 -19 Z" fill={GOLD} opacity={0.6} />
          <circle cy="-21" r="2.6" fill={GOLD_DEEP} />
        </g>
      );
    case "cups":
      return (
        <g transform={`scale(${scale})`}>
          <path d="M-12 -10 C-12 2 -6 8 0 8 C6 8 12 2 12 -10 Z" fill="none" stroke={INK} strokeWidth="2" />
          <path d="M-12 -10 a12 4.4 0 0 1 24 0" fill={GOLD} opacity={0.32} stroke={GOLD_DEEP} strokeWidth="1.1" />
          <path d="M0 8 v9" stroke={INK} strokeWidth="2" />
          <path d="M-7 18 q7 3.4 14 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case "swords":
      return (
        <g transform={`scale(${scale})`}>
          <path d="M0 -20 L4 8 H-4 Z" fill={INK} opacity={0.85} />
          <path d="M-10 8 H10" stroke={INK} strokeWidth="2" />
          <path d="M0 8 v10" stroke={INK} strokeWidth="2" />
          <circle cy="20" r="2.6" fill={GOLD_DEEP} />
        </g>
      );
    default:
      return (
        <g transform={`scale(${scale})`}>
          <circle r="14" fill={GOLD} opacity={0.3} stroke={GOLD_DEEP} strokeWidth="1.6" />
          <path
            d="M0 -9 L2.6 -2.8 L9 -2.8 L4 1.4 L5.6 7.6 L0 4 L-5.6 7.6 L-4 1.4 L-9 -2.8 L-2.6 -2.8 Z"
            fill={GOLD_DEEP}
            opacity={0.85}
          />
        </g>
      );
  }
}

/** 点数排布：用 -1..1 的归一化坐标，最后乘 30 */
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-0.5, -0.55], [0.5, 0.55]],
  3: [[-0.55, -0.6], [0, 0], [0.55, 0.6]],
  4: [[-0.55, -0.6], [0.55, -0.6], [-0.55, 0.6], [0.55, 0.6]],
  5: [[-0.6, -0.7], [0.6, -0.7], [0, 0], [-0.6, 0.7], [0.6, 0.7]],
  6: [[-0.6, -0.8], [0.6, -0.8], [-0.6, 0], [0.6, 0], [-0.6, 0.8], [0.6, 0.8]],
  7: [[-0.6, -0.9], [0.6, -0.9], [0, -0.45], [-0.6, 0.1], [0.6, 0.1], [-0.6, 0.9], [0.6, 0.9]],
  8: [
    [-0.6, -0.95],
    [0.6, -0.95],
    [-0.6, -0.32],
    [0.6, -0.32],
    [-0.6, 0.32],
    [0.6, 0.32],
    [-0.6, 0.95],
    [0.6, 0.95],
  ],
  9: [
    [-0.62, -0.95],
    [0, -0.95],
    [0.62, -0.95],
    [-0.62, 0],
    [0, 0],
    [0.62, 0],
    [-0.62, 0.95],
    [0, 0.95],
    [0.62, 0.95],
  ],
  10: [
    [-0.62, -1],
    [0, -1],
    [0.62, -1],
    [-0.62, -0.36],
    [0, -0.36],
    [0.62, -0.36],
    [-0.62, 0.36],
    [0, 0.36],
    [0.62, 0.36],
    [0, 0.9],
  ],
};

function minorEmblem(card: TarotCard) {
  if (card.rank <= 10) {
    const pips = PIPS[card.rank] ?? [[0, 0]];
    const scale = card.rank <= 2 ? 1.6 : card.rank <= 6 ? 1.05 : 0.85;
    return (
      <>
        {pips.map(([x, y], i) => (
          <g key={i} transform={`translate(${x * 34} ${y * 44})`}>
            {suitGlyph(card.arcana, scale)}
          </g>
        ))}
      </>
    );
  }
  // 宫牌：人形剪影 + 手里的花色 + 按等级换头饰
  return courtEmblem(card);
}

/** 宫牌的人形（跟牌面预览里的剪影同一种画法：实心墨褐 + 金色头饰） */
function courtEmblem(card: TarotCard): React.ReactElement {
  const king = card.rank === 14;
  const queen = card.rank === 13;
  const knight = card.rank === 12;
  return (
    <>
      {/* 长袍 */}
      <path
        d="M-20 -44 C-27 -18 -31 22 -33 74 L33 74 C31 22 27 -18 20 -44 C10 -50 -10 -50 -20 -44 Z"
        fill={INK}
      />
      {/* 肩与臂 */}
      <path d="M-21 -44 C-31 -36 -35 -22 -37 -8" fill="none" stroke={INK} strokeWidth="9" strokeLinecap="round" />
      <path d="M21 -44 C31 -38 35 -30 36 -20" fill="none" stroke={INK} strokeWidth="9" strokeLinecap="round" />
      {/* 头 */}
      <circle cy="-58" r="12.5" fill={INK} />
      {/* 手里的花色 */}
      <g transform="translate(38 -26) scale(.92)">{suitGlyph(card.arcana, 1)}</g>
      {/* 头饰：侍从＝束发带 / 骑士＝羽盔 / 王后＝冠冕 / 国王＝尖冠 */}
      {knight && (
        <>
          <path d="M-14 -70 C-6 -74 6 -74 14 -70 C14 -62 6 -58 0 -58 C-6 -58 -14 -62 -14 -70 Z" fill={GOLD} opacity={0.7} />
          <path d="M-2 -72 C-10 -86 -12 -96 -8 -104 C-2 -96 2 -86 2 -74 Z" fill={GOLD} opacity={0.55} />
        </>
      )}
      {queen && (
        <path d="M-13 -70 L-13 -78 L-6 -72 L0 -82 L6 -72 L13 -78 L13 -70 Z" fill={GOLD} opacity={0.7} stroke={GOLD_DEEP} strokeWidth={0.8} />
      )}
      {king && (
        <path d="M-15 -70 L-15 -84 L-7 -75 L0 -88 L7 -75 L15 -84 L15 -70 Z" fill={GOLD} opacity={0.75} stroke={GOLD_DEEP} strokeWidth={0.9} />
      )}
      {!king && !queen && !knight && (
        <ellipse cy="-69" rx="13.5" ry="3.2" fill="none" stroke={GOLD_DEEP} strokeWidth="1.2" opacity={0.8} />
      )}
    </>
  );
}

/* ────────────────────────── 整张牌 ────────────────────────── */

export function TarotFace({
  drawn,
  className,
  showNumber = true,
}: {
  drawn: DrawnCard;
  className?: string;
  showNumber?: boolean;
}) {
  const uid = useId().replace(/[:]/g, "");
  const { card, reversed } = drawn;
  const badge =
    card.arcana === "major"
      ? romanOf(card.rank)
      : card.rank === 1
        ? "A"
        : card.rank <= 10
          ? String(card.rank)
          : ["F", "C", "R", "Re"][card.rank - 11];

  return (
    <svg viewBox="0 0 220 360" className={className} role="img" aria-label={`${card.zh}${reversed ? "（逆位）" : ""}`}>
      <defs>
        <linearGradient id={`p${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={PAPER} />
          <stop offset="1" stopColor={PAPER_DEEP} />
        </linearGradient>
        <radialGradient id={`n${uid}`} cx="0.5" cy="0.34" r="0.8">
          <stop offset="0" stopColor="#fffcf3" />
          <stop offset="1" stopColor="#e4d0a8" />
        </radialGradient>
      </defs>

      <rect x="2" y="2" width="216" height="356" rx="10" fill={`url(#p${uid})`} stroke={GOLD} strokeWidth="1.4" />
      <rect x="9" y="9" width="202" height="342" rx="7" fill="none" stroke={GOLD} strokeWidth="0.8" opacity="0.75" />

      {/* 四角的小卷草 */}
      {[
        [14, 14, 1, 1],
        [206, 14, -1, 1],
        [14, 346, 1, -1],
        [206, 346, -1, -1],
      ].map(([x, y, sx, sy], i) => (
        <path
          key={i}
          d={`M${x} ${y + sy * 12} q0 ${-sy * 8} ${sx * 8} ${-sy * 8} q${sx * 6} 0 ${sx * 6} ${sy * 5}`}
          fill="none"
          stroke={GOLD}
          strokeWidth="0.9"
          opacity="0.8"
        />
      ))}

      <path d={NICHE} fill={`url(#n${uid})`} stroke={GOLD_DEEP} strokeWidth="1" opacity="0.95" />
      <path d={NICHE} fill="none" stroke={GOLD} strokeWidth="0.6" opacity="0.6" transform="translate(110 196) scale(0.965) translate(-110 -196)" />

      {showNumber && (
        <>
          <circle cx="110" cy="40" r="15" fill="#fbf2df" stroke={GOLD_DEEP} strokeWidth="1.1" />
          <text
            x="110"
            y="45"
            textAnchor="middle"
            fontSize="13"
            fill={GOLD_DEEP}
            fontFamily="Georgia, 'Times New Roman', serif"
          >
            {badge}
          </text>
        </>
      )}

      {/* 只有插图跟着正逆位转，牌名/编号/边框保持正着 */}
      <g transform={reversed ? "rotate(180 110 196)" : undefined}>
        <g transform="translate(110 196)">
          {card.arcana === "major" ? majorEmblem(card.rank) : minorEmblem(card)}
        </g>
      </g>

      <text
          x="110"
          y="330"
          textAnchor="middle"
          fontSize="15"
          fill={INK}
          fontFamily="'Noto Serif SC', 'Songti SC', serif"
          letterSpacing="2"
        >
          {card.zh}
        </text>
        <text
          x="110"
          y="345"
          textAnchor="middle"
          fontSize="9.5"
          fill={GOLD_DEEP}
          fontFamily="Georgia, 'Times New Roman', serif"
          fontStyle="italic"
          letterSpacing="1"
        >
          {card.it}
        </text>
        <path d="M62 318 h96" stroke={GOLD} strokeWidth="0.7" opacity="0.7" />

      {reversed && (
        <text
          x="110"
          y="76"
          textAnchor="middle"
          fontSize="7.5"
          opacity={0.85}
          fill={GOLD_DEEP}
          letterSpacing="2"
          fontFamily="'Noto Serif SC', serif"
        >
          逆位 · ROVESCIATA
        </text>
      )}
    </svg>
  );
}

/** 牌背：深褐底 + 双层金线 + 中央八角星，没有任何字 */
export function TarotBack({ className }: { className?: string }) {
  const uid = useId().replace(/[:]/g, "");
  return (
    <svg viewBox="0 0 220 360" className={className} role="img" aria-label="牌背">
      <defs>
        <linearGradient id={`b${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#33271c" />
          <stop offset="1" stopColor="#221a12" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="216" height="356" rx="10" fill={`url(#b${uid})`} stroke={GOLD} strokeWidth="1.2" />
      <rect x="10" y="10" width="200" height="340" rx="7" fill="none" stroke={GOLD} strokeWidth="0.8" opacity="0.65" />
      <rect x="17" y="17" width="186" height="326" rx="5" fill="none" stroke={GOLD} strokeWidth="0.5" opacity="0.4" />
      <g transform="translate(110 180)" fill="none" stroke={GOLD} strokeWidth="0.9" opacity="0.85">
        <circle r="52" />
        <ellipse rx="52" ry="24" />
        <ellipse rx="24" ry="52" />
        {Array.from({ length: 8 }).map((_, i) => (
          <line
            key={i}
            x1={Math.sin((i * Math.PI) / 4) * 26}
            y1={-Math.cos((i * Math.PI) / 4) * 26}
            x2={Math.sin((i * Math.PI) / 4) * 52}
            y2={-Math.cos((i * Math.PI) / 4) * 52}
          />
        ))}
        <circle r="3.4" fill={GOLD} stroke="none" />
      </g>
      {[
        [110, 40],
        [110, 320],
        [40, 180],
        [180, 180],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.4" fill={GOLD} opacity="0.7" />
      ))}
    </svg>
  );
}
