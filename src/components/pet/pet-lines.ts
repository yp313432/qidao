const LINES: Record<string, string[]> = {
  idle: ['去那边看看。', '这里离你近。', '{name}，我在呢。', '安静待一会儿。'],
  poke: ['嗯？', '叫我呀，{name}？', '摸到了！'],
  drag: ['欸——', '带我去哪？', '抱紧小电脑。'],
  drop: ['站稳啦。', '这里不错。'],
  work: ['开工。', '我查一下。'],
  done: ['忙完这一段。', '电脑先收好。'],
  bright: ['有点开心。', '藏不住了。'], low: ['想挨着你。', '陪我待会儿。'],
  angry: ['哼。', '让我缓缓。'], curious: ['让我瞧瞧。', '那是什么？'],
};
export function petLine(kind: string, name: string, mood?: string, previous?: string): string {
  const choices = LINES[kind === 'idle' && mood && LINES[mood] ? mood : kind] ?? LINES.idle!;
  const rendered = choices.map(s => s.replaceAll('{name}', name.trim().slice(0, 16) || '你'));
  const available = rendered.filter(s => s !== previous);
  return available[Math.floor(Math.random() * available.length)] ?? rendered[0]!;
}
