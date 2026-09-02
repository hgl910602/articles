---
title: "Agent 架构拆解：Claude Code 与 Codex 的设计"
description: "以 Claude Code 和 Codex 两个公开实现为对象，从运行时状态、模型采样与工具循环、上下文生命周期、多 Agent、权限沙箱、协议接口与评测六个角度拆解 coding agent 的工程架构。"
date: 2026-09-02
category: "大模型"
tags: [大模型, Agent, Claude Code, Codex, LLM应用, 架构设计]
---

# Agent 架构拆解：Claude Code 与 Codex 的设计

Agent Harness  |  运行时 · 工具系统 · 上下文 · 多 Agent · 权限沙箱 · 工程接口

::: info

<strong>资料口径</strong>：内容按 2026 年 9 月 2 日的公开资料整理。Codex 以官方文档和 `openai/codex` 开源仓库为主；Claude Code 的客户端核心实现采用闭源交付，文中以官方文档已经明确的行为为准。两个产品迭代都很快，工具名和配置项以后可能变化，分层和接口关系相对稳定。

<strong>本文的读法</strong>：第一章说明拆解对象，第二章给出整体架构；第三章开始逐层展开运行时、工具、上下文、多 Agent、权限沙箱和工程接口。原理背景（Prompt、RAG、推理与评测）见姊妹篇[《大模型工程指南》](/llm-engineering-guide)。

:::

## 一、定位：Coding Agent Harness

本文聚焦 Claude Code 和 Codex 背后的 coding agent 架构。模型如何在一个仓库里连续工作几十轮，工具如何接入，长对话怎么续，多 Agent 怎么隔离，危险命令怎样拦在执行前，这些能力合在一起通常叫 <strong>Agent Harness</strong>。模型负责判断下一步，Harness 负责让这一步可执行、可控制、可恢复。

Anthropic 在 agent 的经典定义里区分过 workflow 和 agent：workflow 由代码预先编排路径；agent 由模型根据现场结果决定下一步。修一个 bug 很符合后者，第一次搜索之后读哪个文件、是否修改代码、跑哪组测试，都要看刚拿到的结果。

## 二、总体架构：一条执行主链，三条控制面

一个能长期工作的 coding agent，由下面六组部件共同组成：

| 部件 | 负责什么 | 典型状态 |
|------|----------|----------|
| 交互与协议层 | 接收输入、流式展示、审批和中断 | 当前界面、客户端连接 |
| 会话运行时 | 管线程、回合、任务和生命周期 | thread / session、turn、item |
| 模型适配层 | 组装请求、流式采样、解析工具调用 | model response、usage |
| 工具运行时 | 注册、路由、执行并回填结果 | tool call、call id、tool result |
| 上下文系统 | 加载指令、控制窗口、压缩历史 | instructions、history、summary |
| 控制与观测 | 权限、审批、沙箱、hooks、trace | policy decision、event、audit log |

这六组部件同时分布在执行主链和横切控制面上。上下文系统参与每次采样前的组装；权限和 hooks 作用于每次工具调用前后；观测系统从用户输入开始一直记到回合结束。整体架构可以画成一条执行主链，加几条横切控制面。

![图 1：Coding Agent Harness 总体架构。执行主链推进任务，Context、Policy 与 Event 三条控制面覆盖每次模型采样和工具调用。](/images/agent-design-practice/runtime-architecture.svg)

下面沿着这张图逐层展开：第三章先走通 Thread、Turn、Item 和工具循环，第四章拆工具契约，第五章说明 Context View 的编译与压缩，第六、七章分别处理多 Agent 协同和安全边界，最后落到客户端接口、评测与实现顺序。

## 三、会话与执行运行时：Thread、Turn、Item 与工具循环

### 3.1 三层状态：Thread、Turn、Item

“一份只追加的消息列表”适合解释最小 demo。当前产品还需要恢复、分叉、流式展示和审计，以 Codex App Server 的公开协议为例，它把状态拆成三层：

- <strong>Thread</strong>：一段可恢复、可分叉的长期会话，里面包含多个 turn；
- <strong>Turn</strong>：一次用户请求，以及 agent 为这次请求做的全部工作；
- <strong>Item</strong>：turn 里的最小事件，比如用户消息、模型消息、命令执行、文件修改、MCP 调用和计划更新。

Claude Code 对外使用 session，也具备继续、恢复和分叉的语义。两套术语承载同一组状态职责：长期会话需要稳定 ID，一次请求需要独立的开始与结束，回合内部还要有可流式展示和可审计的细粒度事件。

再往下还有一层执行状态：后台 shell 进程。session id 表示命令已经进入后台，进程结束则由独立的生命周期事件确认；steering 和 interrupt 管理模型回合，后台进程还需要进程管理器显式回收。Harness 分开维护“会话状态”和“操作系统进程状态”，可以处理幽灵进程、结果丢失和回合提前收尾这些问题。

### 3.2 持久状态与模型上下文的职责分工

消息历史、工具调用记录和文件变更构成持久状态，模型上下文则是某一轮采样时看到的临时视图。两套数据服务于不同目标。

例如一条 5 万行的测试日志，运行时可以保留完整事件和原始产物，模型侧选择头尾截断后的 300 行；会话压缩以后，原始 thread 仍然存在，下一次送给模型的内容可能是一份摘要。<strong>持久记录追求可恢复和可审计，模型上下文追求当前这一轮够用</strong>，数据结构和保留策略本来就应该分开。

### 3.3 模型采样与工具循环

coding agent 最小内核确实很短：把上下文和工具描述发给模型，模型返回文本或工具调用，执行工具，再把结果放回去。Claude Code 官方文档把它概括成 gather context、take action、verify results 三个不断交错的阶段；Codex 的开源代码也能看到 turn runner、模型采样、并行工具执行和上下文检查之间的循环。

用伪代码压缩之后大致是这样：

```python
while turn.active:
    if context.near_limit():
        history = compact(history)

    prompt = context.build(thread, turn, tools, instructions)
    response = model.stream(prompt)
    items = response.collect_items()
    thread.append(items)

    calls = items.tool_calls
    if not calls:
        return finish_turn(items.last_message)

    results = run_in_parallel([
        tool_runtime.dispatch(call,
            before=[hooks, policy, approval],
            executor=sandbox,
            after=[hooks, trace])
        for call in calls
    ])
    thread.append(match_by_call_id(results))
```

这段代码省略了重试、超时、用户插话、取消、后台进程和子代理，产品实现的复杂度主要集中在这些分支里。

![图 2：Turn 状态机。Context Builder、模型采样、工具分发、策略与沙箱形成循环，steering 在安全采样点进入下一次模型视图。](/images/agent-design-practice/turn-sequence.svg)

### 3.4 并行工具调用需要结果配对与冲突控制

模型一次返回三个读取任务时，Harness 可以并行执行，延迟会比串行低不少。调用和结果通过 `call_id` 一一配对，每个任务的成功或失败都形成合法的 tool result，让模型拿到完整状态。运行时把异常转换成结构化结果，模型便可以根据失败原因调整路径。

并行还要处理写入顺序。三个只读调用一般可以同时跑，三个文件写入则需要冲突分析；两个命令都改 `package-lock.json`，最终结果会受调度时序影响。比较稳妥的做法是由工具声明副作用和并发属性，运行时对只读调用放开并行，对互相冲突的写操作串行化，或者把写任务分到独立 worktree。

### 3.5 Turn 的完整收尾条件

一个 turn 至少有五种结束方式：模型给出最终消息、用户主动中断、预算耗尽、权限被拒且执行路径耗尽、运行时发生致命错误。长任务还需要步数、时间、token 和费用预算，避免模型在“再搜一个文件”里转圈。

计划工具承担回合里的显式工作记忆。Claude Code 的任务清单、Codex 的 plan item 都把“已经做了什么、下一步是什么”变成结构化状态，界面能展示，模型下一轮也能读。消息循环继续负责执行，计划则支持修改和作废，让模型根据环境变化更新清单。

### 3.6 Streaming 承载运行时事件协议

流式响应里会交错出现文本增量、推理摘要、工具调用参数、工具执行进度、文件变更和审批请求。客户端按事件类型更新不同区域，并在 turn 进行中接收 steering 输入。

Codex App Server 把这套语义公开成 JSON-RPC：`thread/start`、`turn/start`、`item/started`、`item/completed`、`turn/completed`。Claude Code 的 CLI 和 Agent SDK 也提供流式消息。到了这一层，TUI、IDE、桌面端和 CI 作为不同客户端，共用底下的 agent runtime。

### 3.7 多次输入的 Thread / Turn 分流

把前面的局部机制放进一个具体任务，可以看出 Thread、Turn、上下文和工具循环各自在哪一步起作用。

假设用户先说：“修复登录接口偶发 500，先找原因。”客户端把请求送进来时，这个 Thread 处于空闲状态。运行时创建 Turn 1，追加一条 user item，然后由 Context Builder 装配项目指令、历史、当前工作区状态和工具目录。模型第一次采样通常先产生搜索、读文件或跑复现命令的 tool call。工具经过权限检查和沙箱执行，结果按 call id 回填，模型再决定下一步。查原因、改文件、跑测试都属于 Turn 1，期间会经历多次模型采样。

测试仍在运行，用户又补了一句：“保持公开接口稳定，再补一个回归测试。”这次输入到达时 Turn 1 仍在运行。支持 steering 的运行时会把它追加到当前 Turn，等正在执行的工具返回，在下一次模型采样时连同最新结果一起送进去。新约束从下一个安全采样点生效，已经完成的文件修改保留原状；如果用户的意思是“立刻停下”，客户端要发 interrupt，运行时还要取消采样，并按工具类型决定是否终止后台进程。缺少 steering 能力的客户端会把这条输入排到下一 Turn，保持在途工具参数稳定。

Turn 1 完成后，用户第三次输入：“再检查注册接口是否有同类问题。”运行时发现 Thread 还在、当前活动 Turn 已经结束，于是创建 Turn 2。持久层保留 Turn 1 的消息、工具调用、测试结果和文件变更，Context Builder 从中选择项目指令、Turn 1 摘要、关键 item 和第三次输入，再读取此刻的工作区状态，拼出 Turn 2 的模型视图。模型因此知道登录接口刚改过，上一轮几千行日志则留在 artifact store。

![图 3：同一个 Thread 里的三次用户输入。运行时依据当前状态创建 Turn、追加 steering 或开启后续 Turn，并把每次变化写入事件账本。](/images/agent-design-practice/multi-turn-lifecycle.svg)

图里的三个 Context View 分别对应三个采样点。每次采样前，Context Builder 都会按当时的状态重新装配：

| 模型视图 | 本次选择的内容 | 留在 Event Store / artifact 的内容 |
|----------|----------------|-------------------------------------|
| `v1` | 运行时规则、当前目录生效的项目指令、可用工具 schema、输入 1、工作目录与权限信息 | 仓库文件、待读取的历史日志 |
| `v1.1` | `v1` 的稳定部分、刚返回的搜索与测试结果、输入 2、更新后的计划、当前 diff 摘要 | 过期的中间推测、被截断日志的完整原文 |
| `v2` | 运行时规则、项目指令、输入 3、Turn 1 摘要与关键 item、此刻重新读取的代码和 Git 状态 | Turn 1 的流式增量、几千行测试日志、已经消费完的工具输出 |

工具结果在下一次采样时仍作为输入的一部分；再往后，Context Builder 可能只保留结论、文件位置和错误行，把完整结果留在 artifact store。项目代码按需进入模型视图，模型看到工具刚读出来的片段，以及 Harness 额外注入的工作目录、Git 状态等元数据。

三次输入的分流规则可以压成一张表：

| 输入到达时的状态 | 运行时动作 | 何时进入模型上下文 |
|------------------|------------|--------------------|
| 首次请求 | 创建 Thread 和第一个 Turn | 第一次采样 |
| Thread 空闲 | 在原 Thread 下创建新 Turn | 新 Turn 第一次采样 |
| Turn 正在运行，用户补充要求 | steer 当前 Turn，或排队到下一 Turn | 下一个安全采样点 |
| Turn 正在运行，用户要求停止 | interrupt Turn，并处理在途工具与后台进程 | 结束常规采样 |
| 用户要保留现场并尝试另一条路 | fork Thread | 分叉后的新 Turn |

“请求已经收到”和“模型已经看到”对应两个时间点。输入先由运行时登记成事件，再在下一次采样时进入模型视图；工具执行期间到达的新输入会排到下一个安全采样点。Thread 保存长期现场，Turn 划定一次工作的边界，Item 记录中间事件，Context Builder 在每个采样点重建当前视图，多次请求由这四个部件共同分流。

## 四、工具层：Schema 契约与副作用执行

两个产品还在持续增加内置工具，下面按稳定的职责维度来分：

| 职责 | Claude Code 代表性入口 | Codex 代表性入口 |
|------|----------------------|------------------|
| 文件读取与检索 | Read / Grep / Glob / LSP | shell、代码检索与本地函数工具 |
| 文件修改 | Edit / Write / NotebookEdit | apply_patch、shell |
| 命令执行 | Bash / PowerShell | exec_command / write_stdin |
| 网络与外部系统 | WebSearch / WebFetch / MCP | Web Search、Apps / MCP |
| 任务组织 | Agent、任务清单 | subagents、update_plan |
| 按需知识 | Skill | Skills / Plugins |

Claude Code 倾向于把高频动作做成专用工具：Read 能分页，Edit 有结构化参数，Grep 和 Glob 的输入边界清楚。Codex 更偏混合路线，shell 承担大量通用操作，`apply_patch`、计划、子代理和各类连接器再用专用函数补齐。两条路线的差别主要落在三个地方：

- 专用工具更容易校验参数、限制副作用，也更容易给 UI 做结构化展示；
- 通用 shell 能直接复用现有命令生态，工具面更小，相应增加安全分析和跨平台兼容成本；
- 工具 schema 本身占上下文，专用工具越多，发现和按需加载越重要。

### 4.1 Tool schema 是给模型看的 API 文档

对普通代码来说，函数名、参数类型和返回值差不多够了；模型还需要从 description 里读到使用时机、适用边界、路径口径和失败结果。下面两个 schema 都能执行搜索，第二个给出的选择依据更完整：

```json
{
  "name": "search",
  "description": "search files"
}
```

```json
{
  "name": "search_code",
  "description": "在当前仓库的源码范围内按正则搜索文本，搜索范围排除 .git 与构建产物。文件名检索交给 file_glob。返回 path、line、snippet，结果超过上限时明确标记 truncated。"
}
```

第二个描述把选择条件、边界和结果契约都交代了。工具定义越模糊，后续 prompt 需要补充的规则就越多。

### 4.2 MCP、Skills 和 Hooks 对应三层扩展职责

这三个概念分别落在能力接入、任务说明和生命周期控制三个层面：

- <strong>MCP</strong> 接外部能力和数据。server 暴露 tools、resources、prompts，agent 作为 client 做发现和调用；
- <strong>Skills</strong> 给模型一套按需加载的做事说明，正文通常是 `SKILL.md`，用现有工具完成流程；
- <strong>Hooks</strong> 在生命周期节点插入确定性代码，比如工具调用前校验、调用后记账、压缩前保存上下文、turn 结束时跑门禁。

说人话就是：MCP 增加“能做什么”，Skill 说明“这件事怎么做”，Hook 决定“做到这里时系统固定执行什么”。三者组合后分别负责扩展能力、指导模型和执行确定性控制。安全规则落到权限规则、PreToolUse hook 或沙箱里，由运行时强制执行。

### 4.3 工具结果要能截断，也要能找回来

文件内容、日志和网页抓取很容易一次撑满上下文。工具层要给每类结果定预算，并在截断时返回原始大小、截断方式和可继续读取的句柄。模型通过这些字段确认保留范围，再按行号或关键词读取报错位置。

常见做法是保留头尾预览，把完整结果落到临时文件或 artifact，再给一个 ranged read / grep 入口。这样模型侧拿到的是短结果，运行时侧仍然保留可恢复的原文。

## 五、上下文层：从事件存储到下一次模型请求

上下文系统分成三份数据：“系统存了什么”“运行时当前在做什么”“模型这一轮看到了什么”。三者名字接近，生命周期各自独立：

| 数据 | 保存什么 | 保存多久 | 谁使用 |
|------|----------|----------|--------|
| Thread Event Store | user、assistant、tool call、tool result、审批、文件变更等完整事件 | 跟 Thread 一样久 | 恢复、审计、UI、重放 |
| Derived Working State | 当前计划、未完成项、workspace revision、运行中进程、摘要索引 | 可以随事件重新计算 | Runtime 与 Context Builder |
| Model Request / Context View | 本次采样需要的 instructions、tools 和 input items | 一次模型请求 | 模型 |

Thread Event Store 是事实账本，Context View 是从账本、项目配置和当前工作区临时编译出来的请求。模型返回以后，View 本身可以丢，返回的 output item 要落进 Event Store；下一次采样再编译一份新的 View。

### 5.1 Thread 里具体存什么

为了把结构说清楚，下面用一份简化的 Harness schema。这份示例抽取两边公开接口里共同出现的事件类型，字段名用于说明结构：

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
      "type": "assistant_message",
      "phase": "commentary",
      "content": "我先定位登录链路和异常出口。"
    },
    {
      "seq": 3,
      "turn_id": "turn-1",
      "type": "function_call",
      "call_id": "call-7",
      "name": "search_code",
      "arguments": {"pattern": "login|authenticate"}
    },
    {
      "seq": 4,
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

`items` 一般按序追加，工具调用和结果靠 `call_id` 配对。几十万字的日志放进 artifact，事件正文保留预览、大小、截断信息和 `artifact_ref`。`derived` 里的计划和 workspace 状态是方便运行时使用的缓存，可以用事件和文件系统重算；审计则以追加写入的事件记录为准。

模型返回的内容按 output item 分开保存。一次响应可能同时包含 commentary message、reasoning summary、一个或多个 function call。Harness 按原样或等价结构归一化后落盘，完整保留 `call_id`、`phase` 和 provider 返回的 opaque item；手工管理 Responses API 历史时，这些 item 下一轮还要按原字段传回去。Harness 的保存范围以 API 明确返回的 output item 和可见摘要为准。

### 5.2 多轮 Request 的 Prompt 编译过程

还是用“修复登录接口偶发 500”这个例子。第一次采样前，Context Builder 从四个地方取数据：运行时配置、当前目录生效的项目指令、允许使用的工具，以及 Thread 里刚追加的输入 1。逻辑上的 Request 1 大致是这样：

```yaml
model_config:
  model: coding-model
  reasoning_effort: high
  parallel_tool_calls: true

instructions:                         # 稳定区
  - runtime_contract@v7               # 角色、生命周期、权限和输出协议
  - project_rules@sha256:93ab...      # AGENTS.md / CLAUDE.md 的解析结果

tools:                                # 稳定区
  - search_code@schema-v3
  - read_file@schema-v2
  - apply_patch@schema-v4
  - run_command@schema-v5

input:                                # 动态尾部
  - type: environment
    cwd: /repo
    branch: fix/login-500
    sandbox: workspace-write
  - type: user_message
    item_id: u-1
    content: 修复登录接口偶发 500，先找原因
```

模型返回 assistant message 和 `function_call(call-7)`，运行时先把两条 output item 追加到 Thread，再执行 `search_code`，最后追加 `function_call_output(call-7)`。到这里，Event Store 已经是 `u-1 -> a-1 -> call-7 -> result-7`。`result-7` 产生于本次模型响应结束之后，会在下一次采样时进入模型视图。

下一次采样时，Context Builder 再编译 Request 2：

```yaml
instructions:                         # 和 Request 1 字节级保持一致
  - runtime_contract@v7
  - project_rules@sha256:93ab...

tools:                                # 名称、顺序、description、schema 保持一致
  - search_code@schema-v3
  - read_file@schema-v2
  - apply_patch@schema-v4
  - run_command@schema-v5

input:
  - environment: {cwd: /repo, branch: fix/login-500, sandbox: workspace-write}
  - user_message: {item_id: u-1, content: 修复登录接口偶发 500，先找原因}
  - assistant_message: {item_id: a-1, phase: commentary, content: 我先定位登录链路和异常出口。}
  - function_call: {call_id: call-7, name: search_code, arguments: {...}}
  - function_call_output:
      call_id: call-7
      output: auth/login.py:88 ...
```

这就是工具循环里“回填结果”的具体含义：稳定前缀保持一致，动态尾部增加模型刚才的输出和工具结果。模型读完 `result-7`，下一次可能返回 `read_file`；文件内容回来以后，Request 3 再在尾部追加 `call-8 -> result-8`。一个 Turn 跑十轮工具调用，Context View 就会被编译十次。

如果用户在 `call-8` 执行期间补一句“保持公开接口稳定”，运行时先记一条 steering item。下一次采样的动态尾部同时出现 `result-8` 和这条新输入，模型据此调整方案。已经发出的 Request 2 保持原样。

![图 4：上下文生命周期。Thread Event Store 保存完整事实，Context Builder 编译单次模型请求，窗口预算依次触发噪声折叠、大结果外置和历史压缩。](/images/agent-design-practice/context-view-composition.svg)

::: info 两种续接方式

<strong>应用手工管理</strong>：每次把需要的 user / assistant / function call / function call output item 重新传给模型，Context Builder 的结果直接可见。

<strong>Provider 管理</strong>：Responses API 可以传 `previous_response_id`，请求里只给新增 item，由服务端续接之前的状态。这个方式减少了应用侧重放代码，Thread Event Store 继续负责 UI、审计、恢复和跨 provider 迁移。每个新请求都显式设置当前 instructions。

:::

### 5.3 稳定前缀的组成与缓存边界

Prompt cache 匹配的是模型最终渲染出来的<strong>连续前缀</strong>。后一次请求只有在前面的 token 完全一致时，才能复用之前的 KV 状态。工具 schema 改了一个 description、工具顺序换了、model 或 reasoning 配置变了，都可能让匹配提前中断。

一个比较稳的布局是：

```text
[Provider / hidden instructions]       固定
[Tool definitions，顺序固定]           固定
[Runtime + project instructions]       固定，内容带版本号
---------------- cache breakpoint ----------------
[Compaction item / 较早历史]           一段时间内稳定
[最近几个原始 turn]                    只追加
[本轮 tool result / steering / user]   每次变化
```

稳定前缀覆盖 system prompt、工具定义、项目指令和已经稳定的历史 item。Request 2 在 Request 1 后面追加 item，从开头一直到 Request 1 末尾都可能成为可复用前缀。历史越接近 append-only，后续请求能匹配的前缀通常越长。

实现时有几个细节容易把缓存打碎：工具列表来自 map，每次遍历顺序变化；当前时间、Git diff 放在 developer message 的最前面；每轮重写一遍项目指令；为了“更相关”动态改工具 description。动态环境信息适合放到尾部，工具定义做确定性排序，规则文件解析后按内容哈希版本化。工具数量太大时再做延迟加载，同一段任务内则保持工具集合稳定。

缓存减少相同前缀的重复计算，context window 仍按完整输入计量。命中的 10 万 token 仍然占用本次请求的窗口。

### 5.4 长上下文的分级压缩策略

假设模型窗口是 128k，我们给输出留 16k，再留 4k 安全余量，Context Builder 的输入预算就是 108k。这是一个算例，实际数值由模型和任务共同决定。编译后的请求接近软阈值时，Context Builder 先处理传输噪声和大体积结果，再进入历史压缩。

第一步是<strong>去传输噪声</strong>。流式 delta 在 Event Store 里可以保留，模型侧选择 completed item；同一条命令的进度更新折叠成最终状态；View 选择当前生效的计划。

第二步是<strong>把大结果外置</strong>。一份 4 万 token 的测试日志，Context View 保留失败用例、错误堆栈头尾、exit code 和 `artifact_ref`。后面如果要查中间某行，模型再 grep artifact。代码文件保留路径、revision 和当时引用的关键片段，修改后按需重新读取。

前两步做完仍然超预算，再压较早、已经完成的 turn。手工压缩采用结构化摘要，至少保留下面这些字段：

```json
{
  "summary_id": "cmp-3",
  "source_range": ["item-1", "item-82"],
  "goal": "修复登录接口偶发 500，并保持公开接口稳定",
  "hard_constraints": ["LoginResponse schema 保持原样", "回归测试纳入交付"],
  "decisions": [
    {"decision": "在 auth service 内处理空 token", "reason": "避免影响 controller contract"}
  ],
  "completed": [
    {"file": "auth/service.py", "change": "增加空 token 分支", "result": "targeted test passed"}
  ],
  "evidence": [
    {"item_id": "item-51", "artifact_ref": "artifact://T-42/test-4.txt"}
  ],
  "rejected": [
    {"approach": "修改 LoginResponse", "reason": "用户要求公开接口保持稳定"}
  ],
  "open_loops": ["注册接口是否有同类问题"],
  "next_action": "检索 register flow 并对照 auth service",
  "workspace_revision": "git:8ac31f2+dirty"
}
```

压缩完成以后，Event Store 继续完整保留 `item-1 ... item-82`。下一次模型请求改成：

```text
稳定前缀
  + compaction item cmp-3
  + 最近未压缩的 item-83 ... item-104
  + 当前用户输入 / tool result
```

官方 Responses compaction 返回用于继续会话的 opaque compaction item，应用按原样回传。如果我们需要可审计、可跨模型迁移的摘要，就在 Harness 侧另外维护上面这种结构化 checkpoint。两者可以同时存在，一个服务模型续接，一个服务工程恢复。

压缩之后再做一次恢复检查：逐项核对硬约束、精确的文件路径、错误码、外部 ID 和待办事项。文件系统是 coding agent 的现场，摘要写着“测试已通过”，下一个 Turn 仍然要看一下 Git diff 和测试状态。压缩适合放在一个工具密集阶段结束之后，按预算阈值触发。

把上面的过程合到一起，Context Builder 的主干大致如下：

```python
def build_model_request(thread, current_items, model_profile):
    stable_prefix = render_stable_prefix(
        provider=model_profile.provider,
        tools=sort_tools(model_profile.allowed_tools),
        runtime_rules=load_runtime_contract(),
        project_rules=resolve_rules(thread.cwd),
    )

    history = load_compaction_item(thread.summary_ref)
    recent = select_recent_items(thread.items)
    dynamic_tail = [history, *recent, *current_items]

    request = render(stable_prefix, dynamic_tail)
    if estimate_tokens(request) > thread.input_budget.soft_limit:
        dynamic_tail = prune_deltas_and_spill_artifacts(dynamic_tail)
        request = render(stable_prefix, dynamic_tail)

    if estimate_tokens(request) > thread.input_budget.hard_limit:
        checkpoint = compact_closed_turns(thread)
        recent = items_after(checkpoint.source_range)
        request = render(stable_prefix, [checkpoint, *recent, *current_items])

    assert_tool_calls_have_results(request)
    assert_hard_constraints_present(request)
    return request
```

### 5.5 指令分层管理作用域，权限系统负责强制执行

Claude Code 用 `CLAUDE.md`、`.claude/rules/` 和 auto memory 管项目与个人上下文；Codex 用全局和项目内的 `AGENTS.md` 形成指令链。两边的目录加载时机有差别：Claude Code 可以在读到子目录文件时按需加载对应规则；Codex 当前文档写得很明确，启动时从项目根走到当前工作目录，逐层拼接一次。

这类文件适合放构建命令、代码规范、目录边界和团队约定，作为模型输入参与每轮决策。生产库访问、目录写入和网络连接等硬限制，则由权限规则和沙箱强制执行。

上下文还有一个减压办法是隔离。高噪声检索、全量测试和资料翻阅放进子代理，主线程只收任务结论、证据位置和未决问题。它减少的是主线程的动态尾部，具体的文件隔离问题放到下一章讲。

## 六、多 Agent：上下文、任务与工作区的协同隔离

按当前版本看，两边都已经具备多 Agent 能力。Claude Code 的 Agent 工具可以启动带独立上下文、工具白名单、模型和权限配置的 subagent；Codex 会创建 agent thread，主线程负责派发、等待、steer 和汇总结果，自定义 agent 也可以选择不同模型与指令。

![图 5：多 Agent 协同隔离。任务契约管理协作，子线程隔离上下文，worktree 隔离文件写入，主线程负责证据验收和合并。](/images/agent-design-practice/multi-agent-context.svg)

### 6.1 多 Agent 主要解决三件事

<strong>上下文隔离</strong>。搜索一百个文件、跑一大段测试、翻几十页文档，这些中间过程留在子代理的独立窗口，主线程接收结论和证据位置。

<strong>并行执行</strong>。安全审查、测试缺口和维护性 review 相互独立，可以同时跑。串行本来要 30 分钟，三个代理各跑 10 分钟，墙上时间会短很多，同时会增加 token 总量。

<strong>能力收窄</strong>。纯检索 agent 配置 Read、Grep；测试 agent 配置命令执行和只读文件系统；实现 agent 配置修改权限。角色 prompt 表达行为偏好，工具白名单和权限落实执行边界。

### 6.2 上下文隔离与文件隔离分层实现

多个 agent 默认可能仍然共享同一个工作目录。它们各自拥有独立上下文，同时访问同一份文件系统。读多写少的任务可以直接共享；并行写同一模块时，需要处理冲突、覆盖和测试结果漂移。

worktree 是更稳的写隔离：每个 agent 在独立 checkout 里修改，最后由主线程 review 和合并。代价也很直接，依赖安装、构建缓存和磁盘占用都会重复，跨 worktree 的数据库或本地服务仍然需要额外隔离。

### 6.3 委派消息本身是一份接口

一份能稳定执行的任务包包含目标、范围、文件所有权、已有事实、预期返回格式和完成条件。子代理返回时带上结论、文件路径、行号、测试命令或资料链接，主线程据此验证。

代码探索、独立 review、测试、日志归因和资料整理适合并行；同一组文件里的连续实现通常留在一个线程。依赖很强的任务拆得太碎，代理之间会反复同步，协调成本也会随之上升。

## 七、权限与沙箱：指令、判断和强制边界要分开

Agent 从“能聊天”走到“能改机器”，安全架构至少要拆成四层：

```text
模型指令：告诉模型应该怎么做                         软约束
      ↓
权限规则 / Hooks：按工具、参数和策略判定 allow / ask / deny
      ↓
用户审批：对越界动作做一次性或会话级授权
      ↓
OS 沙箱 / 容器：限制进程真正能读、写和联网的范围       硬边界
```

模型指令约束行为方向，权限规则和 hooks 判定具体调用，用户审批处理越界授权，沙箱控制进程实际可触达的范围。四层一起工作，网页里的注入文本即使影响模型判断，危险调用仍会经过策略判定，命令的读写范围也受沙箱约束。

![图 6：安全控制面。一次工具调用依次经过模型指令、策略与 Hooks、用户审批和 OS 沙箱，外部内容统一进入数据通道，所有决策写入审计轨迹。](/images/agent-design-practice/security-boundaries.svg)

### 7.1 审批和沙箱是两个正交维度

审批定义动作的授权流程，沙箱定义放行后的资源边界。Codex 当前把本地沙箱分成 `read-only`、`workspace-write` 和 `danger-full-access` 等模式，审批策略再单独配置；默认网络关闭，工作区内的常规操作可以在边界内自动执行，越界时再触发审批。

Claude Code 当前也有 Bash sandbox，用 macOS Seatbelt、Linux / WSL2 的隔离机制限制文件和网络；permission mode 另行决定人工确认、接受编辑、plan、auto、dontAsk 或 bypass。现在两家都采用“策略 + 审批 + 隔离”的组合，配置入口和默认档位各有差异。

| | 人工审批较多 | 自动执行较多 |
|---|---|---|
| <strong>只读边界</strong> | 敏感仓库探索 | 自动分析、索引和 review |
| <strong>工作区可写</strong> | 逐步确认修改 | 常规本地开发 |
| <strong>隔离容器 / VM</strong> | 高风险实验 | 无人值守任务 |
| <strong>宿主机无边界</strong> | 只在确有需要时临时放行 | 人工维护的临时模式 |

这张表用于部署时选择风险档位，各家产品菜单可以映射到相应格子。审批频率越低，沙箱边界需要做得越细。

### 7.2 Hooks 适合做确定性门禁和审计

Claude Code 和 Codex 现在都有生命周期 hooks。比较常用的几个点是：

- `PreToolUse`：命令执行前扫描危险参数，阻断或改写输入；
- `PermissionRequest`：审批弹出前接企业规则引擎；
- `PostToolUse`：记录结果、做格式校验或增量扫描；
- `PreCompact / PostCompact`：压缩前保存结构化状态，压缩后补回必要上下文；
- `Stop / SubagentStop`：回合结束前跑测试门禁或检查交付物。

Hook 本身也是可执行代码，需要按代码资产管理。项目内 hook 要经过信任确认，企业托管的 hook 要固定来源和权限，输出进入模型上下文时还要限制大小。安全插件装得越多，启动链路和上下文污染也越值得查。

### 7.3 外部内容统一进入数据通道

网页、issue、日志、MCP 返回值和仓库里的陌生文档都有可能夹带 prompt injection。来源标签帮助模型判断，最小权限负责执行层防护：读网页的 agent 使用只读能力，查数据库的工具默认只读，写操作要求明确参数和幂等键，高风险动作在模型之外重新校验。

如果一个外部工具既能读消息又能发消息，最好拆成两个权限面；否则一次“帮我总结收件箱”就顺带获得了对外发送能力。

## 八、工程化接口：Runtime 服务多类客户端

两个产品都已经把 Harness 从终端界面下面拆了出来。Claude Code 可以用 `claude -p` 做非交互运行，也可以通过 Python / TypeScript Agent SDK 拿到同一套工具循环、上下文和审批回调。Codex 有 `codex exec`、SDK 和 App Server；App Server 用 JSON-RPC 暴露 thread、turn、item、审批和增量事件，IDE 或自己的客户端都能接。

### 8.1 给上层系统的接口至少要有四组

| 接口组 | 最少能力 | 为什么需要 |
|--------|----------|------------|
| 会话 | start / resume / fork / archive | 长任务恢复、分支探索 |
| 回合 | start / steer / interrupt / status | 支持用户中途补充和取消 |
| 事件 | item started / delta / completed / failed | UI 渲染、trace、审计 |
| 审批 | request / approve / deny / scope | 把权限决策交给人或策略服务 |

无人值守模式还要规定审批失败的处理方式。CI 遇到需要新授权的动作时，默认返回失败原因给 agent，并保持原有权限范围。

### 8.2 评测覆盖结果与完整轨迹

coding agent 的最终答案需要与测试记录、文件 diff 和工具轨迹相互验证。评测至少分三层：

1. <strong>结果</strong>：测试是否通过，需求是否满足，代码能否构建；
2. <strong>过程</strong>：是否调用了危险工具，是否出现无效循环，修改范围是否越界；
3. <strong>成本</strong>：模型调用次数、输入输出 token、工具耗时、人工审批次数。

SWE-bench Verified 适合看真实仓库修复能力，τ-bench 适合看多轮工具使用，团队自己的回归集则负责验证内部任务。固定 50~100 条真实任务，把模型版本、系统指令、工具 schema、权限配置和初始仓库 commit 一起版本化，升级模型或 Harness 时跑差分。

要做到可回放，还得记录外部状态。网页内容、依赖源和测试数据库都会变化，prompt 和 tool call 需要配合当时的环境信息。能固化的输入落 artifact，动态输入至少记录时间、版本和摘要哈希。

## 九、两种实现放在一起看

早期可以把 Claude Code 概括成“结构化工具优先”，Codex 概括成“shell 优先”。现在两边都在补齐工具发现、Skills、hooks、多 Agent、沙箱和 SDK，差异逐渐收敛到工具粒度、默认策略和开放接口。

| 设计轴 | Claude Code | Codex |
|--------|-------------|-------|
| 运行时公开程度 | 行为和 SDK 文档公开，客户端核心采用闭源交付 | Rust CLI、core 与 App Server 大量开源 |
| 工具形态 | Read / Edit / Grep 等专用工具更显眼，同时保留 Bash | shell 与 apply_patch 是主入口，也有大量本地函数、Apps 与 MCP 工具 |
| 上下文规则 | CLAUDE.md、rules、auto memory、按需 Skills | AGENTS.md、memory、Skills / Plugins、会话压缩 |
| 多 Agent | Agent 工具、自定义 markdown agent、worktree 隔离 | agent thread、自定义 agent 配置、主线程编排 |
| 控制面 | permission modes、rules、hooks、Bash sandbox | permission profiles / approval、hooks、OS sandbox |
| 对外接口 | `claude -p`、Agent SDK | `codex exec`、SDK、App Server JSON-RPC |

两者共用的骨架可以压成下面五条：

```text
一套可恢复的会话与回合状态
  × 一个模型采样与工具结果回填循环
  × 一组带契约、权限和执行环境的工具
  × 一套不断重建模型可见内容的上下文系统
  × 覆盖全链路的审批、沙箱、事件和评测
```

### 9.1 自建 Agent 的最小落地顺序

如果我们自己搭一个领域 Agent，可以先让一条真实任务轨迹完整跑通，再逐步扩展工具和子代理：

1. 定义 `thread / turn / item / tool_call / tool_result`，先把状态落稳；
2. 接一个模型，支持流式输出和 call id 配对；
3. 只做两个工具，一个只读、一个有副作用，把 allow / ask / deny 和沙箱走通；
4. 把每轮模型输入、输出、工具耗时和权限决策记成 trace；
5. 用 20 条真实任务做回归，再根据结果引入压缩、Skills、MCP 和子代理。

这条链路里，状态模型和安全边界要先落稳，工具可以按任务逐步增加。先把一次失败的任务完整还原出来，后面再谈 autonomous 能跑多久。

## 资料来源

以下只列本文直接使用的一手资料，产品行为均以 2026 年 9 月 2 日可见版本为准：

- Anthropic：[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)、[Tools reference](https://code.claude.com/docs/en/tools-reference)、[Create custom subagents](https://code.claude.com/docs/en/sub-agents)
- Anthropic：[Configure permissions](https://code.claude.com/docs/en/permissions)、[Configure the sandboxed Bash tool](https://code.claude.com/docs/en/sandboxing)、[Extend Claude with skills](https://code.claude.com/docs/en/skills)
- Anthropic：[Run Claude Code programmatically](https://code.claude.com/docs/en/headless)、[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- OpenAI：[Codex 开源仓库](https://github.com/openai/codex)、[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- OpenAI：[Sandbox](https://learn.chatgpt.com/docs/sandboxing)、[Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)、[Hooks](https://learn.chatgpt.com/docs/hooks)
- OpenAI：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- OpenAI：[Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)、[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)、[Compact a response](https://developers.openai.com/api/reference/java/resources/responses/methods/compact)
