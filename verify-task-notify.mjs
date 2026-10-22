/**
 * 「定时任务到点能弹通知」的守卫。
 *
 * 背景（用户 m10442）：他说的「定时任务」不是闹钟——`components/task-daemon.tsx`
 * 是纯前台 JS，App 一关就没人跑，所以以前定了 7:30 在 App 关着时什么都不会发生。
 * 修法是把任务排进系统通知（`lib/task-notify.ts`），到点由系统把 App 叫起来。
 *
 * 这个脚本不跑浏览器，只静态查三件事：**排的规则对不对**、**文案会不会泄露**、
 * **守护进程有没有真的接上**。跑法：`node verify-task-notify.mjs`
 */
import { readFileSync } from "node:fs";

let pass = 0;
const fails = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name + (detail ? `（${detail}）` : ""));
    console.log(`  ✗ ${name}${detail ? `（${detail}）` : ""}`);
  }
}

const notifySrc = readFileSync("src/lib/task-notify.ts", "utf8");
const daemonSrc = readFileSync("src/components/task-daemon.tsx", "utf8");
const actionsSrc = readFileSync("src/lib/actions.ts", "utf8");

console.log("一、排的规则");
check("导出 syncTaskNotifications", /export async function syncTaskNotifications/.test(notifySrc));
check("只排 enabled 的任务", /if \(!t\.enabled\) continue;/.test(notifySrc));
check("没有 time 也没有 at 的跳过", /if \(!t\.time && !t\.at\) continue;/.test(notifySrc));
check("过期的一次性不排", /if \(t\.at && t\.at <= now\) continue;/.test(notifySrc));
check("安静时段不排（23:00–07:00）", /QUIET_FROM = 23/.test(notifySrc) && /QUIET_TO = 7/.test(notifySrc));
check(
  "每天任务用 daily 重复，一次性用 at",
  /daily: \{ hour: h!, minute: m! \}/.test(notifySrc) && /at: new Date\(t\.at\)/.test(notifySrc),
);

console.log("二、文案不泄露任务原文");
check("没有把 task.prompt 拼进通知", !/t\.prompt/.test(notifySrc));
check("正文是中性提示", /他按时醒了，点开看看他想跟你说什么/.test(notifySrc));
check("标题是 App 名", /title: "栖岛"/.test(notifySrc));

console.log("三、幂等与撤销");
check("用 localStorage 记已排 id", /qidao:task-notified/.test(notifySrc));
check("不在新列表里的要撤掉", /if \(!wantIds\.includes\(id\)\) await cancelNative\(id\)/.test(notifySrc));
check("排之前不重复堆积（want 去重靠任务 id 唯一）", /want\.push\(\{ id: hashId\(t\.id\), task: t \}\)/.test(notifySrc));

console.log("四、hashId 与其它两处一致");
const notifyHash = notifySrc.match(/h = \(h \* 31 \+ s\.charCodeAt\(i\)\) % 2147483000/);
const actHash = actionsSrc.match(/h = \(h \* 31 \+ s\.charCodeAt\(i\)\) % 2147483000/);
check("task-notify 的 hashId 用同一套算法", Boolean(notifyHash));
check("actions.ts 的 hashId 用同一套算法", Boolean(actHash));

console.log("五、守护进程真的接上了");
check("task-daemon 导入了 syncTaskNotifications", /import \{ syncTaskNotifications \} from "@\/lib\/task-notify"/.test(daemonSrc));
check("挂载时先同步一次", /sync\(\);\s*\n\s*const unsub = useApp\.subscribe/.test(daemonSrc));
check("任务变化会立刻重排（subscribe）", /useApp\.subscribe\(\(\) => sync\(\)\)/.test(daemonSrc));
check("签名比对短路，避免每次 store 变动都重排", /if \(sig === lastSig\) return;/.test(daemonSrc));
check("签名里含 enabled / time / at（改了时间会重排）", /t\.enabled \? 1 : 0/.test(daemonSrc) && /t\.time \?\? ""/.test(daemonSrc));
check("tick 立即跑一次（点通知打开 App 就能补发）", /void tick\(\);\s*\n\s*const id = window\.setInterval/.test(daemonSrc));

console.log("");
if (fails.length) {
  console.log(`✗ ${fails.length} 项没过：`);
  for (const f of fails) console.log(`   · ${f}`);
  process.exit(1);
}
console.log(`✓ 全部通过（${pass} 项）`);
