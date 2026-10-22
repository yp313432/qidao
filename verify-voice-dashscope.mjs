/**
 * 百炼（阿里 DashScope）语音通道 —— 静态校验。
 *
 * 为什么是"静态"：`src/lib/dashscope.ts` 是 TS，纯 node 跑不了；
 * 而这条通道真正的风险不在算法，在**几个约定容易改坏**：
 *   · 地址规范化（用户会填带 /v1、带工作空间的域名）
 *   · 情绪 → instruction 的 10 组映射漏掉某一组（界面上看不出来，只是"有时候语气怪"）
 *   · 合成/音色/捏嗓子三处调用的形状改了，但 UI 还在传老参数
 * 所以这里逐个查源码里的关键约定。
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

let pass = 0;
const fails = [];
function ok(name, cond, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ds = read("./src/lib/dashscope.ts");
const vs = read("./src/lib/voice-service.ts");
const tts = read("./src/lib/tts.ts");
const me = read("./src/components/me-sections.tsx");
const types = read("./src/lib/types.ts");

/* ── 1. 模块导出 ── */
for (const name of [
  "baseOf",
  "synthDashscope",
  "listDashscopeVoices",
  "designVoice",
  "instructionOfEmotion",
  "DS_TTS_MODELS",
  "DS_SYSTEM_VOICES",
]) {
  ok(`dashscope.ts 导出 ${name}`, new RegExp(`export (async )?function ${name}|export const ${name}`).test(ds));
}

/* ── 2. 地址规范化：三种写法都要认 ── */
ok("baseOf 处理尾斜杠与 /v1", /\/v1/.test(ds) && /replace/.test(ds));
ok("baseOf 认专属域名（maas.aliyuncs.com）", /maas\.aliyuncs\.com/.test(ds));
ok("默认地址是 dashscope.aliyuncs.com", /DS_DEFAULT_BASE\s*=\s*["']https:\/\/dashscope\.aliyuncs\.com/.test(ds));

/* ── 3. 三个接口路径 ── */
ok("合成走 SpeechSynthesizer", /services\/audio\/tts\/SpeechSynthesizer/.test(ds));
ok("音色表走 customization", /services\/audio\/tts\/customization/.test(ds));
ok("音色动作 list_voice / create_voice", /list_voice/.test(ds) && /create_voice/.test(ds));
ok("合成带 instruction", /instruction/.test(ds));
ok("合成返回 base64 或 url 都吃", /audio\.(data|url)/.test(ds));

/* ── 4. 情绪 → instruction 十组 ── */
const groups = ["bright", "calm", "low", "angry", "uneasy", "close", "flutter", "jealous", "restrained", "curious"];
for (const g of groups) {
  ok(`instructionOfEmotion 覆盖 ${g}`, new RegExp(`case "${g}"|\\b${g}:`).test(ds));
}
ok("calm 不加 instruction（平着念）", /case "calm"[\s\S]{0,80}return ""/.test(ds));

/* ── 5. voice-service 接上 ── */
ok("VoiceProvider 含 dashscope", /VoiceProvider[\s\S]{0,120}dashscope/.test(vs));
ok("voiceProviderOf 认 dashscope 域名", /dashscope\\?\.aliyuncs/.test(vs));
ok("synthesize 有 dashscope 分支", /synthDashscope\(/.test(vs));
ok("listVoiceModels 有 dashscope 分支", /listDashscopeVoices\(/.test(vs));

/* ── 6. tts 按情绪调语气 ── */
ok("tts 读 voiceEmotionTags", /voiceEmotionTags/.test(tts));
ok("tts 把 instruction 传进 synthesize", /instruction/.test(tts) && /synthesize\(clean, undefined, \{ instruction \}\)/.test(tts));

/* ── 7. 设置字段 ── */
ok("Settings 有 voiceEmotionTags", /voiceEmotionTags\?: boolean/.test(types));

/* ── 8. 界面 ── */
ok("界面有第三个 tab", /3 · 百炼/.test(me));
ok("切到百炼会填地址", /https:\/\/dashscope\.aliyuncs\.com/.test(me));
ok("界面有捏嗓子", /捏一个嗓子/.test(me) && /designVoice\(/.test(me));
ok("界面有按情绪念开关", /按情绪念/.test(me));
ok("百炼时不显示转文字格", /voiceProvider === "dashscope" && f\.k === "voiceAsrModel"/.test(me));
ok("音色弹层含系统音色", /DS_SYSTEM_VOICES\.map/.test(me));
ok("合成弹层用固定三模型", /DS_TTS_MODELS/.test(me));

/* ── 9. 不泄密钥：源码里不该出现 sk- 开头的长串 ── */
ok("源码里没有硬编码 key", !/sk-[a-zA-Z0-9]{20,}/.test(ds + vs + tts));

console.log("");
if (fails.length) {
  console.log(`❌ ${fails.length} 项失败：`);
  for (const f of fails) console.log(`   · ${f}`);
  process.exit(1);
}
console.log(`✅ 全部通过（${pass} 项）`);
