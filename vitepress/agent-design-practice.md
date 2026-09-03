---
title: "Agent 架构设计：一个长任务怎么跑起来"
description: "以 Claude Code 和 Codex 为样本，沿一次真实任务的执行过程，拆解 Agent 的状态模型、上下文编译、工具副作用、安全边界、多 Agent 协同、协议接口与评测。"
date: 2026-09-02
category: "大模型"
tags: [大模型, Agent, Claude Code, Codex, LLM应用, 架构设计]
---

# Agent 架构设计：一个长任务怎么跑起来

Agent Harness  |  状态 · 上下文 · 工具 · 安全 · 多 Agent · 运行时

::: info

<strong>资料口径</strong>：内容按 2026 年 9 月 2 日的公开资料整理。Codex 以官方文档和 `openai/codex` 开源仓库为主；Claude Code 的客户端核心采用闭源交付，文中只引用官方已经说明的行为。两个产品迭代都很快，工具名和配置项以后可能变化，本文更关注那些不会跟着菜单一起变的架构关系。

<strong>本文的定位</strong>：这不是 Claude Code 和 Codex 的功能清单，而是借两个成熟产品回答一个工程问题：如果我们自己做 Agent，模型外面到底要搭什么。Prompt、RAG、推理和通用评测见姊妹篇[《大模型工程指南》](/llm-engineering-guide)。

:::

只看最小 demo，Agent 无非就是一个循环：把 Prompt 和工具定义发给模型，执行模型返回的 tool call，再把结果传回去。十几行代码就能跑。

但一项任务如果要持续几十轮，中途允许用户补要求，命令可以进后台，历史太长还要压缩，问题就变了。系统需要知道当前做到哪一步、哪些事实必须留下、一次工具调用能碰什么、异常退出以后从哪里接着跑。Claude Code 和 Codex 这类产品真正花工程量的地方，大多在模型外面的 Harness。

整篇文章沿着一条任务轨迹往下走：<strong>运行时把当前事实编译成一次模型请求，模型提出下一步动作，工具在权限边界内执行，结果再写回事实账本</strong>。后面的上下文、多 Agent、沙箱和协议，都是这条循环变长以后补出来的结构。

## 一、总图：Agent 是一个受控的反馈循环

假设用户交给 Agent 一个任务：“修复登录接口偶发 500，先找原因。”运行时先登记输入，Context Builder 再从会话历史、项目规则、工具目录和当前工作区里挑出这一轮需要的内容。模型可能返回一段说明和一个 `search_code` 调用；运行时检查权限，执行搜索，把结果登记回去，然后重新编译下一次模型请求。

这个过程会反复走，直到模型给出最终回答，或者用户中断、预算耗尽、权限路径走不通。总图里最值得看的不是有多少方框，而是两条回路：上半段负责形成判断，下半段负责产生副作用并把现场更新回来。

<figure class="img-figure agent-diagram">
  <div class="agent-diagram-scroll">
    <img src="/images/agent-design-practice/runtime-architecture.svg" alt="Agent Harness 总体架构。运行时从事实账本编译模型视图，模型提出工具意图，工具在策略和沙箱边界内执行，结果再写回账本。">
  </div>
  <figcaption>图 1：Agent Harness 是一条受控的反馈循环，模型只负责提出下一步。</figcaption>
</figure>

沿这条循环，可以把 Harness 拆成五组部件：

| 部件 | 在循环里的位置 | 主要回答的问题 |
|------|----------------|----------------|
| 会话运行时 | 接住用户输入，维持 Thread / Turn / Item | 现在属于哪项任务，进行到什么状态 |
| Context Builder 与模型适配 | 每次采样前组装请求并解析输出 | 这一轮模型应该看到什么，返回了什么 |
| 工具运行时 | 注册、路由、执行并回填 tool result | 模型提出的动作怎样变成真实操作 |
| 策略、审批与沙箱 | 包住每次有副作用的调用 | 这个动作能不能做，放行后能碰到哪里 |
| 事件与协议 | 把状态变化传给 TUI、IDE、SDK 或 CI | 界面如何展示、中断、恢复和审计 |

这里有三个边界，后面的设计基本都围着它们展开。

- <strong>状态边界</strong>：Thread 保存完整事实，Model Request 只是一次采样的临时视图；
- <strong>副作用边界</strong>：模型只能提出动作，真正的文件写入、命令执行和外部调用由运行时完成；
- <strong>时间边界</strong>：用户输入、模型采样和后台进程各有自己的生命周期，不能拿一份同步消息列表硬扛。

## 二、一个 Turn 是怎么跑完的

### 2.1 Thread、Turn、Item 把工作边界划出来

Codex App Server 的公开协议把状态拆成 Thread、Turn、Item 三层，这套分法也适合拿来解释多数 Agent Runtime：

- <strong>Thread</strong> 是一段可以恢复和分叉的长期现场，里面有多个 Turn；
- <strong>Turn</strong> 对应一次用户请求，以及 Agent 为这次请求做的全部工作；
- <strong>Item</strong> 是 Turn 内的事件，比如用户消息、模型消息、工具调用、工具结果、文件修改、审批和计划更新。

Claude Code 对外更多使用 session 和 message，但要解决的状态问题接近：长期会话需要稳定 ID，一次工作要有开始与结束，中间过程还得能流式展示。产品术语可以不同，职责不能少。

用户第一次说“修复登录接口偶发 500”时，客户端创建或找到一个 Thread，运行时在其中开启 Turn 1，并追加 `user_message`。接下来每一次模型输出、工具调用和结果都落成 Item。等 Turn 1 完成，用户再说“检查注册接口有没有同类问题”，运行时在原 Thread 里开启 Turn 2，不需要另起一份失去现场的聊天记录。

### 2.2 一次采样只决定下一步

先对齐一个用词：本文说的一次采样，指一次完整的模型调用，把编译好的请求发给模型，取回一段输出，输出可能是文本、tool call，或两者兼有。叫法来自生成模型的机制，模型逐 token 从概率分布里抽取样本，一次生成过程就是一次采样。

模型通常不会一次性完成整项任务。第一次采样可能只决定搜索登录入口，第二次看到搜索结果后再读文件，第三次才修改代码。最小执行内核可以写成下面这样：

<div class="code-with-figure">
<div class="code-block-col">

```python
while turn.active:                              # Turn 仍在进行：未收尾、未中断、预算未耗尽
    # 采样前重新编译模型视图：从事实账本、工作区、工具目录和指令里挑出本轮内容
    view = context_builder.build(thread, workspace, tools, instructions)
    # 一次采样：把视图发给模型，取回输出 item（文本或 tool call，可能多个）
    output_items = model_adapter.sample(view)
    event_store.append(output_items)            # 先落账再执行：模型已产生的输出先成为事实

    calls = collect_tool_calls(output_items)    # 从输出里取出全部工具调用
    if not calls:                               # 没有工具调用 = 模型认为可以收尾
        return finish_turn(output_items.last_message)   # 最后一段文本即最终回答

    results = tool_runtime.dispatch(            # 执行工具调用
        calls,
        before=[hooks, policy, approval],       # 副作用前的拦截链：钩子 → 权限规则 → 审批
        executor=sandbox,                       # 实际执行发生在沙箱限定的边界内
        concurrency=conflict_aware,             # 冲突感知调度：只读并行，写集重叠串行
    )
    # 结果按 call_id 与调用配对，写回事实账本，成为下一次编译的输入
    event_store.append(match_by_call_id(results))
```

</div>

<figure class="img-figure agent-diagram">
  <div class="agent-diagram-scroll">
    <img src="/images/agent-design-practice/turn-loop-flow.svg" alt="执行内核流程图。编译模型视图、采样、输出先落账；没有 tool call 即收尾，有则经过拦截链在沙箱内执行，结果按 call_id 配对写回账本后回到编译，中断或预算耗尽时结束。">
  </div>
  <figcaption>图 2：执行内核一圈的完整流程，先落账、再拦截、再执行，结果按 call_id 回写。</figcaption>
</figure>
</div>

::: details 图 2 的 mermaid 源码（改图后可用 mmdc 重新渲染）

```text
flowchart TD
    START([Turn 开始]) --> BUILD["① 编译模型视图<br/>从事实账本、工作区、工具目录、指令取内容"]
    BUILD --> SAMPLE["② 采样：调用模型<br/>返回文本和/或 tool call"]
    SAMPLE --> LOG["③ 输出 item 先落账"]
    LOG --> CHECK{"④ 有 tool call？"}
    CHECK -- "没有" --> DONE(["finish_turn<br/>最后一段文本即最终回答"])
    CHECK -- "有" --> GATE["⑤ 拦截链<br/>hooks → 权限规则 → 审批"]
    GATE -- "allow" --> EXEC["⑥ 沙箱内执行<br/>只读并行、写集重叠串行"]
    GATE -- "deny / 未获批" --> REJ["拒绝原因作为 tool result"]
    EXEC --> PAIR["⑦ 结果按 call_id 配对写回账本"]
    REJ --> PAIR
    PAIR --> BUILD
    PAIR -. "中断 / 预算耗尽" .-> ABORT(["Turn 结束<br/>未自然收尾"])
```

:::

`event_store.append(output_items)` 要放在工具执行前。模型已经产生了什么调用，应该先成为事实；即使进程在工具执行中间崩了，恢复时也能知道有一条 `call-7` 没有结果。工具完成后，result 再用相同的 `call_id` 配回来。

一次响应也不一定只有一种 Item。模型可以同时返回 commentary message、reasoning summary 和多个 tool call。运行时要保留 provider 返回的必要字段，尤其是 `call_id`、item 类型、phase 和 opaque item，后续重放时不能把它们揉成一段普通文本。

### 2.3 用户插话发生在两个采样点之间

假设测试还在运行，用户补了一句：“保持公开接口稳定，再补一个回归测试。”这句话到达时 Turn 1 仍处于 active。

支持 steering 的运行时会先把输入登记成 Item，等在途工具返回，在下一个安全采样点把“最新 tool result + 用户补充 + 当前计划”一起交给模型。steering 直译是“转向”：任务行驶到一半，用户不打断执行，只补一条约束或新要求，让后续路径拐向新方向——与 interrupt（立即停下）相对。steering 输入的生效位置由运行时保证：它只会影响尚未发生的动作，已经发出的工具参数不会被半路改写。如果用户说的是“立即停下”，客户端发的是 interrupt，运行时还要分别处理模型采样、前台工具和后台进程的取消。

这几个时间点放进一张时序图会清楚一些：

<figure class="img-figure agent-diagram">
  <div class="agent-diagram-scroll">
    <img src="/images/agent-design-practice/turn-sequence.svg" alt="一个 Turn 的完整时序。用户输入先写入事件账本，每次工具结果回来后重新编译 Model View；steering 在下一个安全采样点生效。">
  </div>
  <figcaption>图 3：输入先落账，steering 在下一个安全采样点进入模型视图。</figcaption>
</figure>

“运行时已经收到输入”和“模型已经看到输入”是两件事。前者发生在事件登记时，后者发生在下一次 Context View 编译时。把这两个时间点混在一起，steering、interrupt 和异步工具都容易出现竞态。

### 2.4 后台进程有自己的生命周期

模型 Turn 结束，不代表操作系统进程一定结束。一条测试命令进入后台后会拿到 session id，之后通过轮询或事件取回输出；用户中断模型时，运行时还要决定这个进程继续、取消还是显式回收。

所以 Harness 至少要分开维护两套状态：一套是 Thread / Turn / Item，另一套是进程表。进程表里要有启动时间、命令、cwd、stdout 句柄、退出码和取消状态。否则很容易出现界面已经显示“完成”，后台测试还在占端口的情况。

### 2.5 Turn 结束也要有明确口径

一个 Turn 常见的结束方式包括：

1. 模型给出最终消息，并且没有未配对的 tool call；
2. 用户主动中断；
3. 步数、时间、token 或费用预算耗尽；
4. 权限被拒以后，模型找不到边界内的替代路径；
5. 模型服务、事件存储或工具运行时发生致命错误。

收尾时还要检查后台进程、未完成审批和临时产物。`turn/completed` 应该是运行时确认后的状态，不是客户端看见一段 final message 就自己猜出来的。

## 三、上下文工程：Thread 不等于 Prompt

上一章走完了一个 Turn 的执行循环，这一章集中在每次采样前后的上下文问题上。事实账本一直在变大，模型窗口是有限的，中间全靠 Context Builder 一次一次重新编译。整条链路是：保存完整事实，挑出当轮需要的内容编译成 Model View；窗口不够时做外置和压缩，新 Thread 开始时补进长期上下文。

### 3.1 持久事实和模型视图服务两个目标

一条 5 万行的测试日志，审计和恢复可能需要完整保留，模型这一轮只需要失败用例、错误堆栈头尾和退出码。会话压缩后，原始对话仍然在，下一次给模型的却可能只剩一份摘要和最近几个 Turn。

这里最好明确分成三份数据。先解释表里会反复出现的两个词：Event Store 是<strong>只追加的事件账本</strong>，Thread 里发生过的每件事（用户输入、模型输出、工具调用与结果、审批、文件变更）都按顺序记一条，只为追加了就不改；Derived Working State（派生工作状态）则是<strong>从账本和现场现算出来的快捷视图</strong>——当前计划、未完成项、运行中进程这些“现在进行时”的信息，全部能从账本加现场重新推导，单独维护它们只是为了免得每次都重算，丢了就丢了，重算即可。

| 数据 | 保存什么 | 主要用途 |
|------|----------|----------|
| Thread Event Store | user、assistant、tool call、tool result、审批、文件变更等事件 | 恢复、审计、UI、重放 |
| Derived Working State | 当前计划、未完成项、workspace revision、运行中进程、摘要索引 | Runtime 和 Context Builder 快速读取 |
| Model Request / Context View | 本次采样需要的 instructions、tools 和 input items | 只服务这一次模型调用 |

除此之外还有两份外部事实：完整日志和网页抓取放在 Artifact Store，代码和构建产物留在 Workspace。模型通过工具按需读取，不需要每轮把整个仓库塞进 Prompt。

<figure class="img-figure agent-diagram">
  <div class="agent-diagram-scroll">
    <img src="/images/agent-design-practice/context-view-composition.svg" alt="上下文来源与模型视图。项目指令、Thread 历史、Memory、Skills、工具目录、Artifact 和当前 Workspace 经过 Context Builder 选择后，组成一次性的 Model Request。">
  </div>
  <figcaption>图 4：Context Builder 从不同寿命的数据里选内容，编译出一次性的 Model Request。</figcaption>
</figure>

Event Store 是事实账本，Derived State 更像索引和缓存。计划可以从 plan item 重算，运行中进程可以向进程管理器核对，Git 状态也应该重新读取。恢复时不能因为摘要写着“测试通过”，就跳过对当前 diff 和测试状态的检查。

### 3.2 Thread 里的事件大体长这样

下面是一份简化结构，字段名只是为了说明关系：

```json
{
  "thread_id": "T-42",
  "items": [
    {
      "seq": 1,
      "turn_id": "turn-1",
      "type": "user_message",
      "content": "修复登录接口偶发 500，先找原因"
    },
    {
      "seq": 2,
      "turn_id": "turn-1",
      "type": "function_call",
      "call_id": "call-7",
      "name": "search_code",
      "arguments": {"pattern": "login|authenticate"}
    },
    {
      "seq": 3,
      "turn_id": "turn-1",
      "type": "function_call_output",
      "call_id": "call-7",
      "preview": "auth/login.py:88 ...",
      "artifact_ref": "artifact://T-42/call-7/full.txt",
      "truncated": false
    }
  ],
  "derived": {
    "active_plan": ["定位异常", "修改", "补测试"],
    "workspace_revision": "git:8ac31f2+dirty",
    "running_processes": [],
    "summary_ref": null
  }
}
```

`items` 按序追加，工具调用和结果靠 `call_id` 配对。大结果正文只留预览、原始大小、截断方式和 `artifact_ref`。审计以事件记录为准，`derived` 坏了可以重算。

### 3.3 Context Builder 每次都在重新编译请求

第一次采样时，Context Builder 通常从四个地方取数据：运行时规则、当前目录生效的项目指令、允许使用的工具，以及 Thread 里刚写入的用户输入。逻辑上的 Model Request 大致如下：

```yaml
model_config:
  model: coding-model
  reasoning_effort: high
  parallel_tool_calls: true

instructions:                         # 稳定区
  - runtime_contract@v7
  - project_rules@sha256:93ab...

tools:                                # 稳定区
  - search_code@schema-v3
  - read_file@schema-v2
  - apply_patch@schema-v4
  - run_command@schema-v5

input:                                # 动态尾部
  - environment: {cwd: /repo, branch: fix/login-500, sandbox: workspace-write}
  - user_message: {item_id: u-1, content: 修复登录接口偶发 500，先找原因}
```

模型返回 `function_call(call-7)`，运行时先把 output item 写进 Thread，再执行搜索，结果以 `function_call_output(call-7)` 落回账本。下一次采样前，Context Builder 重新编译：稳定区保持原样，动态尾部把这一来一回接上。

```yaml
instructions:                         # 和上一次字节级一致
  - runtime_contract@v7
  - project_rules@sha256:93ab...

tools:                                # 名称、顺序、schema 都不动
  - search_code@schema-v3
  - read_file@schema-v2
  - apply_patch@schema-v4
  - run_command@schema-v5

input:                                # 动态尾部：历史 + 新结果
  - environment: {cwd: /repo, branch: fix/login-500, sandbox: workspace-write}
  - user_message: {item_id: u-1, content: 修复登录接口偶发 500，先找原因}
  - assistant_message: {item_id: a-1, phase: commentary, content: 我先定位登录链路和异常出口。}
  - function_call: {call_id: call-7, name: search_code, arguments: {pattern: "login|authenticate"}}
  - function_call_output: {call_id: call-7, preview: auth/login.py:88 ...}
```

这就是回填结果在上下文这一侧的样子：前缀不动，尾部只追加。模型读完 `result-7`，下一轮可能返回 `read_file`，再下一次编译就在尾部接 `call-8 -> result-8`；测试运行期间用户插话补充的约束，也会出现在下一个采样点的尾部。一个 Turn 里调用十轮工具，Model View 就会编译十次。

使用 Responses API 时有两种续接方式。应用可以手工回传之前的 user、assistant、function call 和 function call output item；也可以传 `previous_response_id`，只提交新增 item，由服务端续接响应状态。后者省掉一部分应用侧重放代码，应用自己的 Event Store 仍然要服务 UI、审计、恢复和跨 provider 迁移。新的请求如果需要相同 instructions，也要显式设置。

### 3.4 同一个 Thread 里的 Model View 怎么换血

还是修复登录接口这个任务，从头到尾有三次用户输入：开头的“修复登录接口偶发 500”，测试运行中的“保持公开接口稳定，再补一个回归测试”，以及 Turn 1 结束后的“检查注册接口有没有同类问题”。三个采样点拿到的 Model View 不一样：

| Model View | 本次选择进视图的内容 | 留在 Event Store / Artifact 的内容 |
|------------|----------------------|-------------------------------------|
| 输入 1 后的首轮采样 | 运行时规则、项目指令、工具 schema、环境信息、用户输入 | 仓库文件、还没读过的历史日志 |
| 输入 2 命中后的采样 | 稳定前缀、刚返回的搜索与测试结果、steering 输入、更新后的计划 | 过期的中间推测、被截断日志的完整原文 |
| Turn 2 的首轮采样 | 稳定前缀、Turn 1 的摘要与关键 item、输入 3、重新读取的 Git 状态 | Turn 1 的流式增量、整份测试日志、已消费完的工具输出 |

稳定区基本不动，变化全在尾部，而尾部随着任务推进不断换血。到 Turn 2，上一轮几千行的测试日志已经不可能整体进视图，能进来的只有摘要、关键 item 和重新读到的现场。下一节要讲的压缩，干的就是这一步。

### 3.5 缓存解决重复计算，压缩解决窗口不够

Prompt cache 看的是连续前缀。system / developer instructions、工具 schema 和较早历史保持稳定，后面的 Request 才可能复用之前算过的前缀。工具顺序每轮变化、当前时间放在最前面、动态改写工具 description，都会让匹配提前中断。

一个常见的排列是：

```text
[Provider / hidden instructions]       稳定
[Tool definitions，顺序固定]           稳定
[Runtime + project instructions]       稳定，内容带版本号
---------------- cache boundary ----------------
[Compaction item / 较早历史]           一段时间内稳定
[最近几个原始 turn]                    只追加
[本轮 user / steering / tool result]   每次变化
```

缓存命中以后，输入 token 仍然占模型窗口。上下文满了，还是要做选择和压缩。

假设模型窗口是 128k，给输出留 16k，再留 4k 安全余量，Context Builder 的输入预算就是 108k。接近软阈值时，可以按下面的顺序处理：

1. 流式 delta、重复进度和过期 plan 折叠成当前有效 Item；
2. 大日志外置，只留失败片段、退出码和 artifact 句柄；
3. 压缩较早且已经闭合的 Turn，最近证据继续保留原文；
4. 压缩后核对硬约束、精确 ID、文件路径、决策、失败方案和待办事项。

手工维护 checkpoint 时，至少应该有 `source_range`、`goal`、`hard_constraints`、`decisions`、`completed`、`evidence`、`rejected`、`open_loops`、`next_action` 和 `workspace_revision`。官方 Responses compaction 返回的是用于模型续接的 opaque compaction item，应用侧另存一份结构化 checkpoint，会更方便审计和跨模型迁移。这两份东西用途不同，可以同时存在。

### 3.6 跨 Thread 的长期上下文：规则和 Memory 分开管

到这里为止，前面的数据都活在一个 Thread 里面。新 Thread 开始时，还会带进两类长期上下文：一类是人写的项目规则，另一类是模型从旧任务里提炼的 Memory。它们都能跨 Thread，可信度不一样。

| 长期上下文 | 典型内容 | 谁来维护 | 使用口径 |
|------------|----------|------------|----------|
| 项目规则 | 构建命令、目录说明、代码规范、必须遵守的团队约定 | 人，通过 `AGENTS.md`、`CLAUDE.md` 或 rules 文件维护 | 确定性输入，按目录和作用域加载 |
| Memory | 用户偏好、常用工作方式、旧任务里反复出现的经验 | 模型提炼，用户可以查看和控制 | 辅助召回，使用前要核对当前现场 |

Memory 落到 Harness 上，至少要定四件事：哪些内容值得写，什么时候异步提炼，编译请求时放在哪一段，过多久或者在什么条件下失效。代码改了两轮以后，“登录逻辑在 `auth/service.py`”这类记录可能已经过期，Context Builder 只能把它当线索，再去 Workspace 里核对。

Claude Code 的 auto memory 会维护单独的记忆文件，后续会话自动带上；Codex 的 local memories 会在会话空闲后从符合条件的历史里提炼，再注入后面的 Thread。必须执行的项目约定仍然应该写进 `CLAUDE.md` 或 `AGENTS.md`，不能只等 Memory 想起来。

### 3.7 按需加载：Skills、工具目录与环境信息

不是所有内容都值得常驻视图。Skills、工具目录、环境信息，三类的装载时机各不一样。

Skills 用的是渐进式加载：启动时视图里只有每个 Skill 的名称和一句 description，任务命中某个场景，对应的正文才进视图，几十个 Skill 也不会把稳定区撑大。工具目录是同一个思路：工具一多，schema 在稳定区占的字节很可观，常见的做法是先只暴露一个搜索类的元工具，命中后再把匹配工具的 schema 换进来。代价是中途换工具集合会打断缓存前缀，所以同一段任务里，进入视图的工具集合尽量保持稳定。

环境信息走另一条路。cwd、Git 分支、IDE 打开的文件这类内容，价值在新鲜，3.3 的 yaml 里 input 最上面那条 environment 就是它。它们每次编译时作为 item 进动态尾部，放错到稳定区，既打碎缓存又容易过期。

至于一段内容到底值不值得进视图，原理层的判断（信息密度、注意力稀释）在姊妹篇第四章，这一节只管 Harness 层的装载机制。

项目规则、Memory 和 Skills 最后都会变成模型可见的输入，只能影响模型怎么判断。“不要访问生产库”这类硬限制，还得由工具权限、审批和沙箱兜住。下一章就从模型提交的一次 tool call 往下看。

## 四、工具层：模型提交意图，运行时完成副作用

### 4.1 Tool schema 是一份给模型看的 API 文档

模型选择工具时，能看到的是名称、description 和参数 schema。普通函数文档里不一定要写的内容，到了工具定义里都很重要：什么时候用、什么时候别用、路径按什么口径、有没有副作用、失败如何返回、是否可以安全重试。

```json
{
  "name": "search_code",
  "description": "在当前仓库源码范围内按正则搜索文本，排除 .git 与构建产物。文件名检索交给 file_glob。返回 path、line、snippet；结果超过上限时标记 truncated。",
  "parameters": {
    "type": "object",
    "properties": {
      "pattern": {"type": "string"},
      "path": {"type": "string"}
    },
    "required": ["pattern"]
  }
}
```

如果只写一句 `search files`，模型要靠试错才知道搜索范围和返回口径，后面的 Prompt 也会不断补规则。工具 schema 和边界稳定以后，模型行为也更容易评测。

### 4.2 调用和结果是一组协议对象

一次工具调用至少要记录 `tool_name`、`call_id`、参数、发起它的 model response、权限决策和执行状态。结果无论成功、失败、超时还是被拒，都应该形成合法的 tool result。模型下一轮需要读到失败原因，不能只收到一个运行时异常。

并行调用还要声明副作用。三个只读搜索可以一起跑；两个都会修改 `package-lock.json` 的命令如果并发，最终结果会受调度时序影响。运行时可以按下面几类做冲突控制：

| 调用类型 | 常见调度方式 |
|----------|--------------|
| 纯读取，彼此独立 | 并行 |
| 访问不同外部资源，幂等 | 并行并分别重试 |
| 写不同且明确归属的文件 | 校验写集合后并行 |
| 写集合重叠或无法预判 | 串行，或放到独立 worktree |

这里不能只相信模型说“这几个调用互不冲突”。工具注册信息、路径解析和实际 diff 都可以提供更可靠的判断依据。

### 4.3 安全控制就在工具执行路径上

安全层不用另起一套循环，它包住每次副作用：

```text
model instructions          告诉模型应该怎么做，属于软约束
        ↓
policy rules / PreToolUse    按工具、参数、来源判定 allow / ask / deny
        ↓
user approval               对越界动作做一次性或会话级授权
        ↓
OS sandbox / container      限制进程真正能读、写和联网的范围
        ↓
tool executor               在边界内产生副作用，并记录结果
```

审批和沙箱是两个维度。审批回答“这次动作由谁授权”，沙箱回答“放行以后进程能碰到哪里”。审批次数少，不等于资源边界可以放宽；无人值守场景通常更需要细的文件、网络和进程限制。

网页、issue、日志、仓库里的陌生文档和 MCP 返回值都可能影响下一步工具选择。它们应该带来源标签进入数据通道，写操作在模型之外重新校验。一个外部工具如果既能读消息又能发消息，最好拆成两个权限面，不要让“总结收件箱”顺带拿到对外发送能力。

### 4.4 大结果要能截断，也要能找回来

工具结果的 token 预算应该按类型设置。测试日志可以保留头尾和错误附近，网页抓取可以按章节切块，数据库查询需要行数上限。截断时返回原始大小、截断方式、保留范围和继续读取的句柄。

一份短 preview 能控制下一轮上下文，`artifact_ref` 又保证后面可以按行号或关键词继续查。只截断不留句柄，省下的是眼前一轮 token，丢掉的是恢复和复核能力。

### 4.5 MCP、Skills 和 Hooks 插在不同位置

这三个概念容易被放在同一张“扩展能力”清单里，其实它们改的是循环里的不同部位：

- <strong>MCP</strong> 增加工具和外部数据来源，接在 Tool Runtime；
- <strong>Skills</strong> 提供按需加载的做事说明，参与 Context View 编译；
- <strong>Hooks</strong> 在工具调用、审批、压缩和 Turn 收尾等生命周期节点执行确定性逻辑。

安全规则适合放在 permission rule、PreToolUse hook 或沙箱里。Skill 可以告诉模型“提交前跑测试”，但它无法保证这条规则每次都执行；需要强制时，应该把门禁放到运行时。

## 五、多 Agent：复制执行循环，再决定共享什么

多 Agent 不是在一个上下文里同时放几个角色 Prompt。一个子 Agent 至少有自己的模型上下文和工具循环，主 Agent 通过任务包派发工作，再接收结果。真正需要设计的是哪些东西隔离、哪些东西共享。

<figure class="img-figure agent-diagram">
  <div class="agent-diagram-scroll">
    <img src="/images/agent-design-practice/multi-agent-context.svg" alt="多 Agent 的两层隔离。主线程派发任务包，子 Agent 各自运行独立上下文和工具循环；写任务是否进入独立 worktree，由文件冲突风险决定。">
  </div>
  <figcaption>图 5：先隔离 Context View，再按写冲突决定是否隔离工作区。</figcaption>
</figure>

### 5.1 上下文隔离主要解决噪声问题

搜索一百个文件、跑一大段测试、翻几十页文档，这些中间过程可以留在子 Agent 的窗口里。主线程只收结论、证据位置和未决问题。省下的是主线程的动态尾部，不一定省总 token；并行任务通常会增加模型调用总量。

一份可执行的任务包至少要有：目标、范围、文件所有权、已有事实、工具或权限边界、期望返回格式和完成条件。子 Agent 返回时带文件路径、行号、测试命令、资料链接或 artifact 句柄，主线程才能验收。只回一句“检查过了，没问题”，相当于接口没有返回值定义。

### 5.2 上下文隔离不等于文件隔离

多个 Agent 可以各有独立 Context View，却仍然读写同一份 checkout。探索、资料整理和多个只读 review 适合共享；写入边界完全分开时也可以共享，但要明确文件所有权。

并行修改同一模块时，独立 worktree 更稳。每个 Agent 在自己的 checkout 里形成 diff，主线程 review、测试后再合并。代价是依赖安装、构建缓存和磁盘占用可能重复，本地数据库、端口和外部服务也要另做隔离。

代码探索、安全 review、测试缺口和日志归因比较适合并行；同一组文件里的连续实现往往留在一个线程更省事。任务依赖很强还硬拆，时间会花在代理之间同步现场上。

## 六、把 Harness 做成一个可以接客户端的 Runtime

### 6.1 Streaming 最后会长成事件协议

模型的 token delta 只是流式的一部分。一个运行中的 Turn 还会产生 reasoning summary、tool call 参数、工具进度、文件变更、审批请求、计划更新和错误。客户端要按事件类型更新不同区域，不能把所有东西都当聊天文本。

Codex App Server 用 JSON-RPC 暴露 thread、turn、item、审批和增量事件；Claude Code 的 Agent SDK 也提供会话、流式消息、工具权限和中断能力。TUI、IDE、桌面端和 CI 可以共用下面几组接口：

| 接口组 | 最少能力 |
|--------|----------|
| 会话 | start / resume / fork / archive |
| 回合 | start / steer / interrupt / status |
| 事件 | item started / delta / completed / failed |
| 审批 | request / approve / deny / scope |
| 进程 | start / poll / cancel / exit |

无人值守模式还要约定审批失败的处理方式。CI 遇到需要新授权的动作时，默认应该返回拒绝原因，让 Agent 在原权限内找替代方案；不能因为界面上没有人点按钮，就自动换成 full access。

### 6.2 恢复不是重放一段聊天记录

恢复一个 coding agent 的现场，至少要对齐四类信息：Event Store 里发生过什么，Artifact Store 里证据还在不在，后台进程处于什么状态，Workspace 当前 revision 是否仍与 checkpoint 一致。

如果代码被用户手工改过，旧摘要仍然可以作为线索，不能继续当当前事实。恢复流程需要先读 Git 状态和关键文件，再决定哪些历史结论失效。Agent 面对的是会变化的外部世界，Event Sourcing 也无法替代现场核对。

### 6.3 评测要覆盖结果、轨迹和成本

只看最终答案，很难判断一个 Agent 是稳定完成，还是碰巧改对了。比较实用的评测分三层：

1. <strong>结果</strong>：测试是否通过，需求是否满足，代码能否构建；
2. <strong>轨迹</strong>：是否调用危险工具，是否出现无效循环，修改范围是否越界，关键证据是否被读取；
3. <strong>成本</strong>：模型调用次数、输入输出 token、工具耗时、缓存命中和人工审批次数。

SWE-bench Verified 可以看真实仓库修复能力，τ-bench 可以看多轮工具使用，团队自己的回归集负责内部任务。固定 50~100 条真实任务，把模型版本、系统指令、工具 schema、权限配置和初始仓库 commit 一起版本化，升级模型或 Harness 时跑差分。

要做可回放，外部状态也要留痕。网页、依赖源和测试数据库会变化，能固化的输入落 artifact，动态输入至少记录时间、版本和摘要哈希。回放的目标通常是还原当时为什么做出这个动作，不一定能让今天的外部系统返回一模一样的结果。

## 七、Claude Code 与 Codex：骨架接近，工程取舍不同

把前面的循环、状态和边界放回两个产品，可以看到它们的共性已经很多。差异更多体现在默认工具粒度、配置入口和公开接口上。

| 设计轴 | Claude Code | Codex |
|--------|-------------|-------|
| 运行时公开程度 | 行为和 Agent SDK 文档公开，客户端核心采用闭源交付 | Rust CLI、core 与 App Server 大量开源 |
| 工具形态 | Read / Edit / Grep 等专用工具比较显眼，同时保留 Bash | shell 与 apply_patch 承担大量本地操作，函数工具、Apps 与 MCP 补充 |
| 项目上下文 | CLAUDE.md、rules、auto memory、按需 Skills | AGENTS.md、local memories、Skills / Plugins、会话压缩 |
| 多 Agent | subagent、agent teams、独立 session / worktree | agent thread、自定义 agent、主线程编排 / worktree |
| 安全控制 | permission modes、rules、hooks、Bash sandbox | permission profiles、approval、hooks、OS sandbox |
| 对外接口 | `claude -p`、Agent SDK | `codex exec`、SDK、App Server JSON-RPC |

早期可以简单说 Claude Code 更偏结构化工具，Codex 更偏 shell。现在两边都在增加工具发现、Skills、Hooks、多 Agent、沙箱和 SDK，这个概括只能说明默认入口，不能拿来代替架构分析。

两者共用的骨架还是前面那条循环：会话运行时保存事实，Context Builder 形成当轮视图，模型提交动作意图，Tool Runtime 在安全边界内执行，事件协议把变化交给客户端和评测系统。

## 八、自建 Agent 的落地顺序

如果我们自己搭一个领域 Agent，先选一条真实任务，把下面这条链路完整跑通：

1. 定义 `thread / turn / item / tool_call / tool_result`，让每个状态有稳定 ID；
2. 接一个模型适配层，支持流式输出、结构化 tool call 和 `call_id` 配对；
3. 先做两个工具，一个只读、一个有副作用，把 allow / ask / deny 和沙箱走通；
4. 把输入、模型输出、工具耗时、权限决策和文件变更写成事件，接一个最小客户端；
5. 用 20 条真实任务做回归，等上下文确实开始膨胀，再加 artifact、缓存和 compaction；
6. 只有任务能清楚拆成独立工作包时，再引入 Skills、MCP 和子 Agent。

第一版不需要把 Claude Code 或 Codex 的所有功能都做一遍。我们先挑一个失败的 Turn，能从 user item 一路查到当时的 Model Request、permission decision、tool result、workspace revision 和结束原因，这个 Runtime 才算有了可以继续长的骨架。

## 资料来源

以下只列本文直接使用的一手资料，产品行为均以 2026 年 9 月 2 日可见版本为准：

- Anthropic：[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)、[How the agent loop works](https://code.claude.com/docs/en/agent-sdk/agent-loop)、[Tools reference](https://code.claude.com/docs/en/tools-reference)
- Anthropic：[Configure permissions](https://code.claude.com/docs/en/permissions)、[Configure the sandboxed Bash tool](https://code.claude.com/docs/en/sandboxing)、[Extend Claude Code](https://code.claude.com/docs/en/features-overview)、[How Claude remembers your project](https://code.claude.com/docs/en/memory)
- Anthropic：[Run agents in parallel](https://code.claude.com/docs/en/agents)、[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- OpenAI：[Codex 开源仓库](https://github.com/openai/codex)、[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Memories](https://learn.chatgpt.com/docs/customization/memories)、[Build skills](https://learn.chatgpt.com/docs/build-skills)、[Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- OpenAI：[Permissions](https://learn.chatgpt.com/docs/permissions)、[Sandbox](https://learn.chatgpt.com/docs/sandboxing)、[Hooks](https://learn.chatgpt.com/docs/hooks)
- OpenAI：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- OpenAI：[Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)、[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)、[Compact a response](https://developers.openai.com/api/reference/java/resources/responses/methods/compact)
