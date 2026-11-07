/**
 * `action-schema.ts` 的不变量测试 —— 为什么有它：
 *
 * 这份表是"他能做的事"的**唯一定义**：提示词里的动作清单、发给模型的 `tools`、
 * 以及模型选完 tool 之后回填成 kind 的反查表，三样东西全由它派生。
 * 但它此前**一个测试都没有** —— 加一个动作忘了写字段、两个 kind 的 tool name 撞车、
 * 组名拼错导致那一组悄悄空掉，这些都只会在真机上表现为"他好像不会做这件事"，
 * 而不会报错。所以这里不测"某个动作长什么样"（那是给模型看的文案，会改），
 * 只测**结构上的自洽**：唯一、覆盖、往返、形状。
 *
 * 刻意**不写死动作数量**：加动作是正常业务，写死数字会让每次新增都要改测试。
 * 测的是"这 95 个和未来那 N 个都必须满足的关系"。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_GROUPS,
  ACTION_GROUP_OF,
  ACTION_KIND_BY_TOOL_NAME,
  ACTION_SCHEMA,
  ACTION_TOOL_NAMES,
  type ActionFieldDef,
  actionToolName,
  actionTools,
  actionToolsFor,
  kindOfToolName,
  renderActionCatalog,
} from "./action-schema.ts";

const FIELD_TYPES = new Set(["string", "number", "boolean", "string[]", "object"]);

type Action = (typeof ACTION_SCHEMA)[number];

/** 取某个动作对应的 tool；schema 里每个动作都该有，没有就是真的坏了。 */
function toolOf(action: Action) {
  const tool = actionTools().find((t) => t.function.name === actionToolName(action.kind));
  assert.ok(tool, `找不到 ${action.kind} 的 tool`);
  return tool;
}

/** `ACTION_SCHEMA` 是 `as const` 的，字段联合类型太窄（有的带 note 有的不带），这里放宽。 */
function fieldsOf(action: Action) {
  return action.fields as readonly ActionFieldDef[];
}

describe("ACTION_SCHEMA 自洽", () => {
  it("kind 不重复", () => {
    const seen = new Set<string>();
    for (const action of ACTION_SCHEMA) {
      assert.ok(!seen.has(action.kind), `kind 重复：${action.kind}`);
      seen.add(action.kind);
    }
  });

  it("每个动作的组都真实存在，且每个组都有动作", () => {
    const declared = new Set<string>(ACTION_GROUPS);
    for (const action of ACTION_SCHEMA) {
      assert.ok(
        declared.has(action.group),
        `${action.kind} 的组「${action.group}」不在 ACTION_GROUPS 里`,
      );
    }
    // 反向：拼错组名会让那一整组悄悄空掉，页面上就是少一段能力
    const used = new Set(ACTION_SCHEMA.map((a) => a.group));
    for (const group of ACTION_GROUPS) {
      assert.ok(used.has(group), `组「${group}」一个动作都没有`);
    }
  });

  it("ACTION_GROUPS 不重复（注释里出现的引号不算组名，但重复的真组名要拦）", () => {
    assert.equal(new Set(ACTION_GROUPS).size, ACTION_GROUPS.length);
  });

  it("每个动作都有非空 summary，且字段名在动作内唯一、字段类型合法", () => {
    for (const action of ACTION_SCHEMA) {
      assert.ok(action.summary.trim().length > 0, `${action.kind} 没有 summary`);
      const names = new Set<string>();
      for (const field of action.fields) {
        assert.ok(!names.has(field.name), `${action.kind} 的字段 ${field.name} 重复`);
        names.add(field.name);
        assert.ok(
          FIELD_TYPES.has(field.type),
          `${action.kind}.${field.name} 的 type 非法：${field.type}`,
        );
      }
    }
  });
});

describe("kind ↔ function name", () => {
  it("actionToolName 把点换成下划线", () => {
    assert.equal(actionToolName("memory.add"), "memory_add");
    assert.equal(actionToolName("navigate"), "navigate");
  });

  it("每个 tool name 只含 OpenAI 允许的字符，且两两不撞车", () => {
    const names = new Map<string, string>();
    for (const action of ACTION_SCHEMA) {
      const name = actionToolName(action.kind);
      assert.match(name, /^[a-zA-Z0-9_-]+$/, `${action.kind} 生成的 ${name} 含非法字符`);
      // a.b 与 a_b 会压成同一个名字 —— 真撞了就是「调 A 执行 B」
      assert.ok(!names.has(name), `${action.kind} 与 ${names.get(name)} 的 tool name 都是 ${name}`);
      names.set(name, action.kind);
    }
  });

  it("正向表、反向表、kindOfToolName 三者往返一致", () => {
    for (const action of ACTION_SCHEMA) {
      const name = ACTION_TOOL_NAMES[action.kind];
      assert.equal(name, actionToolName(action.kind));
      assert.equal(ACTION_KIND_BY_TOOL_NAME[name], action.kind);
      assert.equal(kindOfToolName(name), action.kind);
    }
  });

  it("不是我们的工具名返回 null（模型会瞎编名字）", () => {
    assert.equal(kindOfToolName("not_a_real_tool"), null);
    assert.equal(kindOfToolName(""), null);
    assert.equal(kindOfToolName("memory__add"), null);
  });
});

describe("actionTools() 发给模型的形状", () => {
  it("动作与 tool 一一对应，名字跟正向表一致，description 带上 kind", () => {
    const tools = actionTools();
    assert.equal(tools.length, ACTION_SCHEMA.length);
    tools.forEach((tool, index) => {
      const action = ACTION_SCHEMA[index];
      assert.equal(tool.type, "function");
      assert.equal(tool.function.name, ACTION_TOOL_NAMES[action.kind]);
      assert.ok(
        tool.function.description.includes(action.kind),
        `${action.kind} 的 description 里没有 kind`,
      );
    });
  });

  it("parameters 是 object，properties 与 fields 一一对应，required 只在真有必要时出现", () => {
    for (const action of ACTION_SCHEMA) {
      const params = toolOf(action).function.parameters;
      assert.equal(params.type, "object");
      assert.deepEqual(
        Object.keys(params.properties),
        fieldsOf(action).map((f) => f.name),
      );
      const required = fieldsOf(action)
        .filter((f) => f.required)
        .map((f) => f.name);
      if (required.length === 0) {
        assert.ok(!("required" in params), `${action.kind} 没有必填字段却带了 required`);
      } else {
        assert.deepEqual(params.required, required);
      }
    }
  });

  it("string[] 变成 array[string]，object 保持 object，note 落到 description", () => {
    for (const action of ACTION_SCHEMA) {
      const params = toolOf(action).function.parameters;
      for (const field of fieldsOf(action)) {
        const param = params.properties[field.name];
        if (field.type === "string[]") {
          assert.equal(param.type, "array");
          assert.deepEqual(param.items, { type: "string" });
        } else {
          assert.equal(param.type, field.type);
        }
        if (field.note) assert.equal(param.description, field.note);
        else assert.equal(param.description, undefined);
      }
    }
  });
});

describe("actionToolsFor() 按需注册", () => {
  it("只发要的那几个，顺序跟着 ACTION_SCHEMA（稳定 → 不打断上游前缀缓存）", () => {
    const kinds = ["memory.add", "navigate"];
    const tools = actionToolsFor(kinds);
    assert.deepEqual(
      tools.map((t) => t.function.name),
      ACTION_SCHEMA.filter((a) => kinds.includes(a.kind)).map((a) => actionToolName(a.kind)),
    );
    const reversed = actionToolsFor([...kinds].reverse());
    assert.deepEqual(reversed, tools);
  });

  it("不认识的 kind 被忽略，空数组返回空（这一轮不需要任何工具）", () => {
    assert.deepEqual(actionToolsFor([]), []);
    assert.deepEqual(actionToolsFor(["nope", "also.nope"]), []);
    assert.equal(actionToolsFor(["navigate", "nope"]).length, 1);
  });
});

describe("ACTION_GROUP_OF", () => {
  it("kind → 组 与 schema 完全一致", () => {
    assert.deepEqual(Object.keys(ACTION_GROUP_OF).sort(), ACTION_SCHEMA.map((a) => a.kind).sort());
    for (const action of ACTION_SCHEMA) {
      assert.equal(ACTION_GROUP_OF[action.kind], action.group);
    }
  });
});

describe("renderActionCatalog()", () => {
  it("一行一个动作、不重不漏，且按 ACTION_GROUPS 的顺序排", () => {
    const lines = renderActionCatalog().split("\n");
    assert.equal(lines.length, ACTION_SCHEMA.length);

    const expected: string[] = [];
    for (const group of ACTION_GROUPS) {
      for (const action of ACTION_SCHEMA) {
        if (action.group === group) expected.push(action.kind);
      }
    }
    lines.forEach((line, index) => {
      const match = /^\[(.+?)\] ([a-zA-Z0-9_.]+)/.exec(line);
      assert.ok(match, `第 ${index + 1} 行格式不对：${line}`);
      const action = ACTION_SCHEMA.find((a) => a.kind === match[2]);
      assert.ok(action, `第 ${index + 1} 行的 kind 不存在：${match[2]}`);
      assert.equal(match[2], expected[index], `第 ${index + 1} 行顺序不对`);
      assert.equal(match[1], action.group);
      assert.ok(line.endsWith(`—— ${action.summary}`), `${action.kind} 那行结尾不是 summary`);
    });
  });

  it("必填字段不带问号，选填字段带问号（他读的就是这段括注）", () => {
    const lines = renderActionCatalog().split("\n");
    let checked = 0;
    for (const action of ACTION_SCHEMA) {
      const required = action.fields.filter((f) => f.required);
      const optional = action.fields.filter((f) => !f.required);
      if (required.length === 0 || optional.length === 0) continue;
      const line = lines.find((l) => l.includes(` ${action.kind}(`));
      assert.ok(line, `${action.kind} 在目录里找不到带字段的行`);
      for (const field of required) {
        assert.ok(
          line.includes(`${field.name}: ${field.type}`),
          `${action.kind} 的必填 ${field.name} 写法不对`,
        );
        assert.ok(
          !line.includes(`${field.name}?: ${field.type}`),
          `${action.kind} 的必填 ${field.name} 多了问号`,
        );
      }
      for (const field of optional) {
        assert.ok(
          line.includes(`${field.name}?: ${field.type}`),
          `${action.kind} 的选填 ${field.name} 少了问号`,
        );
      }
      checked += 1;
    }
    assert.ok(checked > 0, "一个既有必填又有选填的动作都没有？那这条测试该重写");
  });
});
