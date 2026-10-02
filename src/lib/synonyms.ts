/**
 * 中文口语同义词表（离线、零成本）。
 *
 * 为什么需要它：
 *   记忆里存的是「我喜欢躺平，精力比较低」，
 *   而用户说的是「今天好累，什么都不想干」—— 字面上一个字都不重合，
 *   纯关键词匹配就会漏掉。有了同义词表，"好累"能牵到"躺平/精力低"。
 *
 * 用法：
 *   · 检索/联想时把**提问那边**的词扩展一组同义词（记忆本身不动）
 *   · 记忆没有标签时，用它自动补上"这属于哪一类"（见 autoTag）
 *
 * 想加词就直接往组里塞 —— 每组第一个是"代表词"（自动打标签时用它）。
 * 用户说"这句没联想到"，多半就是这里少了一组。
 */

export const SYNONYM_GROUPS: string[][] = [
  // ——— 状态 / 情绪 ———
  ["疲惫", "累", "好累", "很累", "疲乏", "疲倦", "没力气", "没精神", "精力低", "精力差", "不想动", "躺平", "撑不住", "乏力", "虚"],
  ["困", "困了", "想睡", "早睡", "晚睡", "熬夜", "失眠", "作息", "打瞌睡"],
  ["焦虑", "怕", "害怕", "担心", "紧张", "不安", "压力", "慌", "发愁", "纠结"],
  ["开心", "高兴", "快乐", "爽", "愉快", "舒服", "满足", "兴奋"],
  ["低落", "丧", "难受", "不开心", "郁闷", "委屈", "烦", "烦人", "烦躁"],
  ["想念", "想你了", "惦记", "挂念", "思念"],
  ["安静", "清净", "别吵", "不吵", "静一点", "嘈杂", "吵"],
  ["无聊", "没意思", "发呆", "放空"],
  // ——— 工作 / 学习 ———
  ["论文", "毕业", "毕设", "导师", "开题", "答辩", "投稿", "期刊", "文献", "参考文献", "综述"],
  ["忙", "很忙", "忙碌", "没时间", "赶", "加班", "事多", "忙不过来"],
  ["工作", "上班", "打工", "公司", "项目", "任务", "需求", "开会"],
  ["学习", "学", "考试", "复习", "背单词", "英语", "课程", "上课"],
  ["计划", "安排", "待办", "清单", "进度", "目标", "截止", "ddl"],
  // ——— 做东西 ———
  ["前端", "网页", "界面", "页面", "ui", "交互", "样式", "组件", "布局"],
  ["代码", "编程", "开发", "写程序", "调试", "bug", "重构", "接口", "部署"],
  ["设计", "排版", "配色", "视觉", "审美", "风格", "好看"],
  ["玻璃", "液态玻璃", "毛玻璃", "通透", "半透明", "模糊", "磨砂"],
  ["留白", "呼吸感", "空旷", "宽松", "不挤", "局促"],
  ["动效", "动画", "过渡", "流畅", "卡顿"],
  ["音乐", "歌", "听歌", "曲子", "旋律", "编曲", "乐器", "歌词"],
  ["写作", "写字", "记录", "记日记", "随笔", "文案"],
  // ——— 生活 ———
  ["吃", "吃饭", "饿了", "外卖", "做饭", "口味", "好吃", "零食", "咖啡", "奶茶"],
  ["家", "家人", "爸妈", "父母", "回家", "老家", "家里"],
  ["朋友", "好友", "同事", "同学", "伙伴", "室友"],
  ["钱", "工资", "花钱", "省钱", "贵", "预算", "穷"],
  ["运动", "跑步", "健身", "散步", "出门", "走走"],
  ["天气", "下雨", "冷", "热", "太阳", "阴天"],
  ["旅行", "出去玩", "海边", "出远门", "旅游", "放假"],
  // ——— 关系 / 相处方式 ———
  ["催", "被催", "别催", "催促", "逼", "压力大"],
  ["独处", "一个人", "社交", "人多", "热闹"],
  ["尊重", "边界", "别管我", "隐私"],
  ["名字", "叫我", "称呼"],
  ["生日", "破壳日", "出生", "纪念日", "周年"],
  // ——— 性格 / 自我描述 ———
  ["性格", "内向", "外向", "敏感", "慢热", "社恐"],
  ["infp", "enfp", "intj", "intp", "entp", "mbti", "e人", "i人", "人格"],
  ["习惯", "平时", "经常", "总是", "一般不"],
];

/** 词 → 它所在的组号（一个词可能在多组里） */
const INDEX = new Map<string, number[]>();
SYNONYM_GROUPS.forEach((group, gi) => {
  for (const raw of group) {
    const w = raw.toLowerCase();
    const list = INDEX.get(w);
    if (list) list.push(gi);
    else INDEX.set(w, [gi]);
  }
});

/** 这个词在词典里吗（用来决定"单个汉字"要不要留下 —— 「累」「困」得留） */
export function isKnownWord(w: string): boolean {
  return INDEX.has(w.toLowerCase());
}

/** 代表词：自动打标签时用它（每组第一个） */
export function canonicalFor(w: string): string | null {
  const groups = INDEX.get(w.toLowerCase());
  if (!groups?.length) return null;
  return SYNONYM_GROUPS[groups[0]!]![0]!;
}

/**
 * 把一批词扩成"加上同义词"的一批（只扩提问那边，不动记忆本身）。
 * 上限是为了别把一次检索变成几百个词的暴力扫描。
 *
 * 两层匹配：
 *   ① 精确命中（「累」在词典里 ✅）
 *   ② **包含关系** —— 中文三字词会被切成两字（「不想动」→「不想/想动」），
 *      所以「不想」也要能牵到「不想动」那一组（实测漏过一次，就是这条）
 */
export function expandWithSynonyms(words: string[], max = 36): string[] {
  const out = new Set(words);
  const addGroup = (gi: number) => {
    for (const syn of SYNONYM_GROUPS[gi]!) {
      if (out.size >= max) return;
      out.add(syn);
    }
  };

  for (const w of words) {
    if (out.size >= max) break;
    const lw = w.toLowerCase();

    const exact = INDEX.get(lw);
    if (exact) {
      for (const gi of exact) {
        if (out.size >= max) break;
        addGroup(gi);
      }
    }

    // 只在两字及以上做包含匹配：单字太容易误伤（「生」会牵到一堆组）
    if (lw.length >= 2 && out.size < max) {
      for (let gi = 0; gi < SYNONYM_GROUPS.length; gi += 1) {
        if (out.size >= max) break;
        const group = SYNONYM_GROUPS[gi]!;
        if (group.some((s) => {
          const ls = s.toLowerCase();
          return ls.includes(lw) || lw.includes(ls);
        })) {
          addGroup(gi);
        }
      }
    }
  }
  return [...out];
}

/**
 * 自动打标签：从内容里认出它属于哪几类，给出代表词。
 * 记忆没有标签时用它兜底（老数据也能受益）。
 */
export function autoTag(content: string, max = 4): string[] {
  const text = content.toLowerCase();
  const tags: string[] = [];
  for (const group of SYNONYM_GROUPS) {
    if (tags.length >= max) break;
    const canonical = group[0]!;
    if (tags.includes(canonical)) continue;
    // 组里任一个词出现在内容里，就把整组算上
    if (group.some((w) => text.includes(w.toLowerCase()))) tags.push(canonical);
  }
  return tags;
}
