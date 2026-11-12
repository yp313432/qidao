import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSegments, BubbleDelivery, typingDelay } from "../src/lib/segment.ts";
import { ChatSendQueue, mergeUserMessages } from "../src/lib/chat-send-queue.ts";
import { cleanAssistantMarkup, stickerAttachment } from "../src/lib/assistant-cleanup.ts";

test("Chinese punctuation and closing quotes produce natural sentences", () => {
  assert.deepEqual(splitSegments('你好。你来了！“真的吗？”那就好。'), ['你好。', '你来了！', '“真的吗？”', '那就好。']);
  assert.deepEqual(splitSegments("你好。再见！", { maxSentences: 2 }), ["你好。 再见！"]);
});
test("English sentences preserve decimals, URLs, emails, abbreviations and links", () => {
  assert.deepEqual(splitSegments('Dr. Li paid 1.5 dollars. Visit https://example.com/a?q=1.5 or [site](https://a.com). Okay!'),
    ['Dr. Li paid 1.5 dollars.', 'Visit https://example.com/a?q=1.5 or [site](https://a.com).', 'Okay!']);
  assert.deepEqual(splitSegments('Email a.b@example.com. Got it?'), ['Email a.b@example.com.', 'Got it?']);
  assert.deepEqual(splitSegments('Visit https://example.com. Okay!'), ['Visit https://example.com.', 'Okay!']);
});
test("code, lists and tables remain intact; old separators remain readable", () => {
  const code = '```js\nconst x = "|||。";\n```';
  const list = '- 一。\n- 二。';
  assert.deepEqual(splitSegments(`${code}\n\n${list}`), [code, list]);
  const table = '| A | B |\n|---|---|\n|一。|二。|';
  assert.deepEqual(splitSegments(table), [table]);
  assert.deepEqual(splitSegments('A | B\n---|---\n一。|二。'), ['A | B\n---|---\n一。|二。']);
  assert.deepEqual(splitSegments('你好|||再见'), ['你好', '再见']);
  assert.equal(splitSegments('一。二。三。四。', { maxParts: 2 }).join('').replace(/\s/g, ''), '一。二。三。四。');
});
test("typing pace scales by length and stays bounded", () => {
  assert.equal(typingDelay('短。'), 400);
  assert.ok(typingDelay('这是一句更长的消息，用来模拟输入时间。') > 400);
  assert.equal(typingDelay('长'.repeat(500)), 4000);
  assert.equal(typingDelay('短。', { smart: false, delayMs: 1200 }), 1200);
});
test("bubble delivery waits for complete sentences and releases one per timer", () => {
  const q = new BubbleDelivery(() => 500);
  q.update(['没写完'], true, 0); assert.deepEqual(q.visible, []);
  q.update(['第一句。', '第二句。', '第三句。'], false, 100);
  assert.deepEqual(q.visible, ['第一句。']);
  q.tick(599); assert.equal(q.visible.length, 1);
  q.tick(600); assert.equal(q.visible.length, 2);
  q.tick(100000); assert.equal(q.visible.length, 3);
  assert.equal(q.dueAt, 0, 'finished queues must stop their timers');
  const backlog = new BubbleDelivery(() => 500);
  backlog.update(['一。', '二。', '三。', '四。'], false, 0);
  backlog.tick(100000); assert.equal(backlog.visible.length, 2, 'resume must not burst the entire backlog');
});
test("repeated stream snapshots do not reset the pending deadline", () => {
  const q = new BubbleDelivery(() => 500);
  q.update(['一。', '二。', '未完'], true, 0);
  q.update(['一。', '二。', '未完成'], true, 300);
  assert.equal(q.dueAt, 500);
  q.tick(500); assert.deepEqual(q.visible, ['一。', '二。']);
});
test("a revised tool-round draft retracts obsolete pending bubbles", () => {
  const q = new BubbleDelivery(() => 500);
  q.update(['旧回答。', '旧补充。'], false, 0);
  q.update(['新回答。', '新补充。'], false, 200);
  q.tick(500); assert.deepEqual(q.visible, ['新回答。']);
  q.tick(700); assert.deepEqual(q.visible, ['新回答。', '新补充。']);
});
test("cleanup hides complete/partial emotion payloads without deleting surrounding text", () => {
  assert.equal(cleanAssistantMarkup('我懂了。{"primaryEmotion":"开心","intensity":0.5}晚安。'), '我懂了。晚安。');
  assert.equal(cleanAssistantMarkup('你好。{"primaryEmotion":"开'), '你好。');
  assert.equal(cleanAssistantMarkup('你好。[{"name":"default_api:emotion_report","arguments":{"primaryEmotion":"开心"}}]晚安。'), '你好。晚安。');
  assert.equal(cleanAssistantMarkup('你好。<emotion intensity="0.5">开心</emotion>再聊。'), '你好。再聊。');
  assert.equal(cleanAssistantMarkup('你好。<emotion>开'), '你好。');
  assert.equal(cleanAssistantMarkup('好的。\n```json\n{"primaryEmotion":"开心","intensity":0.5}\n```\n晚安。'), '好的。\n\n晚安。');
});
test("cleanup removes explicit sticker placeholders and preserves ordinary prose/code", () => {
  assert.equal(cleanAssistantMarkup('没关系。[表情包]【表情包：抱抱】'), '没关系。');
  assert.equal(cleanAssistantMarkup('表情包'), '');
  assert.equal(cleanAssistantMarkup('我今天情绪不错，想找一个表情包。'), '我今天情绪不错，想找一个表情包。');
  assert.equal(cleanAssistantMarkup('```js\nconst text = "hello";\n```'), '```js\nconst text = "hello";\n```');
  assert.equal(cleanAssistantMarkup('{"title":"报告","text":"内容"}'), '{"title":"报告","text":"内容"}');
});
test("sticker attachments retain GIF format and reject invalid addresses", () => {
  assert.equal(stickerAttachment('data:image/gif;base64,R0lGODlh', 'id').mime, 'image/gif');
  assert.equal(stickerAttachment('https://example.com/a.gif', 'id').kind, 'sticker');
  assert.equal(stickerAttachment('undefined', 'id'), null);
  assert.equal(stickerAttachment('javascript:alert(1)', 'id'), null);
});
test("consecutive messages merge only in model context, including attachments", () => {
  const input = [{ role: 'user', content: '第一句' }, { role: 'user', content: '补充' },
    { role: 'assistant', content: '收到' }, { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }] },
    { role: 'user', content: '看这张' }];
  const out = mergeUserMessages(input);
  assert.equal(out.length, 3); assert.equal(out[0].content, '第一句\n\n补充');
  assert.equal(input[0].content, '第一句');
  assert.ok(out[2].content.some((p) => p.type === 'image_url'));
});
test("rapid sends debounce into one job", async () => {
  const q = new ChatSendQueue(); let calls = 0;
  const a = q.enqueue('chat', 20, async () => { calls++; });
  const b = q.enqueue('chat', 20, async () => { calls++; });
  await Promise.all([a, b]); assert.equal(calls, 1); assert.equal(q.getSnapshot().pending, 0);
});
test("supplements wait behind active work and coalesce without restarting it", async () => {
  const q = new ChatSendQueue(); const events = [];
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let started; const began = new Promise((resolve) => { started = resolve; });
  const a = q.enqueue('chat', 0, async () => { events.push('start'); started(); await gate; events.push('end'); });
  await began;
  const b = q.enqueue('chat', 10, async () => { events.push('old'); });
  const c = q.enqueue('chat', 10, async () => { events.push('supplement'); });
  assert.deepEqual(events, ['start']); assert.equal(q.getSnapshot().pending, 2);
  release(); await Promise.all([a, b, c]); assert.deepEqual(events, ['start', 'end', 'supplement']);
});
test("queued conversations remain separate, stop cancels pending work, errors do not block the queue", async () => {
  const errors = []; const q = new ChatSendQueue((e) => errors.push(e.message)); const events = [];
  await Promise.all([q.enqueue('a', 0, async () => { throw Error('test'); }), q.enqueue('b', 0, async () => { events.push('b'); })]);
  assert.deepEqual(events, ['b']); assert.deepEqual(errors, ['test']);
  const pending = q.enqueue('c', 1000, async () => { events.push('cancelled'); });
  q.stop(); await pending; assert.deepEqual(events, ['b']);
});
