/** Serial, per-conversation debounce queue. Active tool work is never restarted by a supplement. */
type Job = { key: string; due: number; count: number; run: () => Promise<void>; cancel?: () => void; done: (() => void)[] };
export class ChatSendQueue {
  private onError: (error: unknown) => void;
  constructor(onError: (error: unknown) => void = () => {}) { this.onError = onError; }
  private pending: Job[] = [];
  private active: Job | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private snapshot = { running: false, pending: 0 };
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;
  enqueue(key: string, delay: number, run: () => Promise<void>, cancel?: () => void): Promise<void> {
    return new Promise((resolve) => {
      const old = this.pending.find((j) => j.key === key);
      if (old) { old.due = Date.now() + delay; old.count++; old.run = run; old.cancel = cancel; old.done.push(resolve); }
      else this.pending.push({ key, due: Date.now() + delay, count: 1, run, cancel, done: [resolve] });
      this.publish(); this.schedule();
    });
  }
  stop() {
    this.active?.cancel?.();
    for (const job of this.pending) job.done.forEach((done) => done());
    this.pending = []; clearTimeout(this.timer); this.publish();
  }
  private publish() {
    this.snapshot = { running: Boolean(this.active), pending: this.pending.reduce((n, j) => n + j.count, 0) };
    this.listeners.forEach((fn) => fn());
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.active || !this.pending.length) return;
    this.timer = setTimeout(() => void this.start(), Math.max(0, this.pending[0].due - Date.now()));
  }
  private async start() {
    if (this.active || !this.pending.length) return;
    if (this.pending[0].due > Date.now()) { this.schedule(); return; }
    const job = this.pending.shift()!;
    this.active = job; this.publish();
    try { await job.run(); }
    catch (error) { this.onError(error); }
    finally { job.done.forEach((done) => done()); this.active = null; this.publish(); this.schedule(); }
  }
}

import type { ApiMessage, ContentPart } from "./chat-client";
/** UI keeps individual user bubbles; the model receives consecutive supplements as one turn. */
export function mergeUserMessages(messages: ApiMessage[]): ApiMessage[] {
  const out: ApiMessage[] = [];
  const parts = (content: ApiMessage["content"]): ContentPart[] => typeof content === "string" ? [{ type: "text", text: content }] : content;
  for (const message of messages) {
    const last = out.at(-1);
    if (last?.role === "user" && message.role === "user") {
      last.content = typeof last.content === "string" && typeof message.content === "string"
        ? `${last.content}\n\n${message.content}` : [...parts(last.content), { type: "text", text: "\n\n" }, ...parts(message.content)];
    } else out.push({ ...message });
  }
  return out;
}
