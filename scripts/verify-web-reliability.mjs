import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readWebPage, webSearch, parseBingHtml } from "../src/lib/web-http.ts";
import { decodeWebBytes, htmlToText } from "../src/lib/web-extract.ts";
import { buildHttpRequest, executeHttpRequest } from "../src/lib/http-tools.ts";
import { getNativeHttp } from "../src/lib/native-http.ts";

// Native cases use the injected APK bridge, with no dynamically loaded module.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@capacitor/core") throw new Error("native HTTP must not depend on a lazy chunk");
  if (specifier.startsWith("@/")) return { shortCircuit: true,
    url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href };
  return next(specifier, context);
} });

const originalFetch = globalThis.fetch;
const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
const capDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Capacitor");
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, descriptor] of [["location", locationDescriptor], ["Capacitor", capDescriptor]]) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  delete globalThis.__webTestNative;
});
const browser = () => Object.defineProperty(globalThis, "location", { configurable: true, value: { protocol: "https:" } });
const html = '<html><head><title>文章</title></head><body><p>这是读到的正文。</p></body></html>';
const rss = '<rss><channel><item><title>新闻标题</title><link>https://example.com/news</link><description>新闻摘要</description></item></channel></rss>';

test("browser reading uses its server and preserves truncation", async () => {
  browser();
  globalThis.fetch = async (url, init) => {
    assert.match(url, /^\/api\/read\?url=https%3A%2F%2Fexample.com/);
    assert.equal(init.credentials, "same-origin");
    return Response.json({ ok: true, text: "正文内容很长", title: "文章", url: "https://example.com/", status: 200, chars: 6 });
  };
  const result = await readWebPage("https://example.com", { maxChars: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.via, "server");
  assert.equal(result.text, "正文");
  assert.equal(result.truncated, true);
});

test("browser search uses server, filters invalid targets and respects limit", async () => {
  browser();
  globalThis.fetch = async (url) => {
    assert.match(url, /^\/api\/search\?q=/);
    return Response.json({ ok: true, engine: "bocha", results: [
      { title: "私网", url: "http://127.0.0.1/", snippet: "" },
      { title: "新闻", url: "https://example.com/a", snippet: "摘要" },
      { title: "第二条", url: "https://example.com/b", snippet: "" },
    ] });
  };
  const result = await webSearch("新闻", { limit: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.engine, "bocha");
  assert.deepEqual(result.results.map((r) => r.title), ["新闻"]);
});

test("missing server route and authentication failures are not article content", async () => {
  browser();
  globalThis.fetch = async () => new Response(html, { headers: { "content-type": "text/html" } });
  assert.equal((await readWebPage("https://example.com")).ok, false);
  globalThis.fetch = async () => Response.json({ message: "需要先过口令门" }, { status: 401 });
  assert.match((await webSearch("新闻")).why, /口令门/);
});

test("native reading requests bytes and decodes a GBK page", async () => {
  browser();
  globalThis.Capacitor = { isNativePlatform: () => true, nativePromise(plugin, method, opts) {
    assert.equal(plugin, "CapacitorHttp");
    assert.equal(method, "request");
    return globalThis.__webTestNative(opts);
  } };
  globalThis.fetch = () => { throw new Error("must not use WebView fetch or server"); };
  globalThis.__webTestNative = async (opts) => {
    assert.equal(opts.responseType, "arraybuffer");
    assert.equal(opts.url, "https://example.com/");
    const bytes = Buffer.concat([Buffer.from('<body><p>'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from('</p></body>')]);
    return { status: 200, url: opts.url, headers: { "Content-Type": "text/html; charset=gb2312" }, data: bytes.toString("base64") };
  };
  const result = await readWebPage("https://example.com");
  assert.equal(result.ok, true);
  assert.equal(result.via, "native");
  assert.equal(result.text, "中文");
});

test("native plugin proxy is reused and cannot be used in browser mode", async () => {
  const http = { request: async () => ({ status: 200, data: "ok" }) };
  globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { CapacitorHttp: http },
    nativePromise() { throw new Error("use the existing proxy"); } };
  assert.equal(getNativeHttp(), http);
  globalThis.Capacitor.isNativePlatform = () => false;
  assert.equal(getNativeHttp(), null);
});

test("missing or rejecting APK bridge never falls back to WebView fetch", async () => {
  browser();
  globalThis.fetch = () => { throw new Error("must not use WebView fetch"); };
  globalThis.Capacitor = { isNativePlatform: () => true };
  assert.match((await readWebPage("https://example.com")).why, /通道未就绪/);
  globalThis.Capacitor.nativePromise = async () => { throw new Error("native network unavailable"); };
  assert.match((await readWebPage("https://example.com")).why, /native network unavailable/);
});

const httpTool = { method: "POST", url: "https://example.com/api", body: '{"city":"杭州"}',
  headersText: "Authorization: Bearer test-key" };

test("custom HTTP preserves POST body and auth through the APK bridge", async () => {
  globalThis.fetch = () => { throw new Error("must not use WebView fetch"); };
  globalThis.Capacitor = { isNativePlatform: () => true, nativePromise: async (plugin, method, opts) => {
    assert.equal(plugin, "CapacitorHttp");
    assert.equal(method, "request");
    assert.equal(opts.url, httpTool.url);
    assert.equal(opts.method, "POST");
    assert.equal(opts.headers.authorization, "Bearer test-key");
    assert.equal(opts.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(opts.data), { city: "北京" });
    return { status: 200, data: { city: "北京", weather: "晴" } };
  } };
  const res = await executeHttpRequest(buildHttpRequest(httpTool, { city: "北京" }));
  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.text), { city: "北京", weather: "晴" });
});

test("custom HTTP keeps native business errors and browser GET parameters", async () => {
  globalThis.Capacitor = { isNativePlatform: () => true, nativePromise: async () => ({ status: 401, data: "bad key" }) };
  assert.deepEqual(await executeHttpRequest(buildHttpRequest(httpTool)), { ok: false, status: 401, text: "bad key" });
  delete globalThis.Capacitor;
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).searchParams.get("city"), "北京");
    assert.equal(init.method, "GET");
    return new Response("weather");
  };
  const request = buildHttpRequest({ ...httpTool, method: "GET", url: "https://example.com/?city=杭州" }, { city: "北京" });
  assert.equal((await executeHttpRequest(request)).text, "weather");
});

test("custom HTTP has a total deadline for a stalled native bridge or browser body", async () => {
  globalThis.Capacitor = { isNativePlatform: () => true, nativePromise: () => new Promise(() => {}) };
  await assert.rejects(executeHttpRequest(buildHttpRequest(httpTool), 20), /超时/);
  delete globalThis.Capacitor;
  globalThis.fetch = async () => ({ text: () => new Promise(() => {}) });
  await assert.rejects(executeHttpRequest(buildHttpRequest(httpTool), 20), /超时/);
});

test("byte decoder honors meta charset and falls back for unknown encoding", () => {
  const bytes = Buffer.concat([Buffer.from('<meta charset="gbk"><p>'), Buffer.from([0xd6, 0xd0]), Buffer.from('</p>')]);
  assert.match(decodeWebBytes(bytes), /中/);
  assert.equal(decodeWebBytes(Buffer.from("中文"), "text/html;charset=not-an-encoding"), "中文");
});

test("HTTP errors, empty shells and verification pages are failures", async () => {
  globalThis.fetch = async () => new Response(html, { status: 403 });
  assert.match((await readWebPage("https://example.com")).why, /HTTP 403/);
  globalThis.fetch = async () => new Response('<html><head><title>应用标题</title></head><body><script>app()</script></body></html>');
  assert.equal((await readWebPage("https://example.com")).ok, false);
  globalThis.fetch = async () => new Response('<title>安全验证</title><body>请完成验证</body>');
  assert.match((await readWebPage("https://example.com")).why, /验证/);
});

test("one successful search returns without waiting for slow sibling", async () => {
  globalThis.fetch = async (url, init) => {
    if (url.includes("cn.bing.com")) return new Response(rss);
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
  };
  const start = Date.now();
  const result = await webSearch("新闻", { timeoutMs: 400 });
  assert.equal(result.ok, true);
  assert.ok(Date.now() - start < 250, "fast result must not wait for the other endpoint's timeout");
  assert.equal(result.results[0].title, "新闻标题");
});

const resultHtml = '<li data-x="1" class="b_algo other"><h2><a href="https://example.com/news">新闻正文标题</a></h2><p>这里是摘要。</p></li>';
test("RSS failure falls back to actual HTML result blocks", async () => {
  globalThis.fetch = async (url) => new Response(url.includes("format=rss") ? "<html>无 feed</html>" : resultHtml);
  const result = await webSearch("新闻");
  assert.equal(result.ok, true);
  assert.equal(result.engine, "bing-html");
  assert.equal(result.results[0].snippet, "这里是摘要。");
});

test("HTML search unwraps Bing redirect links and rejects private targets", () => {
  const target = "https://example.com/中文";
  const link = "https://www.bing.com/ck/a?u=a1" + Buffer.from(target).toString("base64url");
  assert.equal(parseBingHtml(resultHtml.replace("https://example.com/news", link))[0].url, target);
  assert.deepEqual(parseBingHtml(resultHtml.replace("https://example.com/news", "http://127.0.0.1/")), []);
  assert.deepEqual(parseBingHtml('<title>验证</title><a href="https://example.com">首页</a>'), []);
});

test("search enforces its total deadline even if transport ignores abort", async () => {
  globalThis.fetch = () => new Promise(() => {});
  const start = Date.now();
  const result = await webSearch("新闻", { timeoutMs: 30 });
  assert.equal(result.ok, false);
  assert.ok(Date.now() - start < 250);
});

test("private URLs never reach transport in browser or native mode", async () => {
  browser();
  globalThis.fetch = () => { throw new Error("must not request"); };
  assert.equal((await readWebPage("http://127.1/")).ok, false);
  assert.equal((await readWebPage("file:///tmp/a")).ok, false);
});

test("HTML body excludes title and decodes numeric character entities", () => {
  assert.equal(htmlToText('<title>标题</title><body>&#20013;&#x6587;</body>').text, "中文");
  assert.equal(htmlToText('<title>只有标题</title><div id="root"></div>').text, "");
});

test("all tool families use the same progress labels, including registered external names", async () => {
  const { toolProgressLabel } = await import("../src/lib/tool-title.ts");
  const { resetExternalTools } = await import("../src/lib/external-tools.ts");
  resetExternalTools([{ kind: "mcp", name: "mcp_mem_find", server: "记忆", tool: "检索" },
    { kind: "http", name: "http_weather", tool: "天气" }]);
  const label = toolProgressLabel([
    { name: "web_search", args: '{"query":"新闻"}' }, { name: "web_fetch", args: '{"url":"https://example.com"}' },
    { name: "mcp_mem_find", args: '{}' }, { name: "http_weather", args: '{}' },
    { name: "tool_call", args: '{"server":"记忆","tool":"存储"}' },
  ]);
  assert.match(label, /网页搜索、读取网页、MCP · 记忆 \/ 检索、HTTP · 天气、MCP · 存储/);
  resetExternalTools();
});

test("external call history retains its actual title and pending is not success", async () => {
  const { callSentence } = await import("../src/lib/call-sentence.ts");
  const call = { name: "mcp_mem_find", kind: "tool.call", title: "MCP · 记忆/检索", args: "{}", ok: true, result: "结果" };
  assert.match(callSentence(call, "小克").line, /记忆\/检索/);
  assert.match(callSentence({ ...call, category: "pending", ok: false }, "小克").line, /还没拿到结果/);
});

