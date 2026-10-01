export const BOARD = 15;
export type Stone = 0 | 1 | 2;
export type Point = { r: number; c: number };

const DIRS: Array<[number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export function emptyBoard(): Stone[] {
  return Array<Stone>(BOARD * BOARD).fill(0);
}

export function idx(r: number, c: number): number {
  return r * BOARD + c;
}

export function inb(r: number, c: number): boolean {
  return r >= 0 && r < BOARD && c >= 0 && c < BOARD;
}

export function lineOfFive(board: Stone[], r: number, c: number): Point[] | null {
  const s = board[idx(r, c)];
  if (!s) return null;
  for (const [dr, dc] of DIRS) {
    const cells: Point[] = [{ r, c }];
    for (const sign of [-1, 1]) {
      let nr = r + dr * sign;
      let nc = c + dc * sign;
      while (inb(nr, nc) && board[idx(nr, nc)] === s) {
        cells.push({ r: nr, c: nc });
        nr += dr * sign;
        nc += dc * sign;
      }
    }
    if (cells.length >= 5) return cells;
  }
  return null;
}

function countDir(board: Stone[], r: number, c: number, dr: number, dc: number, s: Stone) {
  let n = 0;
  let blocked = 0;
  let nr = r + dr;
  let nc = c + dc;
  while (inb(nr, nc) && board[idx(nr, nc)] === s) {
    n += 1;
    nr += dr;
    nc += dc;
  }
  if (!inb(nr, nc) || board[idx(nr, nc)] !== 0) blocked += 1;
  nr = r - dr;
  nc = c - dc;
  while (inb(nr, nc) && board[idx(nr, nc)] === s) {
    n += 1;
    nr -= dr;
    nc -= dc;
  }
  if (!inb(nr, nc) || board[idx(nr, nc)] !== 0) blocked += 1;
  return { n: n + 1, blocked };
}

function scoreShape(n: number, blocked: number, mine: boolean): number {
  if (n >= 5) return mine ? 1_000_000 : 400_000;
  const k = mine ? 1 : 0.9;
  if (n === 4 && blocked === 0) return (mine ? 80_000 : 70_000) * k;
  if (n === 4 && blocked === 1) return (mine ? 12_000 : 20_000) * k;
  if (n === 3 && blocked === 0) return (mine ? 8_000 : 10_000) * k;
  if (n === 3 && blocked === 1) return (mine ? 600 : 800) * k;
  if (n === 2 && blocked === 0) return (mine ? 400 : 350) * k;
  if (n === 2 && blocked === 1) return 40 * k;
  return 8 * k;
}

function evalPoint(board: Stone[], r: number, c: number, s: Stone): number {
  let score = 0;
  for (const [dr, dc] of DIRS) {
    const { n, blocked } = countDir(board, r, c, dr, dc, s);
    if (blocked >= 2 && n < 5) continue;
    score += scoreShape(n, blocked, true);
  }
  const center = (BOARD - 1) / 2;
  score += (6 - Math.abs(r - center) - Math.abs(c - center)) * 3;
  return score;
}

function candidates(board: Stone[]): Point[] {
  const seen = new Set<number>();
  const out: Point[] = [];
  let any = false;
  for (let r = 0; r < BOARD; r++) {
    for (let c = 0; c < BOARD; c++) {
      if (!board[idx(r, c)]) continue;
      any = true;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inb(nr, nc) || board[idx(nr, nc)]) continue;
          const k = idx(nr, nc);
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ r: nr, c: nc });
        }
      }
    }
  }
  if (!any) return [{ r: 7, c: 7 }];
  return out;
}

function scoreMove(board: Stone[], p: Point, ai: Stone): number {
  const human: Stone = ai === 1 ? 2 : 1;
  board[idx(p.r, p.c)] = ai;
  const atk = evalPoint(board, p.r, p.c, ai);
  board[idx(p.r, p.c)] = human;
  const def = evalPoint(board, p.r, p.c, human);
  board[idx(p.r, p.c)] = 0;
  return atk + def * 1.05;
}

export function aiMove(board: Stone[], ai: Stone = 2): Point {
  const spots = candidates(board);
  spots.sort((a, b) => scoreMove(board, b, ai) - scoreMove(board, a, ai));
  const top = spots.slice(0, 18);
  let best = top[0] ?? { r: 7, c: 7 };
  let bestScore = -Infinity;
  const human: Stone = ai === 1 ? 2 : 1;
  for (const p of top) {
    board[idx(p.r, p.c)] = ai;
    if (lineOfFive(board, p.r, p.c)) {
      board[idx(p.r, p.c)] = 0;
      return p;
    }
    let worst = Infinity;
    const replies = candidates(board)
      .map((q) => ({ q, s: scoreMove(board, q, human) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 8);
    for (const { q } of replies) {
      board[idx(q.r, q.c)] = human;
      if (lineOfFive(board, q.r, q.c)) {
        worst = Math.min(worst, -500_000);
      } else {
        worst = Math.min(worst, scoreMove(board, p, ai) - scoreMove(board, q, human));
      }
      board[idx(q.r, q.c)] = 0;
    }
    board[idx(p.r, p.c)] = 0;
    if (worst > bestScore) {
      bestScore = worst;
      best = p;
    }
  }
  return best;
}

export function boardFull(board: Stone[]): boolean {
  return board.every((c) => c !== 0);
}
