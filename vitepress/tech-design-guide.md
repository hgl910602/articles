---
title: "技术方案设计指南：从架构演进到领域建模"
description: "从架构演进史讲起，经过 CRUD、MVC、三层架构等方法论，深入 DDD 战略与战术设计，最后落到如何写好一份技术方案。电商交易场景 + Java 代码示例。"
date: 2026-08-12
category: "架构设计"
tags: [架构, DDD, 技术方案, Java]
---

# 技术方案设计指南：从架构演进到领域建模

电商交易场景  |  Java 代码示例

::: info

**姊妹篇：**[《领域建模实践：统一客户平台、资质中心与四色建模》](/domain-modeling-practice)以完整业务案例继续展开本文的 DDD 与四色建模方法，适合在阅读第三章后作为实践篇对照阅读。

**本文的定位**：很多研发在接到需求后，第一反应是"建表 → 写接口 → 联调上线"，很少思考"为什么这样设计"。代码能跑，但难以维护、难以扩展、难以交接。本文的目标是建立**架构思维**——在写第一行代码之前，先想清楚系统该怎么组织。

**本文的叙事方式**参考了《凤凰架构》的思路：先讲"是怎么走到今天这一步的"（架构演进史），再讲"具体该怎么做"（CRUD → MVC → DDD 及更广阔的方法论版图），最后深入领域驱动设计——这是本文的重头戏。

:::

> **阅读建议：** 对架构没有概念的读者，建议从头读到尾。已了解 MVC 的读者，可以直接跳到[第三章](#第三章-领域驱动设计-ddd)。每章都有代码示例。

## 第一章：架构演进史

回顾历史有助于理解今天的架构选择。架构风格并不是简单地一代替代一代，而是在不同业务目标、质量属性、组织结构和技术条件下形成并长期共存。本章沿着一条简化的时间线介绍几个代表性阶段。

### 1.1 软件架构的本质

在开始之前，需要先明确一个问题：**软件架构到底是什么？**

IEEE 给过一个定义：

> 架构是系统在其所处环境中的*基本概念或属性*，体现在其*元素*、*关系*，以及其*设计与演进的原则*中。

简单来说：**架构是把系统拆成几块、每块干什么、块和块之间怎么打交道，以及为什么要这么拆。**

比"拆成几块"更重要的是——**为什么要拆？** 一个核心目标是：

#### 控制复杂性

业务复杂度增长是重要动力，但不是唯一来源；性能、可靠性、安全、合规、成本和团队协作等质量属性，也会推动架构调整。

- 代码从 100 行涨到 10000 行 → 需要分层
- 团队从 1 人涨到 50 人 → 需要拆分服务
- 用户从 100 涨到 100 万 → 需要分布式

后续每一种架构风格，都源于这个动因。

---

### 1.2 原始单体时代

回到 2000 年代初。假设一家电商公司，负责订单系统。业务很简单：用户下单、查看订单、取消订单。

代码大概长这样：

```java
// 📛 典型的"大泥球"（Big Ball of Mud）
public class OrderSystem {

    // 下单
    public void placeOrder(String userId, List<String> productIds, String address) {
        // 1. 查用户
        Connection conn = DriverManager.getConnection("jdbc:mysql://...");
        PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?");
        ps.setString(1, userId);
        ResultSet rs = ps.executeQuery();
        // ... 一堆校验逻辑

        // 2. 查商品、算价格
        BigDecimal totalPrice = BigDecimal.ZERO;
        for (String pid : productIds) {
            ps = conn.prepareStatement("SELECT * FROM products WHERE id = ?");
            ps.setString(1, pid);
            rs = ps.executeQuery();
            // ... 累加价格

            // 3. 扣库存
            ps = conn.prepareStatement("UPDATE products SET stock = stock - 1 WHERE id = ?");
            ps.setString(1, pid);
            ps.executeUpdate();
        }

        // 4. 创建订单
        String orderId = UUID.randomUUID().toString();
        ps = conn.prepareStatement("INSERT INTO orders (id, user_id, total_price, address) VALUES (?, ?, ?, ?)");
        // ...

        // 5. 发短信通知
        SmsClient.send(userId, "您的订单已创建");

        // 6. 记日志
        logger.info("订单创建成功: {}", orderId);
    }

    // 取消订单、查询订单... 每个方法都是同样的"一锅端"
}
```

这段代码能跑，而且在**初期非常好用**——逻辑集中、一目了然、不需要跳来跳去。

但好景不长。随着业务增长：

<table>
<tr><th>问题</th><th>表现</th></tr>
<tr><td>代码膨胀</td><td>一个类从 200 行涨到 5000 行，找个方法要 Ctrl+F 半天</td></tr>
<tr><td>职责混乱</td><td>SQL 查询、业务逻辑、发短信、记日志全混在一个方法里</td></tr>
<tr><td>修改扩散</td><td>改一个短信模板，要在 10 个地方找短信发送的代码</td></tr>
<tr><td>无法测试</td><td>方法里直接 new 数据库连接，没法 Mock，只能连真数据库测</td></tr>
<tr><td>协作冲突</td><td>5 个人同时改这个文件，Git 合并冲突到怀疑人生</td></tr>
</table>

这就是"大泥球"（Big Ball of Mud）反模式。其核心问题是：**没有分离关注点**。

::: tip

**没有通用行数阈值：** 是否需要拆分，应看职责是否混杂、变化是否相互影响、测试与协作是否困难，而不是用“单文件 500 行”作为架构分界线。几十行代码也可能设计混乱，几百行的内聚模块也可能合理。

:::

---

### 1.3 分层架构的诞生

大泥球的问题催生了一个朴素的想法：**把不同关注点的代码放到不同的层里**。这就是分层架构。

1979 年，Trygve Reenskaug 在 Smalltalk 项目中提出了 **MVC（Model-View-Controller）**，用于分离交互界面中的模型、视图和控制逻辑。三层架构则从表现、业务和数据访问等职责组织系统；二者都体现关注点分离，但三层架构并不是由 MVC 直接演化而来，也不能视为同一种模式。

```text
┌─────────────────────────────────────────┐
│         表现层 (Presentation)              │  ← 处理 HTTP 请求/响应、参数校验
│    Controller / View / API               │
├─────────────────────────────────────────┤
│         业务逻辑层 (Business Logic)        │  ← 核心业务规则
│    Service / Domain Logic                │
├─────────────────────────────────────────┤
│         数据访问层 (Data Access)           │  ← 数据库操作
│    DAO / Repository / Mapper             │
├─────────────────────────────────────────┤
│         数据库 (Database)                 │  ← MySQL / Redis
└─────────────────────────────────────────┘

  规则：上层依赖下层，下层不知道上层存在
```

传统分层常采用**单向依赖**：上层调用下层，下层不反向依赖上层。边界设计良好时，更换数据库可以把大部分改动限制在数据访问层；如果业务代码依赖特定 SQL、事务语义或数据库能力，上层仍可能需要调整。

第二章会详细讲 CRUD 和 MVC 的具体写法，这里先了解它的历史定位。

::: info

**分层的价值：** 分层的核心价值是**隔离关注点与变化**。不同系统中各层的变化频率并不固定；关键是让一种变化尽量少穿透无关边界。

:::

---

### 1.4 面向服务架构（SOA）

随着系统继续增长，单个应用即使分了层，也变得越来越大。于是人们想到了另一个办法：**把大应用拆成多个服务**。

这就是 **SOA（Service-Oriented Architecture，面向服务架构）**。它用具有明确契约的服务暴露业务能力，让不同系统和所有权边界下的能力能够组合与复用。SOA 是技术无关的架构范式；SOAP、WSDL 和 ESB 只是企业实践中曾经常见的一组实现选择。

```text
                    ┌──────────┐
                    │   ESB    │  ← 一种常见集成实现，并非 SOA 必需
                    │  总线     │
            ┌───────┴────┬─────┴───────┐
            │            │              │
     ┌──────┴──┐  ┌──────┴──┐  ┌───────┴──┐
     │ 订单服务  │  │ 用户服务 │  │ 商品服务  │
     └─────────┘  └─────────┘  └──────────┘

  常见历史实现：SOAP / XML / WSDL；也可以采用其他协议与集成方式
```

一些企业级 SOA 落地方案暴露出较高的治理和平台复杂度：

- 采用 SOAP/XML 时，契约和消息处理成本可能高于轻量协议
- 把编排、转换和治理过度集中到 ESB 时，容易形成瓶颈与团队依赖
- 集中治理流程过重时，接口演进速度会下降
- 服务边界如果只按技术系统切分，内部仍可能形成巨型单体

这些问题针对的是特定 SOA 实现，而不是 SOA 定义本身。SOA 在银行、电信和大型企业集成中长期使用；互联网系统后来更偏好独立部署、自动化交付和去中心化治理的微服务实践。

---

### 1.5 微服务架构

2014 年，James Lewis 和 Martin Fowler 的《Microservices》系统总结了当时逐渐成形的**微服务架构**特征；该风格没有唯一、精确的定义。

微服务延续了面向服务的思想，更强调独立部署、围绕业务能力组织、基础设施自动化和去中心化治理。下面比较的是常见实践倾向，不是两种架构的硬性定义：

<table>
<tr><th>维度</th><th>SOA</th><th>微服务</th></tr>
<tr><td>服务契约</td><td>常强调企业级标准与跨组织集成</td><td>常采用轻量 API 或消息契约</td></tr>
<tr><td>集成治理</td><td>可能集中在 ESB 或统一治理平台</td><td>倾向智能端点、简单通道和团队自治</td></tr>
<tr><td>服务边界</td><td>粒度可大可小，强调能力复用</td><td>通常围绕业务能力与独立演进划分</td></tr>
<tr><td>数据管理</td><td>可共享或独立，取决于具体架构</td><td>倾向服务拥有数据，避免跨服务直接读表</td></tr>
<tr><td>部署方式</td><td>不作统一规定，历史项目常集中发布</td><td>强调服务可独立部署</td></tr>
<tr><td>技术栈</td><td>历史上常统一选型</td><td>允许异构，但也要控制运维成本</td></tr>
</table>

```text
  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
  │ 订单服务  │  │ 商品服务  │  │ 用户服务  │  │ 支付服务  │
  │  Java    │  │   Go    │  │ Python  │  │  Java   │
  │ MySQL    │  │ MySQL   │  │  Redis  │  │ MySQL   │
  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
       │              │              │              │
       └──────────────┴──────┬───────┴──────────────┘
                             │
                    ┌────────┴────────┐
                    │  API Gateway    │  ← 统一入口、路由、限流
                    └─────────────────┘
```

微服务带来的好处是显而易见的：

- **独立部署**：改了支付服务，只发布支付服务，不影响商品服务
- **故障隔离**：合理设计降级与缓存后，局部故障不必让所有功能同时失效
- **团队自治**：不同团队负责不同服务，减少协作摩擦
- **弹性伸缩**：大促时只扩容订单服务和支付服务

但代价也很沉重——**分布式系统的问题全部涌了进来**：

::: warning

**微服务的"七宗罪"：**

- **分布式事务**：下单扣库存+扣余额，跨服务怎么保证一致性？
- **服务发现**：服务实例动态变化，怎么找到对方？
- **链路追踪**：一个请求经过 8 个服务，出问题怎么定位？
- **数据一致性**：每个服务有独立数据库，怎么保持数据同步？
- **网络不可靠**：服务调用变成网络调用，超时、重试、熔断？
- **运维复杂度**：从部署 1 个应用变成部署 20 个服务
- **测试困难**：端到端测试需要拉起所有依赖服务

:::

这些问题的解决方案催生了一整套中间件：服务注册发现（Nacos/Consul）、配置中心、API 网关、分布式追踪（Jaeger/SkyWalking）、熔断器（Sentinel/Hystrix）……

::: info

**微服务的本质：** 微服务不是"把大单体拆成小单体"那么简单。它是一种**用分布式复杂性换取可扩展性和团队自治**的架构选择。只有当业务复杂度和团队规模到了一定程度，这个交换才是值得的。

:::

---

### 1.6 云原生时代

微服务解决了业务拆分的问题，但把基础设施的复杂性甩给了开发者。每个团队都要自己处理服务发现、熔断、限流、追踪……

**云原生（Cloud Native）**进一步强调在动态环境中构建松耦合、可观测、可管理且有韧性的系统，并通过自动化实现频繁、可预测的变更。容器、编排、服务网格、不可变基础设施和声明式 API 都是常见手段，但不是必须同时采用的固定套餐。

<table>
<tr><th>能力</th><th>微服务时代（开发者自行处理）</th><th>云原生时代（平台层处理）</th></tr>
<tr><td>部署</td><td>虚拟机 + 脚本</td><td>容器（Docker）+ 编排（K8s）</td></tr>
<tr><td>服务发现</td><td>代码里集成 Nacos/Eureka</td><td>K8s Service + DNS</td></tr>
<tr><td>熔断/限流</td><td>代码里集成 Sentinel/Hystrix</td><td>Service Mesh（Istio/Linkerd）</td></tr>
<tr><td>链路追踪</td><td>代码里集成 SDK</td><td>Sidecar 自动注入</td></tr>
<tr><td>配置管理</td><td>配置中心（Apollo/Nacos）</td><td>ConfigMap + 声明式配置</td></tr>
</table>

```text
  云原生目标：松耦合 + 韧性 + 可观测 + 自动化交付

  ┌─────────────────────────────────────────────┐
  │            应用层（业务代码）                   │
  │     只关注业务逻辑，不关心基础设施               │
  ├─────────────────────────────────────────────┤
  │         Service Mesh（服务网格）               │
  │    Sidecar 代理：熔断/限流/追踪/加密             │
  ├─────────────────────────────────────────────┤
  │         容器编排层（Kubernetes）                │
  │    调度/自愈/弹性伸缩/滚动发布                   │
  ├─────────────────────────────────────────────┤
  │         基础设施层（云）                       │
  │    计算/存储/网络/数据库（按需分配）              │
  └─────────────────────────────────────────────┘
```

云原生的演进方向是：**让开发者越来越只关注业务本身**。从"自己管服务器"到"容器化部署"，从"自己写熔断逻辑"到"Sidecar 自动处理"，基础设施的复杂性被一层层地向下封装。

---

### 1.7 演进的启示

回顾这段历史，我们可以得出几条非常重要的认知：

#### 启示一：没有银弹

每种架构都有它解决的问题，也有它引入的新问题：

<table>
<tr><th>架构</th><th>解决了什么</th><th>引入了什么新问题</th></tr>
<tr><td>单体</td><td>—</td><td>代码膨胀、协作困难</td></tr>
<tr><td>分层</td><td>关注点分离</td><td>层次多了跳转复杂</td></tr>
<tr><td>SOA</td><td>跨系统能力复用与组合</td><td>集中治理或特定实现可能过重</td></tr>
<tr><td>微服务</td><td>独立部署、团队自治</td><td>分布式事务、运维复杂</td></tr>
<tr><td>云原生</td><td>基础设施下沉</td><td>学习曲线陡峭、平台依赖</td></tr>
</table>

**架构选择的本质，就是选择承担哪种复杂性。**

#### 启示二：复杂性守恒

> 复杂性不会消失，只会转移。—— Larry Constantine

微服务把单体内部的复杂性转移到了网络层面，云原生把网络层面的复杂性转移到了平台层面。**总复杂性没有减少，只是换了你更擅长处理的形式。**

#### 启示三：架构是演进的

没有任何系统一上来就是微服务架构。好的架构是**渐进式演化**的：

```text
单体 ──→ 分层单体 ──→ 模块化单体 ──→ 微服务 ──→ 云原生

  ↑          ↑             ↑            ↑          ↑
 业务小    业务增长      团队扩大     团队多到    基础设施
          需要分层      需要模块化    需要自治    复杂到需要平台
```

**适合当前业务规模和团队能力的架构，才是好架构。**

#### 启示四：DDD 是拆分的依据

微服务要拆得好，关键问题是"**在哪拆**"。拆早了，服务太小，分布式事务满天飞；拆晚了，服务太大，又回到单体的问题。

这就是**领域驱动设计（DDD）**的定位——它提供了一套方法论来回答"系统的边界在哪里"。详见第三章。

![架构演进史总结图](/images/tech-design-guide/summary-01.svg)

## 第二章：架构方法论基础

架构演进的历史脉络理清后，进入实操层面。本章讲代码组织的多种方法论：从事务脚本、MVC 分层、贫血/充血模型，到更广阔的方法论版图——Active Record、六边形架构、整洁架构、CQRS、事件驱动、微内核等。CRUD/MVC/DDD 是三条主线，但不是全部。它们解决不同维度的问题，组合使用才是常态。

---

### 2.1 CRUD：最朴素的工程实践

**CRUD** 是 Create、Read、Update、Delete 的缩写，代表对数据的四种基本操作。它是几乎所有业务系统的基础。

围绕 CRUD 的一种典型代码模式叫**事务脚本（Transaction Script）**：每个方法就是一个"脚本"，从头到尾执行一系列步骤，完成一个业务操作。

```java
// 事务脚本模式：一个方法搞定一切
public class OrderService {

    @Autowired
    private OrderDao orderDao;
    @Autowired
    private ProductDao productDao;
    @Autowired
    private SmsClient smsClient;

    // 创建订单 —— 一个"脚本"从上到下执行
    @Transactional
    public String createOrder(String userId, List<OrderItemRequest> items, String address) {
        // 1. 查商品、算总价
        BigDecimal totalPrice = BigDecimal.ZERO;
        for (OrderItemRequest item : items) {
            ProductDO product = productDao.findById(item.getProductId());
            BigDecimal itemPrice = product.getPrice().multiply(BigDecimal.valueOf(item.getQuantity()));
            totalPrice = totalPrice.add(itemPrice);
            // 扣库存
            productDao.decreaseStock(item.getProductId(), item.getQuantity());
        }

        // 2. 创建订单
        OrderDO order = new OrderDO();
        order.setId(UUID.randomUUID().toString());
        order.setUserId(userId);
        order.setTotalPrice(totalPrice);
        order.setAddress(address);
        order.setStatus("CREATED");
        order.setCreatedAt(new Date());
        orderDao.insert(order);

        // 3. 发短信
        smsClient.send(userId, "订单已创建: " + order.getId());

        return order.getId();
    }

    // 查询、更新、取消... 同样的"脚本"风格
    public OrderDO getOrder(String orderId) {
        return orderDao.findById(orderId);
    }

    @Transactional
    public void cancelOrder(String orderId) {
        OrderDO order = orderDao.findById(orderId);
        if (order == null) throw new RuntimeException("订单不存在");
        order.setStatus("CANCELLED");
        orderDao.update(order);
        // 还库存...
    }
}
```

#### 事务脚本的优缺点

<table>
<tr><th>优点</th><th>缺点</th></tr>
<tr><td>简单直接，上手门槛极低</td><td>业务逻辑分散在各个 Service 方法中，没有内聚</td></tr>
<tr><td>一个方法一个流程，容易理解</td><td>相同的校验逻辑在多处重复</td></tr>
<tr><td>适合简单 CRUD 场景</td><td>业务复杂后，Service 膨胀成几千行的"上帝类"</td></tr>
<tr><td></td><td>领域知识散落在代码各处，没有"模型"的概念</td></tr>
</table>

::: tip

**适用场景：** 业务逻辑确实简单（主要是增删改查），没有复杂的状态流转和业务规则时，事务脚本是最务实的选择。

:::

---

### 2.2 MVC 与后端分层

事务脚本可以放进分层结构中，以隔离输入输出、业务逻辑和持久化。MVC 是界面交互中经典的关注点分离模式，后端三层架构则按表现、业务和数据访问职责组织代码；两者经常组合出现，但不是同一个概念。

#### MVC 的三个角色

<table>
<tr><th>角色</th><th>职责</th><th>对应后端</th></tr>
<tr><td><strong>Model</strong>（模型）</td><td>表示应用状态与行为</td><td>可能由领域对象、应用服务和数据访问共同支撑</td></tr>
<tr><td><strong>View</strong>（视图）</td><td>呈现模型</td><td>服务端页面；在 API 场景可对应响应表示</td></tr>
<tr><td><strong>Controller</strong>（控制器）</td><td>接收输入并协调模型与视图</td><td>HTTP Controller</td></tr>
</table>

在 Java Web 项目中，经常同时看到 MVC 风格的入口与 **Controller → Service → DAO** 三层代码结构。这是常见组合，不代表 MVC 必然演化成三层架构。

::: info

**共同目标：** **关注点分离**。Controller 不应承载核心业务规则，Service 不应散落具体 SQL，DAO 不应决定业务合法性。边界应围绕职责，而不是只把代码放进不同文件夹。

:::

---

### 2.3 经典三层架构

用一个完整的电商订单示例来看三层架构的代码：

#### 表现层：Controller

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    @Autowired
    private OrderService orderService;

    @PostMapping
    public Result<String> createOrder(@RequestBody @Valid CreateOrderRequest request) {
        // Controller 只做：参数接收 + 调用 Service + 返回结果
        String orderId = orderService.createOrder(
            request.getUserId(),
            request.getItems(),
            request.getAddress()
        );
        return Result.success(orderId);
    }

    @GetMapping("/{orderId}")
    public Result<OrderVO> getOrder(@PathVariable String orderId) {
        OrderVO order = orderService.getOrder(orderId);
        return Result.success(order);
    }
}
```

#### 业务层：Service

```java
@Service
public class OrderService {

    @Autowired
    private OrderDao orderDao;
    @Autowired
    private ProductDao productDao;
    @Autowired
    private SmsClient smsClient;

    @Transactional
    public String createOrder(String userId, List<OrderItemRequest> items, String address) {
        // 业务逻辑在这里
        BigDecimal totalPrice = BigDecimal.ZERO;
        List<OrderItemDO> orderItems = new ArrayList<>();

        for (OrderItemRequest item : items) {
            ProductDO product = productDao.findById(item.getProductId());
            if (product.getStock() < item.getQuantity()) {
                throw new BizException("库存不足: " + product.getName());
            }
            BigDecimal itemPrice = product.getPrice()
                .multiply(BigDecimal.valueOf(item.getQuantity()));
            totalPrice = totalPrice.add(itemPrice);

            orderItems.add(new OrderItemDO(
                item.getProductId(),
                item.getQuantity(),
                product.getPrice()
            ));

            productDao.decreaseStock(item.getProductId(), item.getQuantity());
        }

        OrderDO order = new OrderDO();
        order.setId(UUID.randomUUID().toString());
        order.setUserId(userId);
        order.setTotalPrice(totalPrice);
        order.setAddress(address);
        order.setStatus("CREATED");
        order.setCreatedAt(new Date());
        order.setItems(orderItems);

        orderDao.insert(order);
        smsClient.send(userId, "订单已创建: " + order.getId());

        return order.getId();
    }

    public OrderVO getOrder(String orderId) {
        OrderDO order = orderDao.findById(orderId);
        if (order == null) {
            throw new BizException("订单不存在");
        }
        return OrderVO.from(order);
    }
}
```

#### 数据访问层：DAO

```java
@Repository
public class OrderDao {

    @Autowired
    private OrderMapper orderMapper;  // MyBatis Mapper

    public OrderDO findById(String orderId) {
        return orderMapper.selectById(orderId);
    }

    public void insert(OrderDO order) {
        orderMapper.insert(order);
        for (OrderItemDO item : order.getItems()) {
            item.setOrderId(order.getId());
            orderMapper.insertItem(item);
        }
    }

    public void update(OrderDO order) {
        orderMapper.update(order);
    }
}
```

#### 三层架构的数据流

```text
HTTP 请求
    │
    ▼
┌──────────┐     ┌──────────────┐     ┌──────────┐     ┌────────┐
│Controller│ ──→ │   Service    │ ──→ │   DAO    │ ──→ │ MySQL  │
│ 参数校验  │     │  业务逻辑     │     │ 数据操作   │     │        │
│ 响应封装  │ ←── │  事务管理     │ ←── │ 数据映射   │ ←── │        │
└──────────┘     └──────────────┘     └──────────┘     └────────┘
    │                  │
    │                  ├──→ SmsClient（发短信）
    │                  └──→ 其他外部调用
    │
    ▼
HTTP 响应（JSON）
```

::: tip

**层次清晰的判断标准：** Controller 里不应该有 SQL 字符串或 `BigDecimal` 计算；DAO 里不应该有 `if (status.equals("PAID"))` 这样的业务判断。每层只做自己该做的事。

:::

---

### 2.4 贫血模型 vs 充血模型

在三层架构中，我们通常会有一个 `OrderDO`（Data Object），它长这样：

```java
// ❌ 贫血模型：只有数据，没有行为
public class OrderDO {
    private String id;
    private String userId;
    private BigDecimal totalPrice;
    private String address;
    private String status;   // CREATED, PAID, SHIPPED, CANCELLED
    private Date createdAt;

    // 只有 getter / setter，没有任何业务方法
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    // ... 其余 getter / setter
}
```

这个对象只是一个**数据袋子**——它知道自己叫 `Order`，但不知道订单能做什么、不能做什么。所有的业务逻辑都写在 `OrderService` 里。

这就叫**贫血模型（Anemic Domain Model）**。Martin Fowler 将其称为一个**反模式**。

#### 为什么贫血模型普遍存在？

1. **ORM 框架的推波助澜**：MyBatis、Hibernate 生成的实体类天然就是贫血的
2. **开发习惯**：大家习惯了"Service 写逻辑，DO 只存数据"
3. **框架约束**：Spring MVC 的分层结构天然鼓励这种模式

#### 贫血模型的问题

```java
// 贫血模型下，取消订单的逻辑在哪里？
// 散落在 Service 的某个方法里：

public void cancelOrder(String orderId) {
    OrderDO order = orderDao.findById(orderId);
    // 业务规则：只有未支付的订单才能取消
    if (!"CREATED".equals(order.getStatus())) {
        throw new BizException("当前状态不可取消");
    }
    order.setStatus("CANCELLED");
    orderDao.update(order);
}

// 后来了个新需求：已发货的订单可以"申请退款"
// 你又在 Service 的另一个方法里写了类似的逻辑
// 问题：状态规则散落在 Service 的各个方法里，没有集中管理
```

#### 充血模型：让对象自己管理行为

```java
// ✅ 充血模型：数据 + 行为内聚在同一个对象中
public class Order {
    private String id;
    private String userId;
    private BigDecimal totalPrice;
    private Address address;          // 值对象
    private OrderStatus status;       // 枚举，而非魔法字符串
    private List<OrderItem> items;    // 聚合内的实体
    private Date createdAt;

    // ====== 构造方法（工厂） ======
    public Order(String userId, List<OrderItem> items, Address address) {
        this.id = UUID.randomUUID().toString();
        this.userId = userId;
        this.items = items;
        this.address = address;
        this.totalPrice = calculateTotalPrice();
        this.status = OrderStatus.CREATED;
        this.createdAt = new Date();
    }

    // ====== 业务行为 ======

    // 取消订单：业务规则内聚在对象内部
    public void cancel() {
        if (this.status != OrderStatus.CREATED &&
            this.status != OrderStatus.PAID) {
            throw new BizException("当前状态不可取消: " + this.status);
        }
        this.status = OrderStatus.CANCELLED;
        // 恢复库存
        for (OrderItem item : items) {
            item.restoreStock();
        }
    }

    // 支付
    public void pay() {
        if (this.status != OrderStatus.CREATED) {
            throw new BizException("订单状态不允许支付");
        }
        this.status = OrderStatus.PAID;
    }

    // 发货
    public void ship() {
        if (this.status != OrderStatus.PAID) {
            throw new BizException("未支付订单不可发货");
        }
        this.status = OrderStatus.SHIPPED;
    }

    // 内部计算
    private BigDecimal calculateTotalPrice() {
        return items.stream()
            .map(OrderItem::getSubtotal)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    // getter（不提供 setter，保证不变性）
    public String getId() { return id; }
    public OrderStatus getStatus() { return status; }
}
```

对比一下两种模型下 Service 的变化：

```java
// 充血模型下的 Service 变得很薄——只做"编排"，不做"业务"

@Service
public class OrderService {

    @Autowired
    private OrderRepository orderRepository;  // 注意：是 Repository 不是 DAO

    @Transactional
    public void cancelOrder(String orderId) {
        Order order = orderRepository.findById(orderId);
        if (order == null) {
            throw new BizException("订单不存在");
        }
        order.cancel();  // ← 业务规则在 Order 对象内部
        orderRepository.save(order);
    }
}
```

#### 对比总结

<table>
<tr><th>维度</th><th>贫血模型</th><th>充血模型</th></tr>
<tr><td>业务逻辑在哪</td><td>Service 层</td><td>领域对象内部</td></tr>
<tr><td>对象的角色</td><td>数据容器</td><td>数据和行为的统一体</td></tr>
<tr><td>状态修改</td><td>外部直接 setter</td><td>通过业务方法修改</td></tr>
<tr><td>规则集中度</td><td>散落各处</td><td>内聚在对象中</td></tr>
<tr><td>可测试性</td><td>需 Mock DAO</td><td>可纯单元测试</td></tr>
<tr><td>适合场景</td><td>简单 CRUD</td><td>复杂业务领域</td></tr>
</table>

::: warning

**注意：** 充血模型不是万能的。对于简单的 CRUD 系统，贫血模型反而更高效。充血模型的价值在**业务复杂度高**时才真正体现——而这正是 DDD 的切入点。

:::

---

### 2.5 更广阔的方法论版图

前面三节讲了 CRUD 事务脚本、MVC 分层、贫血/充血模型——这是理解 DDD 的三级认知台阶。但业界的方法论远不止这些。不同的模式解决不同层面的问题，很多可以组合使用。下面按问题维度梳理。

```text
┌──────────────────────────────────────────────────────────────────┐
│                      架构方法论全景                                │
│                                                                    │
│  问题维度            代表模式                                      │
│  ──────────         ──────────────────────────                      │
│  数据怎么访问       CRUD / Active Record / Data Mapper / Repository  │
│  代码怎么分层       MVC 三层 / 六边形 / 整洁架构 / 洋葱架构           │
│  读写怎么分离       CQRS / Event Sourcing                           │
│  组件怎么通信       事件驱动 / 响应式                                 │
│  系统怎么扩展       微内核(插件) / 管道-过滤器                         │
│  业务怎么建模       DDD（战略+战术）← 本文重点                        │
│  服务怎么拆分       SOA / 微服务 / 云原生 ← 第一章                    │
└──────────────────────────────────────────────────────────────────┘
```

::: info

**关键认知：** 这些模式之间是**正交关系**。一个系统可以同时用 MVC 分层 + Repository + 六边形架构 + 事件驱动。它们的关注点不同，组合使用互不冲突。

:::

---

#### 2.5.1 数据访问模式：Active Record、Data Mapper 与 Repository

CRUD 事务脚本的核心问题是：对象和数据表之间是什么关系？业界有三种主流答案。

<table>
<tr><th>模式</th><th>核心思想</th><th>代表框架</th><th>特点</th></tr>
<tr><td><strong>Active Record</strong>（活动记录）</td><td>对象即表行，自带持久化方法</td><td>Rails, Laravel, Django ORM</td><td>简单高效，但对象承担了业务+持久化双重职责</td></tr>
<tr><td><strong>Data Mapper</strong>（数据映射器）</td><td>用独立映射器在对象与数据库之间搬运数据</td><td>MyBatis Mapper、手写 DAO</td><td>对象不负责持久化，适合显式控制 SQL</td></tr>
<tr><td><strong>Repository</strong>（仓储）</td><td>面向领域集合或聚合根，隐藏持久化细节</td><td>DDD 实践、定制仓储接口</td><td>业务与持久化解耦，但不能仅靠框架接口自动获得领域语义</td></tr>
</table>

```java
// ── Active Record 风格 ──
// 对象自带 find/save，直接操作数据库
Order order = Order.find(123);       // 静态方法查
order.setStatus("PAID");
order.save();                        // 自带持久化

// ── Data Mapper 风格 ──
// Mapper 在数据结构与数据库记录之间做映射
OrderDO orderDO = orderMapper.selectById(123);
orderDO.setStatus("PAID");
orderMapper.update(orderDO);

// ── Repository 风格 ──
// 以聚合为单位，隐藏持久化细节
Order order = orderRepository.findById(123); // 返回领域对象
order.pay();                                  // 业务方法
orderRepository.save(order);                  // 保存整个聚合
```

::: tip

**选择建议：** Active Record 适合快速开发中小型项目。Data Mapper 适合需要显式 SQL 控制、又不希望对象自带持久化行为的场景。Repository 面向领域集合或聚合提供接口，适合复杂业务，但是否真正隔离持久化取决于接口与模型设计，而不只取决于使用哪个框架。

:::

---

#### 2.5.2 架构边界模式：六边形 / 整洁 / 洋葱

三层架构（Controller-Service-DAO）解决了关注点分离，但它有一个根本缺陷：**依赖方向是自上而下的**。Controller 依赖 Service，Service 依赖 DAO——DAO 是基础设施，却处在依赖链的底端。这意味着业务逻辑间接地"知道"了数据库的存在。

有三种模式专门解决这个问题，核心思想一致：**依赖倒置——让业务核心不依赖任何基础设施**。

#### ① 六边形架构（Hexagonal Architecture / Ports & Adapters）

由 Alistair Cockburn 于 2005 年提出。核心概念：

- **端口（Port）**：业务核心定义的接口。比如"订单存储端口"、"支付端口"。
- **适配器（Adapter）**：基础设施层的实现。比如 MySQL 适配器、Stripe 支付适配器。
- **业务核心只依赖端口**，不依赖任何具体适配器。适配器"插入"端口，所以也叫"端口与适配器"。

```text
              ┌─────────────────────────────────┐
              │          应用核心                  │
              │   (领域模型 + 应用服务)              │
              │                                   │
              │   ┌─────────┐  ┌─────────┐        │
              │   │ Port:   │  │ Port:   │        │
              │   │ 订单存储 │  │ 支付网关 │        │
              │   └────┬────┘  └────┬────┘        │
              └────────┼─────────────┼────────────┘
                       │             │
            ┌──────────┘             └──────────┐
            ▼                                   ▼
     ┌──────────────┐                   ┌──────────────┐
     │ MySQL Adapter│                   │ Stripe Adapter│
     │(实现订单存储)  │                   │ (实现支付端口) │
     └──────────────┘                   └──────────────┘

  核心不知道端口背后是 MySQL 还是 MongoDB
  测试时可以插入 Mock 适配器
```

```java
// 六边形架构代码示例

// ── 端口（业务核心定义的接口） ──
// 在领域层，不依赖任何基础设施
public interface OrderRepositoryPort {
    Order findById(String orderId);
    void save(Order order);
}

public interface PaymentGatewayPort {
    PaymentResult charge(Money amount, String customerId);
}

// ── 应用核心 ──
// 只依赖端口接口，不知道具体实现
public class OrderApplicationService {
    private final OrderRepositoryPort orderRepo;  // 接口
    private final PaymentGatewayPort paymentGateway;  // 接口

    public OrderApplicationService(OrderRepositoryPort orderRepo,
                                    PaymentGatewayPort paymentGateway) {
        this.orderRepo = orderRepo;
        this.paymentGateway = paymentGateway;
    }

    public void payOrder(String orderId) {
        Order order = orderRepo.findById(orderId);
        order.pay();
        paymentGateway.charge(order.getTotalAmount(), order.getUserId());
        orderRepo.save(order);
    }
}

// ── 适配器（基础设施层实现端口） ──
public class MySQLOrderRepositoryAdapter implements OrderRepositoryPort {
    @Override
    public Order findById(String orderId) {
        OrderDO orderDO = orderMapper.selectById(orderId);
        return orderDOToDomainConverter.convert(orderDO);
    }

    @Override
    public void save(Order order) {
        OrderDO orderDO = domainToOrderDOConverter.convert(order);
        orderMapper.update(orderDO);
    }
}
```

#### ② 整洁架构（Clean Architecture）

由 Robert C. Martin（Uncle Bob）于 2012 年提出。用同心圆表达依赖规则：

```text
     ┌──────────────────────────────────────────────┐
     │  4. Frameworks & Drivers                      │  ← 最外层
     │     Web 框架, 数据库, UI, 第三方库                │
     │  ┌──────────────────────────────────────────┐ │
     │  │  3. Interface Adapters                   │ │
     │  │     Controller, Presenter, Gateway      │ │
     │  │  ┌──────────────────────────────────┐   │ │
     │  │  │  2. Use Cases (Application)      │   │ │
     │  │  │     应用服务、用例编排             │   │ │
     │  │  │  ┌──────────────────────────┐    │   │ │
     │  │  │  │  1. Entities (Domain)    │    │   │ │  ← 最内层
     │  │  │  │     领域模型、业务规则      │    │   │ │
     │  │  │  └──────────────────────────┘    │   │ │
     │  │  └──────────────────────────────────┘   │ │
     │  └──────────────────────────────────────────┘ │
     └──────────────────────────────────────────────┘

  依赖规则：外层 → 内层（箭头永远指向内）
  内层不知道外层的存在
```

#### ③ 洋葱架构（Onion Architecture）

由 Jeffrey Palermo 于 2008 年提出。与整洁架构理念几乎一致，分四层：

<table>
<tr><th>层</th><th>洋葱架构</th><th>整洁架构对应</th></tr>
<tr><td>最内层</td><td>Domain Model（领域模型）</td><td>Entities</td></tr>
<tr><td>第二层</td><td>Domain Services（领域服务）</td><td>Use Cases</td></tr>
<tr><td>第三层</td><td>Application Services（应用服务）</td><td>Interface Adapters</td></tr>
<tr><td>最外层</td><td>Infrastructure（基础设施）</td><td>Frameworks &amp; Drivers</td></tr>
</table>

::: info

**三者关系：** 六边形、整洁和洋葱架构都强调依赖倒置与业务核心不依赖外围，但组织视角并不完全相同：六边形突出端口与适配器，洋葱突出围绕领域模型的依赖层次，整洁架构还明确了用例与接口适配层。可以共享原则，但落地时仍要根据边界和团队语言选择表达。

:::

---

#### 2.5.3 读写模型与事件存储：CQRS、Event Sourcing

前面的示例大多让读写共用一套模型。在业务规则复杂、查询形态差异明显或读写需要独立扩展时，可以考虑分离：

- 写：需要保证业务一致性，用 DDD 聚合、事务控制
- 读：需要查询性能，用宽表、物化视图、搜索引擎

#### CQRS（Command Query Responsibility Segregation）

CQRS 由 Greg Young 提出，核心思想：**把命令（写操作）和查询（读操作）拆成两套独立模型**。

```text
                    ┌───────────┐
                    │   客户端    │
                    └─────┬──────┘
                Command   │    Query
                    ┌────┴────┐
                    ▼         ▼
             ┌──────────┐ ┌──────────────┐
             │  Command │ │    Query     │
             │   Side   │ │    Side      │
             │          │ │              │
             │ 写模型    │ │  读模型       │
             │(DDD聚合)  │ │ (宽表/ES/   │
             │ 面向一致  │ │  物化视图)   │
             │ 性       │ │ 面向查询性能   │
             └────┬─────┘ └──────────────┘
                  │             ▲
                  │  同步/事件  │
                  └─────────────┘
                     数据同步
```

```java
// CQRS：写模型和读模型完全分离

// ── 写模型：面向业务一致性 ──
// 用 DDD 聚合，通过 Repository 持久化
public class OrderCommandHandler {
    private final OrderRepository orderRepository;  // 写库

    @Transactional
    public void handle(PayOrderCommand cmd) {
        Order order = orderRepository.findById(cmd.getOrderId());
        order.pay();   // 业务规则在聚合内
        orderRepository.save(order);
        // 发布事件，触发读模型更新
        eventBus.publish(new OrderPaidEvent(order.getId()));
    }
}

// ── 读模型：面向查询性能 ──
// 不走 DDD 聚合，直接查宽表
public class OrderQueryService {
    private final OrderQueryDao orderQueryDao;  // 读库（可能是另一个数据库）

    public OrderListVO queryOrders(OrderQueryCondition condition) {
        // 直接查预构建的宽表，不需要 JOIN，不需要聚合
        return orderQueryDao.queryWideTable(condition);
    }
}
```

#### Event Sourcing（事件溯源）

Event Sourcing 可以与 CQRS 组合，但二者彼此独立：CQRS 不要求事件溯源，事件溯源也不要求读写使用不同模型。事件溯源把领域事件作为事实来源，当前状态通过重放事件得到；为提升读取与恢复速度，也常保存投影和快照。

```text
  传统方式：直接存当前状态
  ┌────────────────┐
  │ orders 表       │
  │ id=123          │
  │ status=PAID     │  ← 只知道"现在"，丢了"过程"
  │ total=295.00    │
  └────────────────┘

  事件溯源：存所有事件
  ┌──────────────────────────────────┐
  │ event_store 表                    │
  │                                    │
  │ 1. OrderCreated  {items, total}   │
  │ 2. CouponApplied {discount}       │
  │ 3. OrderPaid     {paidAt, method}  │
  │                                    │
  │ 重放 1+2+3 → 得到当前状态           │
  └──────────────────────────────────┘

  优点：完整审计轨迹、可时间旅行、天然适配 CQRS
  缺点：查询复杂（需建读模型）、事件版本演进麻烦
```

::: warning

**使用门槛：** CQRS 和 Event Sourcing 都会引入模型同步、最终一致、事件演进和运维等复杂度。采用 CQRS 的理由不只包括读写流量不平衡，也可能是读写模型的业务语义差异；对于简单 CRUD，通常没有必要引入。

:::

---

#### 2.5.4 通信范式：事件驱动与响应式

前面所有模式的通信方式都是"直接调用"——A 调 B，B 返回给 A。这种方式简单，但存在紧耦合：A 必须知道 B 的存在，B 挂了 A 也跟着失败。

#### 事件驱动架构（Event-Driven Architecture, EDA）

组件通过**事件**通信，而非直接调用。生产者发布事件，消费者订阅事件，两者互不感知。

```text
  直接调用（同步、紧耦合）：
  ┌────────┐  调用   ┌────────┐
  │ 订单服务 │ ──────→ │ 支付服务 │  支付挂了 → 订单也失败
  └────────┘          └────────┘

  事件驱动（异步、松耦合）：
  ┌────────┐          ┌──────────┐          ┌────────┐
  │ 订单服务 │ ─发布→  │ 消息队列   │ ──订阅→  │ 支付服务 │
  └────────┘  事件     │ (Kafka)  │          └────────┘
                          └──订阅──→ ┌────────┐
                                     │ 通知服务 │  支付挂了不影响订单
                                     └────────┘  恢复后补消费
```

EDA 在微服务架构中非常普遍。DDD 的"领域事件"配合消息队列（Kafka/RocketMQ），就是 EDA 的落地方式。第一章提到的事件溯源也天然契合 EDA。

#### 响应式架构（Reactive Architecture）

基于**响应式宣言**（Reactive Manifesto）的系统设计，四个特征：

<table>
<tr><th>特征</th><th>含义</th></tr>
<tr><td>Responsive（响应性）</td><td>系统始终及时响应，即使在高负载或故障下</td></tr>
<tr><td>Resilient（韧性）</td><td>部分失败不会波及整体——通过隔离和委托实现</td></tr>
<tr><td>Elastic（弹性伸缩）</td><td>资源随负载自动伸缩，无并发瓶颈</td></tr>
<tr><td>Message-Driven（消息驱动）</td><td>异步消息作为组件间通信方式</td></tr>
</table>

Java 生态的 Project Reactor、Spring WebFlux、Akka 是响应式架构的代表实现。

---

#### 2.5.5 扩展模式：微内核与管道

#### 微内核架构（Microkernel / Plugin Architecture）

核心只提供最小运行时，所有功能通过插件扩展。

```text
  ┌────────────────────────────────┐
  │        插件 A (语法高亮)         │
  ├────────────────────────────────┤
  │  插件 B (Git)  │  插件 C (调试)  │
  │─────────────────────────────────│
  │         微内核 Core             │
  │   只做：插件加载 / 生命周期管理   │
  │        / 基础事件总线             │
  └────────────────────────────────┘

  代表：VS Code, Eclipse, Webpack, Jenkins
  优点：极高的可扩展性，第三方可以贡献插件
  缺点：插件间依赖管理复杂，性能可能受影响
```

#### 管道-过滤器架构（Pipeline / Pipe-Filter）

数据流经过一系列处理阶段，每个阶段（过滤器）做一件事，阶段之间通过管道连接。

```text
  数据 → [过滤器1] → [过滤器2] → [过滤器3] → 结果
         解析        校验        转换

  代表：Unix 管道 (cat | grep | sort)
        ETL Pipeline
        Web 中间件链 (Filter Chain)
        编译器 Pipeline (词法→语法→语义→优化→生成)

  优点：每个过滤器独立可测试、可复用、可并行
  缺点：不适合需要回溯或分支的复杂流程
```

---

#### 2.5.6 全景对照

把本章讲到的所有模式放在一起对比：

<table>
<tr><th>模式</th><th>解决的问题</th><th>类比</th><th>与 DDD 关系</th></tr>
<tr><td>CRUD 事务脚本</td><td>以流程组织简单业务操作</td><td>一个方法完成一个用例</td><td>可用于简单子域，也可与 DDD 战略设计共存</td></tr>
<tr><td>Active Record</td><td>对象自带持久化</td><td>对象既是数据又是持久化入口</td><td>与富领域模型存在张力，但并非概念上绝对互斥</td></tr>
<tr><td>MVC / 三层</td><td>分离交互或应用职责</td><td>按职责组织模块</td><td>可与 DDD 组合，但不是 DDD 的前提</td></tr>
<tr><td>六边形/整洁/洋葱</td><td>依赖倒置、核心不依赖外围</td><td>围绕核心设置边界</td><td>常用于承载 DDD 模型，也可独立使用</td></tr>
<tr><td>CQRS</td><td>读写模型分离</td><td>读用只读副本、写用主库</td><td>可叠加在 DDD 之上</td></tr>
<tr><td>Event Sourcing</td><td>以事件日志作为事实来源</td><td>Git 的提交历史</td><td>可保存领域事件，也可与 CQRS 组合</td></tr>
<tr><td>事件驱动</td><td>组件通过事件协作</td><td>发布消息而非直接指定调用方</td><td>可传递领域事件，既可同步也可异步</td></tr>
<tr><td>微内核</td><td>核心+插件</td><td>VS Code</td><td>与 DDD 正交</td></tr>
<tr><td>管道-过滤器</td><td>数据流水线</td><td>Unix 管道</td><td>与 DDD 正交</td></tr>
</table>

::: info

**正交关系：** 上表最后一列很重要——这些模式不是互斥的。一个真实的电商系统可能是：DDD 战略设计划限界上下文 + 六边形架构做分层 + CQRS 分离读写 + 事件驱动做跨上下文通信 + 管道模式做数据处理。它们解决的是不同维度的问题，组合使用才是常态。

:::

![架构方法论全景总结图](/images/tech-design-guide/summary-02.svg)

## 第三章：领域驱动设计（DDD）

::: info

前面两章走了从"大泥球"到"分层"再到"充血模型"的路线。但一个关键问题始终没有被系统性地回答：**系统的边界在哪里？哪些概念应该放在一起？**

这一章就是 DDD（Domain-Driven Design，领域驱动设计）的主场。DDD 由 Eric Evans 在 2003 年提出，它不仅是一套设计模式，更是一种**思考方式**——先理解业务领域，再设计软件模型。

本章是全文的重点，深入讲清楚 DDD 的战略设计和战术设计，贯穿电商交易的完整示例。

:::

---

### 3.1 为什么需要 DDD

回到一个真实场景：

> 一家电商系统里有一个 `Product`（商品）类。
> 商品中心团队说：商品有名称、价格、类目、图片、描述。
> 库存团队说：商品有 SKU、库存数量、仓库位置。
> 营销团队说：商品有促销价、标签、推荐权重。
> 搜索团队说：商品有关键词、搜索分词、热度值。
> 大家说的都对，但它们是**同一个"商品"吗**？

这就是**贫血模型 + 三层架构**在复杂业务中的困境：

- **概念混乱**：一个 `Product` 类被塞进了所有团队关心的字段，变成一个有 80 个字段的"上帝对象"
- **边界模糊**：商品中心改了 `Product` 的价格字段，结果影响了营销团队的促销价逻辑
- **逻辑外泄**：订单状态的流转规则散落在 5 个 Service 里，没有统一的"真相来源"
- **沟通鸿沟**：产品经理说"优惠券"，开发说 `discount_record` 表，双方对不上

DDD 要解决的核心问题就是：**让软件模型反映业务的真实面貌，让代码结构和业务结构对齐。**

::: info

**DDD 的哲学：** 软件的核心价值在于它所承载的**领域知识**。技术只是载体，业务才是灵魂。先把业务理解透了，代码自然就清晰了。

:::

---

### 3.2 DDD 全景

DDD 分为两大层次：**战略设计**和**战术设计**。

```text
                    DDD
                    / \
          ┌────────┘   └────────┐
          ▼                      ▼
     战略设计                  战术设计
  (宏观·划边界)             (微观·建模型)
          │                      │
     ┌────┼────┐           ┌──────┼──────┐
     ▼    ▼    ▼           ▼      ▼      ▼
   领域  限界  上下文      实体  值对象  聚合
   子域  上下文 映射        │      │      │
                        ┌──┴──┐   │   ┌──┴──┐
                        ▼     ▼   ▼   ▼     ▼
                     领域  领域  仓储  工厂  领域
                     服务  事件            事件
```

<table>
<tr><th>维度</th><th>战略设计</th><th>战术设计</th></tr>
<tr><td>关注层面</td><td>宏观——系统的整体结构</td><td>微观——代码层面的建模</td></tr>
<tr><td>核心概念</td><td>领域、子域、限界上下文、上下文映射</td><td>实体、值对象、聚合、领域服务、领域事件、仓储、工厂</td></tr>
<tr><td>解决的问题</td><td>系统怎么拆？边界在哪？</td><td>代码怎么写？模型怎么建？</td></tr>
<tr><td>与部署关系</td><td>可以为服务边界提供语义依据，但不等同于微服务</td><td>是模型一致性边界，不等同于部署单元</td></tr>
</table>

战略设计告诉你**在哪切**，战术设计告诉你**切完之后怎么写**。两者缺一不可。

---

### 3.3 战略设计

战略设计是 DDD 中最容易被忽视、但价值最高的部分。它从业务全局视角确定系统该怎么划分。

#### 3.3.1 领域与子域

**领域（Domain）**是指一个业务范围。比如"电商"就是一个领域。但电商太大了，需要拆分成**子域（Subdomain）**。

子域分三种类型：

<table>
<tr><th>类型</th><th>含义</th><th>电商示例</th><th>策略</th></tr>
<tr><td><strong>核心域</strong></td><td>业务核心竞争力，决定成败</td><td>交易（下单、支付、履约）</td><td>投入最精锐兵力</td></tr>
<tr><td><strong>支撑域</strong></td><td>支撑核心业务，但不是核心竞争力</td><td>商品管理、库存管理</td><td>自研，但不必做到极致</td></tr>
<tr><td><strong>通用域</strong></td><td>所有公司都需要，无差异化</td><td>用户认证、权限、消息通知</td><td>直接用开源/采购方案</td></tr>
</table>

```text
        电商领域 (Domain)
       ┌───────┼───────┐
       ▼       ▼       ▼
    核心域    支撑域    通用域
   ┌─────┐  ┌─────┐  ┌──────┐
   │ 交易  │  │ 商品  │  │ 用户   │
   │ 履约  │  │ 库存  │  │ 权限   │
   │ 支付  │  │ 物流  │  │ 消息   │
   └─────┘  └─────┘  └──────┘
   ★ 最重要   支持核心   通用能力
   投入最好   够用就行   买就行
```

::: tip

**实践建议：** 在做技术方案时，先把业务拆成子域，标注哪些是核心域。核心域投入最好的设计和最精锐的人力，通用域能买就买、能用开源就用开源。

:::

#### 3.3.2 限界上下文（Bounded Context）

**限界上下文是 DDD 战略设计中最核心的概念。**

回到开头那个问题：商品中心、库存、营销、搜索团队眼中的"商品"是同一个东西吗？

答案是：**不是**。每个团队对"商品"有不同的理解，不同的上下文。

<table>
<tr><th>限界上下文</th><th>"商品"的含义</th><th>关注属性</th></tr>
<tr><td>商品目录上下文</td><td>一个可售卖的东西</td><td>名称、类目、图片、描述</td></tr>
<tr><td>库存上下文</td><td>一个有库存的 SKU</td><td>SKU 编码、数量、仓库</td></tr>
<tr><td>营销上下文</td><td>一个可被促销的对象</td><td>促销价、活动标签</td></tr>
<tr><td>搜索上下文</td><td>一个可被搜索的文档</td><td>关键词、权重、热度</td></tr>
</table>

每个上下文里有自己的 `Product` 模型，它们**同名但不同义**。限界上下文就是给每个模型划定一个"语义边界"：**在这个边界内，语言是明确且统一的。**

```text
┌──────────────────────────────────────────────────────┐
│                    电商系统                            │
│                                                       │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐          │
│  │ 商品目录   │   │  库存     │   │  营销     │          │
│  │ 上下文     │   │ 上下文    │   │ 上下文    │          │
│  │           │   │           │   │           │          │
│  │ Product { │   │ Product {│   │ Product {│          │
│  │  name     │   │  sku     │   │  promoPrice│         │
│  │  category │   │  stock   │   │  tags     │          │
│  │  images   │   │  warehouse│  │  weight   │          │
│  │ }         │   │ }        │   │ }         │          │
│  └──────────┘   └──────────┘   └──────────┘          │
│                                                       │
│  每个上下文内的"Product"含义不同，各自独立演化          │
└──────────────────────────────────────────────────────┘
```

**识别限界上下文时可以观察：**

1. 这个范围内有一套**统一的领域语言**（Ubiquitous Language）
2. 它与外部有相对**清晰的边界**
3. 同一个术语、规则和模型在边界内具有一致含义
4. 跨边界交互能够通过明确的上下文映射和契约说明

::: info

**限界上下文不等于微服务。** 它首先是语言和模型的语义边界，可以和其他上下文部署在同一个单体中，也可以在需要独立演进时成为一个或多个服务。DDD 的价值是先明确业务语义边界，再决定部署与数据边界。

:::

#### 3.3.3 上下文映射（Context Mapping）

限界上下文不是孤岛，它们之间需要协作。**上下文映射**就是描述上下文之间关系的方式。

DDD 定义了 8 种上下文映射模式，实际开发中最常用的有以下几种：

#### ① 防腐层（ACL, Anti-Corruption Layer）

**最重要的模式。** 当一个上下文需要调用另一个上下文（特别是遗留系统）时，直接调用会让外部模型"污染"领域模型。防腐层就是一个翻译层，把外部模型转换成自己的模型。

```java
// 订单上下文需要调用用户中心（遗留系统）
// 不直接用用户中心的 UserDTO，而是通过防腐层翻译

// 用户中心的模型（外部，不可控）
public class LegacyUserDTO {
    private String uid;
    private String mobile;    // 手机号
    private Integer level;    // 1=普通, 2=vip, 3=svip（魔法值）
}

// 订单上下文自己的模型（可控）
public class Customer {
    private String customerId;
    private Phone phone;           // 值对象
    private CustomerLevel level;  // 枚举
}

// 防腐层：翻译
public class UserAntiCorruptionLayer {

    public Customer toCustomer(LegacyUserDTO legacyUser) {
        Customer customer = new Customer();
        customer.setCustomerId(legacyUser.getUid());
        customer.setPhone(new Phone(legacyUser.getMobile()));
        customer.setLevel(CustomerLevel.fromCode(legacyUser.getLevel()));
        return customer;
    }
}
```

::: tip

**适用场景：** 对接外部系统、遗留系统、第三方 API 时，加防腐层隔离外部模型，避免其渗透到领域层。

:::

#### ② 开放主机服务（OHS, Open Host Service）

当对外提供服务时，定义一套**标准化的开放协议**（如 REST API），让所有调用方都通过这套协议来访问。

```java
// 商品上下文对外提供开放主机服务
// 所有需要商品信息的上下文都走这套 API

@RestController
@RequestMapping("/api/products")
public class ProductOHSController {

    @Autowired
    private ProductQueryService productQueryService;

    @GetMapping("/{productId}")
    public ProductDTO getProduct(@PathVariable String productId) {
        // 返回标准化的 DTO，不暴露内部领域模型
        return productQueryService.toDTO(productId);
    }
}
```

#### ③ 发布语言（PL, Published Language）

与 OHS 配合使用，定义一套**公开的数据契约**（如 JSON Schema、Protocol Buffers），作为上下文之间通信的标准格式。

#### ④ 客户-供应商（Customer-Supplier）

两个上下文有明确的上下游关系。**供应商**（上游）提供服务，**客户**（下游）消费服务。供应商优先考虑客户的需求。

```java
// 订单上下文（客户/下游） ← 依赖 ← 商品上下文（供应商/上游）
// 商品上下文提供 API，订单上下文消费

// 供应商：商品上下文提供库存查询 API
@GetMapping("/api/products/{sku}/stock")
public Integer getStock(@PathVariable String sku) { ... }

// 客户：订单上下文调用
Integer stock = productClient.getStock(sku);
```

#### ⑤ 共享内核（Shared Kernel）

两个上下文**共享一部分模型**。风险较高——修改共享部分会影响双方，需谨慎使用。

```java
// 订单上下文和支付上下文共享 Money 值对象
// 共享内核模块：shared-kernel.jar
public class Money implements ValueObject {
    private final BigDecimal amount;
    private final Currency currency;
    // ...
}
```

::: warning

**共享内核需谨慎：** 只有在两个上下文高度耦合、频繁协作时才考虑。修改共享内核需要双方共同协商，否则容易产生"牵一发而动全身"的问题。

:::

#### ⑥ 遵奉者（Conformist）

下游团队无条件遵循上游团队的模型。通常发生在下游团队没有话语权时（如对接第三方支付平台）。

#### 其他模式

<table>
<tr><th>模式</th><th>含义</th></tr>
<tr><td>合作关系（Partnership）</td><td>两个上下文紧密协作，共同演进</td></tr>
<tr><td>各行其道（Separate Ways）</td><td>两个上下文没有关系，各自独立</td></tr>
</table>

```text
  电商系统的上下文映射示例：

  ┌──────────┐    OHS+PL     ┌──────────┐
  │  商品     │ ──────────→  │  订单     │
  │ 上下文    │  提供商品API   │ 上下文    │
  │(供应商)   │              │ (客户)    │
  └──────────┘              └────┬─────┘
       ↑                        │ ACL
       │ ACL                    │ (防腐层)
       │ (防腐层)                ▼
  ┌──────────┐              ┌──────────┐
  │  搜索     │              │ 用户中心   │
  │ 上下文    │              │ (遗留系统) │
  └──────────┘              └──────────┘
```

---

### 3.4 战术设计

战略设计划定了边界，战术设计就是在边界内部构建代码模型。这是 DDD 落地到代码的核心。

先看一张全景图，再逐个讲解：

```text
┌─── 限界上下文（如：订单上下文）──────────────────────┐
│                                                       │
│   ┌─── 聚合（Aggregate）──────────────────────┐      │
│   │                                             │      │
│   │   ┌─ 聚合根 ─────────────┐                 │      │
│   │   │  Order（实体）         │                 │      │
│   │   │  - id, status, userId  │                 │      │
│   │   │  - pay(), cancel()     │                 │      │
│   │   │  - items: List<Item>   │                 │      │
│   │   └──────────┬─────────────┘                 │      │
│   │              │ 包含                            │      │
│   │   ┌──────────┴─────────────┐                 │      │
│   │   │  OrderItem（实体）      │                 │      │
│   │   │  - productId, quantity │                 │      │
│   │   │  - subtotal             │                 │      │
│   │   └─────────────────────────┘                 │      │
│   │                                             │      │
│   │   值对象: Money, Address, OrderStatus        │      │
│   └─────────────────────────────────────────────┘      │
│                                                       │
│   领域服务: PricingService（跨聚合计算）               │
│   领域事件: OrderPlacedEvent, OrderPaidEvent           │
│   仓储: OrderRepository（持久化聚合）                   │
│   工厂: OrderFactory（创建复杂聚合）                    │
│                                                       │
└───────────────────────────────────────────────────────┘
```

#### 3.4.1 实体（Entity）

**实体**是具有唯一标识的对象。两个实体即使所有属性都相同，只要 ID 不同就是不同的实体。

实体的特征：

- 有**唯一标识**（通常是 ID）
- 有**生命周期**（创建 → 修改 → 销毁）
- 属性可以**变化**（mutable）
- 通过 ID 判断相等性，而非属性

```java
// 订单实体
public class Order {
    // 唯一标识
    private String id;

    // 业务属性
    private String userId;
    private OrderStatus status;
    private Money totalAmount;
    private Address shippingAddress;
    private List<OrderItem> items;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    // 构造方法（私有，通过工厂创建）
    private Order(String userId, List<OrderItem> items, Address address) {
        this.id = IdGenerator.next();
        this.userId = userId;
        this.items = new ArrayList<>(items);  // 防御性拷贝
        this.shippingAddress = address;
        this.totalAmount = calculateTotal();
        this.status = OrderStatus.CREATED;
        this.createdAt = LocalDateTime.now();
    }

    // 业务方法：支付
    public void pay(PaymentMethod method) {
        if (this.status != OrderStatus.CREATED) {
            throw new DomainException("订单状态不允许支付: " + this.status);
        }
        this.status = OrderStatus.PAID;
        this.updatedAt = LocalDateTime.now();
    }

    // 业务方法：取消
    public void cancel(String reason) {
        if (!canCancel()) {
            throw new DomainException("订单当前状态不可取消: " + this.status);
        }
        this.status = OrderStatus.CANCELLED;
        this.updatedAt = LocalDateTime.now();
        // 取消是一个重要的领域事件触发点
    }

    // 业务方法：发货
    public void ship(String trackingNo) {
        if (this.status != OrderStatus.PAID) {
            throw new DomainException("未支付订单不可发货");
        }
        this.status = OrderStatus.SHIPPED;
        this.updatedAt = LocalDateTime.now();
    }

    private boolean canCancel() {
        return this.status == OrderStatus.CREATED
            || this.status == OrderStatus.PAID;
    }

    private Money calculateTotal() {
        BigDecimal total = items.stream()
            .map(item -> item.getUnitPrice().getAmount()
                .multiply(BigDecimal.valueOf(item.getQuantity())))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        return new Money(total, Currency.getInstance("CNY"));
    }

    // 相等性判断：只看 ID
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Order)) return false;
        Order other = (Order) o;
        return this.id.equals(other.id);
    }

    @Override
    public int hashCode() {
        return id.hashCode();
    }

    // getter（无 setter）
    public String getId() { return id; }
    public OrderStatus getStatus() { return status; }
    // ...
}
```

::: tip

**实体设计原则：** 实体应该通过行为方法来改变状态，而不是直接暴露 setter。`order.setStatus("PAID")` 是贫血写法；`order.pay()` 是 DDD 写法。

:::

#### 3.4.2 值对象（Value Object）

**值对象**是没有唯一标识的对象，完全由它的属性值来定义。两个值对象只要属性完全相同，就是"相等"的。

值对象的特征：

- **无唯一标识**——靠属性值判断相等性
- **不可变（immutable）**——创建后不能修改
- 通常是**简单概念**：金额、地址、日期范围、颜色等
- 可以**自由替换**——因为不可变，替换等于创建新的

```java
// 金额值对象
public final class Money implements ValueObject {
    private final BigDecimal amount;
    private final Currency currency;

    public Money(BigDecimal amount, Currency currency) {
        if (amount.compareTo(BigDecimal.ZERO) < 0) {
            throw new DomainException("金额不能为负: " + amount);
        }
        this.amount = amount.setScale(2, RoundingMode.HALF_UP);
        this.currency = currency;
    }

    // 便捷构造
    public static Money of(BigDecimal amount, String currencyCode) {
        return new Money(amount, Currency.getInstance(currencyCode));
    }

    public static Money zero(String currencyCode) {
        return new Money(BigDecimal.ZERO, Currency.getInstance(currencyCode));
    }

    // 运算：返回新的 Money（不可变！）
    public Money add(Money other) {
        ensureSameCurrency(other);
        return new Money(this.amount.add(other.amount), this.currency);
    }

    public Money subtract(Money other) {
        ensureSameCurrency(other);
        return new Money(this.amount.subtract(other.amount), this.currency);
    }

    public Money multiply(int quantity) {
        return new Money(this.amount.multiply(BigDecimal.valueOf(quantity)),
                         this.currency);
    }

    private void ensureSameCurrency(Money other) {
        if (!this.currency.equals(other.currency)) {
            throw new DomainException("货币不一致");
        }
    }

    // 相等性：只看值
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Money)) return false;
        Money money = (Money) o;
        return amount.equals(money.amount)
            && currency.equals(money.currency);
    }

    @Override
    public int hashCode() {
        return Objects.hash(amount, currency);
    }

    @Override
    public String toString() {
        return amount + " " + currency.getCurrencyCode();
    }

    public BigDecimal getAmount() { return amount; }
    public Currency getCurrency() { return currency; }
}

// 地址值对象
public final class Address implements ValueObject {
    private final String province;
    private final String city;
    private final String district;
    private final String detail;

    public Address(String province, String city, String district, String detail) {
        this.province = requireNonBlank(province, "省份不能为空");
        this.city = requireNonBlank(city, "城市不能为空");
        this.district = requireNonBlank(district, "区县不能为空");
        this.detail = requireNonBlank(detail, "详细地址不能为空");
    }

    public String fullAddress() {
        return province + city + district + detail;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Address)) return false;
        Address a = (Address) o;
        return Objects.equals(province, a.province)
            && Objects.equals(city, a.city)
            && Objects.equals(district, a.district)
            && Objects.equals(detail, a.detail);
    }

    @Override
    public int hashCode() {
        return Objects.hash(province, city, district, detail);
    }
}

// 订单状态枚举（也是一种值对象）
public enum OrderStatus {
    CREATED,      // 已创建
    PAID,         // 已支付
    SHIPPED,      // 已发货
    DELIVERED,    // 已签收
    CANCELLED,    // 已取消
    REFUNDED;     // 已退款

    public boolean canCancel() {
        return this == CREATED || this == PAID;
    }

    public boolean canShip() {
        return this == PAID;
    }
}
```

::: tip

**值对象的威力：** 用 `Money` 值对象代替 `BigDecimal price` + `String currency`，货币一致性校验内聚在对象里，不会出现"金额对了但币种搞错了"的低级 bug。

:::

#### 3.4.3 聚合与聚合根（Aggregate & Aggregate Root）

**这是 DDD 战术设计中最核心、也最难掌握的概念。**

**聚合（Aggregate）**是一组相关对象的集合，它们作为一个整体被操作和持久化。

**聚合根（Aggregate Root）**是聚合的入口点，外部只能通过聚合根来访问聚合内部的对象。

```text
  聚合：订单（Order Aggregate）

  ┌───────────────────────────────────────────┐
  │              聚合根: Order                  │
  │                                             │
  │  - id: String                               │
  │  - userId: String                            │
  │  - status: OrderStatus                       │
  │  - totalAmount: Money                       │
  │  - shippingAddress: Address                  │
  │                                             │
  │  方法:                                       │
  │  - pay()                                    │
  │  - cancel(reason)                           │
  │  - ship(trackingNo)                         │
  │  - addItem(product, qty)                    │
  │  - removeItem(itemId)                       │
  │                                             │
  │  ┌──────────────────────────────────────┐  │
  │  │     OrderItem（内部实体）              │  │
  │  │  - itemId                              │  │
  │  │  - productId                           │  │
  │  │  - productName                         │  │
  │  │  - unitPrice: Money                    │  │
  │  │  - quantity: int                       │  │
  │  │  - subtotal: Money                    │  │
  │  │                                       │  │
  │  │  方法:                                 │  │
  │  │  - changeQuantity(newQty)             │  │
  │  │  - getSubtotal()                     │  │
  │  └──────────────────────────────────────┘  │
  │                                             │
  │  规则：外部不能直接拿到 OrderItem 引用       │
  │       只能通过 Order 操作                    │
  └───────────────────────────────────────────┘
```

**聚合设计的 4 条原则：**

1. **通过聚合根访问内部**：外部不能直接引用 OrderItem，必须通过 Order
2. **聚合内强一致**：聚合内的操作要么全部成功，要么全部失败
3. **聚合间按业务要求协作**：优先通过 ID 引用和领域事件保持边界；是否最终一致取决于业务不变量，不能机械套用
4. **聚合要小**：只包含必须一起修改的对象

```java
// 聚合根：Order
public class Order {
    private String id;
    private String userId;
    private OrderStatus status;
    private Money totalAmount;
    private Address shippingAddress;
    private List<OrderItem> items = new ArrayList<>();
    private List<DomainEvent> events = new ArrayList<>();

    // 添加商品项 —— 通过聚合根操作内部实体
    public void addItem(ProductInfo product, int quantity) {
        if (this.status != OrderStatus.CREATED) {
            throw new DomainException("订单状态不允许修改");
        }
        if (quantity <= 0) {
            throw new DomainException("数量必须大于0");
        }

        // 检查是否已存在相同商品
        Optional<OrderItem> existing = items.stream()
            .filter(item -> item.getProductId().equals(product.getId()))
            .findFirst();

        if (existing.isPresent()) {
            existing.get().addQuantity(quantity);
        } else {
            items.add(new OrderItem(
                IdGenerator.next(),
                product.getId(),
                product.getName(),
                product.getPrice(),
                quantity
            ));
        }
        // 重新计算总价
        recalculateTotal();
    }

    // 移除商品项
    public void removeItem(String itemId) {
        if (this.status != OrderStatus.CREATED) {
            throw new DomainException("订单状态不允许修改");
        }
        boolean removed = items.removeIf(item -> item.getItemId().equals(itemId));
        if (!removed) {
            throw new DomainException("商品项不存在: " + itemId);
        }
        recalculateTotal();
    }

    // 支付
    public void pay() {
        if (this.status != OrderStatus.CREATED) {
            throw new DomainException("订单状态不允许支付");
        }
        if (items.isEmpty()) {
            throw new DomainException("空订单不可支付");
        }
        this.status = OrderStatus.PAID;
        // 发布领域事件
        this.events.add(new OrderPaidEvent(this.id, this.userId, this.totalAmount));
    }

    // 取消
    public void cancel(String reason) {
        if (!this.status.canCancel()) {
            throw new DomainException("订单当前状态不可取消");
        }
        this.status = OrderStatus.CANCELLED;
        this.events.add(new OrderCancelledEvent(this.id, reason));
    }

    // 内部方法：重算总价
    private void recalculateTotal() {
        this.totalAmount = items.stream()
            .map(OrderItem::getSubtotal)
            .reduce(Money.zero("CNY"), Money::add);
    }

    // 获取领域事件（供基础设施层发布）
    public List<DomainEvent> pullEvents() {
        List<DomainEvent> pulled = new ArrayList<>(events);
        events.clear();
        return pulled;
    }

    // 内部实体只能返回只读视图
    public List<OrderItem> getItems() {
        return Collections.unmodifiableList(items);
    }

    // ... getter, equals, hashCode
}

// 聚合内部实体：OrderItem
public class OrderItem {
    private String itemId;
    private String productId;
    private String productName;
    private Money unitPrice;
    private int quantity;

    // 包级可见，外部不能直接创建
    OrderItem(String itemId, String productId, String productName,
              Money unitPrice, int quantity) {
        this.itemId = itemId;
        this.productId = productId;
        this.productName = productName;
        this.unitPrice = unitPrice;
        this.quantity = quantity;
    }

    void addQuantity(int qty) {
        this.quantity += qty;
    }

    public Money getSubtotal() {
        return unitPrice.multiply(quantity);
    }

    // getter（无 setter）
    public String getItemId() { return itemId; }
    public String getProductId() { return productId; }
    // ...
}
```

::: warning

**聚合大小的判断标准：** 重点不是级联删除，而是哪些业务不变量必须在一次事务中维护。Order 与 OrderItem 通常需要共同保证金额、数量等规则，因此可以位于同一聚合；Product 有独立生命周期，通常只通过 ID 引用。聚合应尽量小，但不能小到破坏必须同步成立的不变量。

:::

#### 3.4.4 领域服务（Domain Service）

有些**领域规则**不自然属于某个实体或值对象，可以放在**领域服务**中。领域服务仍表达领域概念；跨聚合加载、保存、调用外部系统和事务编排通常由应用服务负责。

典型场景：

- 涉及多个领域对象、但不归属于其中任何一个对象的业务规则
- 具有明确领域含义的无状态计算，例如跨多个定价策略计算价格
- 通过领域端口获取必要信息后完成的领域判断；外部调用本身由应用层或适配器承担

::: danger

**领域服务 ≠ 应用服务。** 领域服务包含**业务规则**，应用服务只做**流程编排**（调谁、传什么参数、存到哪）。详见 3.5 节的分层架构。

:::

```java
// 领域服务：定价服务
// 涉及多个领域对象的计算逻辑
public class PricingService {

    /**
     * 计算订单最终价格（含优惠）
     * 涉及：订单金额、优惠券、会员折扣
     */
    public Money calculateFinalPrice(Order order, Coupon coupon, CustomerLevel level) {
        Money basePrice = order.getTotalAmount();

        // 1. 应用优惠券
        Money afterCoupon = applyCoupon(basePrice, coupon);

        // 2. 应用会员折扣
        Money afterDiscount = applyMemberDiscount(afterCoupon, level);

        // 3. 计算运费
        Money shippingFee = calculateShippingFee(order.getShippingAddress());
        Money finalPrice = afterDiscount.add(shippingFee);

        // 确保最低消费
        if (finalPrice.getAmount().compareTo(new BigDecimal("0.01")) < 0) {
            throw new DomainException("订单金额异常");
        }

        return finalPrice;
    }

    private Money applyCoupon(Money price, Coupon coupon) {
        if (coupon == null || !coupon.isValid()) {
            return price;
        }
        if (price.getAmount().compareTo(coupon.getThreshold()) < 0) {
            throw new DomainException("不满足优惠券使用门槛");
        }
        return price.subtract(coupon.getDiscountAmount());
    }

    private Money applyMemberDiscount(Money price, CustomerLevel level) {
        return switch (level) {
            case NORMAL -> price;
            case VIP -> price.multiply(95).divide(100, 2, RoundingMode.HALF_UP);  // 95折
            case SVIP -> price.multiply(90).divide(100, 2, RoundingMode.HALF_UP); // 9折
        };
    }

    private Money calculateShippingFee(Address address) {
        // 偏远地区加运费等业务规则
        if (isRemoteArea(address)) {
            return Money.of(new BigDecimal("25.00"), "CNY");
        }
        return Money.of(new BigDecimal("10.00"), "CNY");
    }

    private boolean isRemoteArea(Address address) {
        // 业务规则...
        return false;
    }
}
```

#### 3.4.5 领域事件（Domain Event）

**领域事件**表示领域中发生的、有业务意义的事情。它的核心作用是**解耦**——让事件的发布者不需要知道谁在消费这个事件。

典型场景：

- 订单支付成功后 → 通知库存扣减、通知物流发货、给用户加积分
- 订单取消后 → 恢复库存、退还优惠券、发通知
- 用户注册后 → 发欢迎邮件、初始化积分账户

```java
// 领域事件基类
public interface DomainEvent {
    String getAggregateId();
    LocalDateTime getOccurredOn();
}

// 订单已支付事件
public class OrderPaidEvent implements DomainEvent {
    private final String orderId;
    private final String userId;
    private final Money amount;
    private final LocalDateTime occurredOn;

    public OrderPaidEvent(String orderId, String userId, Money amount) {
        this.orderId = orderId;
        this.userId = userId;
        this.amount = amount;
        this.occurredOn = LocalDateTime.now();
    }

    @Override
    public String getAggregateId() { return orderId; }

    @Override
    public LocalDateTime getOccurredOn() { return occurredOn; }

    public String getUserId() { return userId; }
    public Money getAmount() { return amount; }
}

// 订单已取消事件
public class OrderCancelledEvent implements DomainEvent {
    private final String orderId;
    private final String reason;
    private final LocalDateTime occurredOn;

    public OrderCancelledEvent(String orderId, String reason) {
        this.orderId = orderId;
        this.reason = reason;
        this.occurredOn = LocalDateTime.now();
    }

    @Override
    public String getAggregateId() { return orderId; }

    @Override
    public LocalDateTime getOccurredOn() { return occurredOn; }

    public String getReason() { return reason; }
}
```

领域事件的处理方式有两种：

#### 方式一：同步处理（进程内）

```java
// 事件发布器（进程内）
@Component
public class DomainEventPublisher {

    @Autowired
    private ApplicationEventPublisher springPublisher;

    public void publish(DomainEvent event) {
        springPublisher.publishEvent(event);
    }

    public void publishAll(List<DomainEvent> events) {
        events.forEach(this::publish);
    }
}

// 事件处理器：库存扣减
@Component
public class InventoryEventHandler {

    @Autowired
    private InventoryService inventoryService;

    @EventListener
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onOrderPaid(OrderPaidEvent event) {
        // 扣减库存
        inventoryService.deductStock(event.getOrderId());
    }
}

// 事件处理器：发积分
@Component
public class PointsEventHandler {

    @Autowired
    private PointsService pointsService;

    @EventListener
    public void onOrderPaid(OrderPaidEvent event) {
        // 给用户加积分
        pointsService.awardPoints(event.getUserId(), event.getAmount());
    }
}
```

#### 方式二：异步处理（消息队列）

```java
// 通过消息队列（如 Kafka/RocketMQ）异步处理
@Component
public class DomainEventPublisher {

    @Autowired
    private RocketMQTemplate mqTemplate;

    public void publish(DomainEvent event) {
        String topic = "order-domain-events";
        String tag = event.getClass().getSimpleName();
        mqTemplate.convertAndSend(topic + ":" + tag, event);
    }

    public void publishAll(List<DomainEvent> events) {
        events.forEach(this::publish);
    }
}

// 消费者：物流系统监听订单支付事件
@RocketMQMessageListener(
    topic = "order-domain-events",
    consumerGroup = "logistics-consumer-group",
    selectorExpression = "OrderPaidEvent"
)
@Component
public class LogisticsEventListener implements RocketMQListener<OrderPaidEvent> {

    @Autowired
    private ShippingService shippingService;

    @Override
    public void onMessage(OrderPaidEvent event) {
        shippingService.createShipment(event.getOrderId());
    }
}
```

::: tip

**同步 vs 异步的选择：**

- **同步不等于同事务**：进程内同步处理可以共享本地事务，跨服务同步调用通常不能自动获得同一数据库事务
- **异步与最终一致**：库存、积分等跨边界更新可以使用消息和补偿，但必须设计幂等、重试、顺序与失败恢复
- **原则**：先根据业务一致性、时延和失败语义选同步或异步，再评估吞吐；不能简单套用“能异步就异步”

:::

#### 3.4.6 仓储（Repository）

**仓储**是对聚合根持久化的抽象。它让领域层不关心数据存在 MySQL 还是 MongoDB，不关心用 MyBatis 还是 JPA。

仓储与 DAO 的关键区别：

<table>
<tr><th>维度</th><th>DAO</th><th>Repository</th></tr>
<tr><td>面向对象</td><td>数据表（面向 SQL）</td><td>聚合根（面向领域）</td></tr>
<tr><td>操作粒度</td><td>单表 CRUD</td><td>整个聚合（聚合根 + 内部实体）</td></tr>
<tr><td>职责</td><td>数据存取</td><td>聚合的持久化与重建</td></tr>
<tr><td>所属层</td><td>数据访问层</td><td>领域层定义接口，基础设施层实现</td></tr>
<tr><td>使用方式</td><td><code>orderDao.insert(order)</code></td><td><code>orderRepo.save(order)</code></td></tr>
</table>

```java
// 仓储接口（定义在领域层，依赖倒置）
public interface OrderRepository {
    void save(Order order);        // 保存整个聚合
    Order findById(String id);     // 根据ID查找聚合根
    List<Order> findByUserId(String userId);  // 按用户查找
}

// 仓储实现（定义在基础设施层）
@Repository
public class OrderRepositoryImpl implements OrderRepository {

    @Autowired
    private OrderMapper orderMapper;       // 订单表
    @Autowired
    private OrderItemMapper orderItemMapper; // 订单明细表
    @Autowired
    private DomainEventPublisher eventPublisher;

    @Override
    @Transactional
    public void save(Order order) {
        // 1. 持久化聚合根
        OrderDO orderDO = OrderConverter.toDO(order);
        if (orderMapper.existsById(orderDO.getId())) {
            orderMapper.update(orderDO);
            // 更新子实体：先删后插（简单策略）
            orderItemMapper.deleteByOrderId(orderDO.getId());
        } else {
            orderMapper.insert(orderDO);
        }

        // 2. 持久化内部实体
        for (OrderItem item : order.getItems()) {
            OrderItemDO itemDO = OrderItemConverter.toDO(item, order.getId());
            orderItemMapper.insert(itemDO);
        }

        // 3. 发布领域事件
        eventPublisher.publishAll(order.pullEvents());
    }

    @Override
    public Order findById(String id) {
        OrderDO orderDO = orderMapper.selectById(id);
        if (orderDO == null) {
            return null;
        }
        List<OrderItemDO> itemDOs = orderItemMapper.selectByOrderId(id);

        // 重建聚合根（从数据模型 → 领域模型）
        return OrderConverter.toDomain(orderDO, itemDOs);
    }

    @Override
    public List<Order> findByUserId(String userId) {
        List<OrderDO> orderDOs = orderMapper.selectByUserId(userId);
        return orderDOs.stream()
            .map(orderDO -> {
                List<OrderItemDO> items = orderItemMapper.selectByOrderId(orderDO.getId());
                return OrderConverter.toDomain(orderDO, items);
            })
            .collect(Collectors.toList());
    }
}
```

::: info

**依赖倒置原则（DIP）：** 仓储接口定义在**领域层**，实现在**基础设施层**。领域层不依赖基础设施层，而是基础设施层依赖领域层的接口。这就是"依赖倒置"——传统架构是上层依赖下层，DDD 反过来让下层依赖上层的抽象。

:::

#### 3.4.7 工厂（Factory）

当创建一个聚合根比较复杂（需要组装多个对象、需要校验前置条件、需要初始化默认值）时，用**工厂**来封装创建逻辑。

```java
// 订单工厂
public class OrderFactory {

    /**
     * 创建新订单
     */
    public static Order createOrder(
            String userId,
            List<ProductInfo> products,
            Address shippingAddress,
            Coupon coupon) {

        // 1. 前置校验
        if (products == null || products.isEmpty()) {
            throw new DomainException("订单必须包含至少一个商品");
        }
        if (shippingAddress == null) {
            throw new DomainException("收货地址不能为空");
        }

        // 2. 构建订单项
        List<OrderItem> items = products.stream()
            .map(p -> new OrderItem(
                IdGenerator.next(),
                p.getId(),
                p.getName(),
                p.getPrice(),
                p.getQuantity()
            ))
            .collect(Collectors.toList());

        // 3. 创建聚合根
        Order order = new Order(userId, items, shippingAddress);

        // 4. 如果有优惠券，绑定
        if (coupon != null && coupon.isValid()) {
            order.bindCoupon(coupon);
        }

        return order;
    }

    /**
     * 从持久化数据重建订单
     * （供 Repository 使用，不走业务校验）
     */
    public static Order rebuild(
            String id,
            String userId,
            OrderStatus status,
            Money totalAmount,
            Address address,
            List<OrderItem> items,
            LocalDateTime createdAt) {

        Order order = new Order();
        order.id = id;
        order.userId = userId;
        order.status = status;
        order.totalAmount = totalAmount;
        order.shippingAddress = address;
        order.items = new ArrayList<>(items);
        order.createdAt = createdAt;
        return order;
    }
}
```

#### 3.4.8 四色建模法（Four-Color Modeling）

**四色建模法**（Four-Color Modeling / Color Modeling in Domain Models）由 Peter Coad 提出，是一种**领域分析技术**。它通过将领域对象分为四种"原型"（Archetype），在需求分析阶段快速识别和分类领域概念，为后续的战术设计建模打下基础。

::: info

**四色建模法与 DDD 的关系：** 四色建模法可以作为领域分析工具，帮助区分人、地点、物、角色、描述以及发生在时间轴上的业务事实。四色原型与 DDD 的实体、值对象、聚合和领域事件处在不同分类维度，不能直接一一转换；完成业务分析后，还要根据标识、生命周期和一致性边界做战术设计。

:::

四种原型及对应颜色：

```text
  ┌──────────────────────────────────────────────────────────┐
  │                    四色原型分类                            │
  │                                                           │
  │   🟢 PPT (Party-Place-Thing)     事物/实体               │
  │      有唯一标识，有生命周期                                 │
  │      → 实现时常有身份，可能建模为 Entity                    │
  │                                                           │
  │   🔵 Description                  描述                    │
  │      分类/类型信息，被多个实体共享                           │
  │      → 可能是 Entity，也可能是 Value Object                 │
  │                                                           │
  │   🟡 Role                         角色                    │
  │      实体在特定上下文中扮演的角色                             │
  │      → 可能是实体、值对象或一段关联关系                      │
  │                                                           │
  │   🔴 MI (Moment-Interval)         时刻-时段/事件           │
  │      在特定时刻或时段发生的业务活动                           │
  │      → 可能是交易实体、聚合或描述其发生的 Domain Event       │
  │                                                           │
  └──────────────────────────────────────────────────────────┘
```

#### 四种原型详解

<table>
<tr><th>原型</th><th>颜色</th><th>含义</th><th>常见特征</th><th>电商示例</th><th>可能的 DDD 实现</th></tr>
<tr><td><strong>PPT</strong><br>人-地点-物</td><td style="background:#d1fae5">🟢 绿</td><td>业务中参与活动的"谁"和"什么"</td><td>常有稳定身份与生命周期</td><td>用户、商品、店铺、仓库</td><td>常建模为 Entity；是否为聚合根另行判断</td></tr>
<tr><td><strong>Description</strong><br>描述</td><td style="background:#dbeafe">🔵 蓝</td><td>对事物、角色或活动的分类与规则描述</td><td>可被多个对象引用，也可能独立版本化</td><td>商品类目、品牌定义、会员等级定义</td><td>可建模为 Entity 或 Value Object</td></tr>
<tr><td><strong>Role</strong><br>角色</td><td style="background:#fef3c7">🟡 黄</td><td>对象在特定关系或场景中的身份</td><td>依赖上下文，可能带有角色专属属性</td><td>买家、卖家、收货人、发货员</td><td>可建模为实体、值对象、关联或聚合内状态</td></tr>
<tr><td><strong>MI</strong><br>时刻-时段</td><td style="background:#fee2e2">🔴 红</td><td>在某一时刻或时段发生的业务活动与交易</td><td>具有时间、参与者和结果</td><td>订单、支付、发货、退款</td><td>可建模为交易实体/聚合；其发生事实可发布为 Domain Event</td></tr>
</table>

#### 用四色建模法分析电商交易场景

用四色建模法分析"用户下单"这个业务场景，看看如何快速识别领域对象：

**业务故事：**买家（Role）张三（PPT）在店铺（PPT）购买了两件商品（PPT），商品属于手机类目（Description），下单时（MI）选择了收货地址，使用了满减优惠券，支付成功后（MI），卖家（Role）李四（PPT）收到通知并发货（MI）。

```text
  四色分析结果：

  🟢 PPT (实体)：
     User(张三)、User(李四)、Shop(店铺)、Product(商品)、Coupon(优惠券)

  🔵 Description (描述)：
     Category(手机类目)、Brand(品牌)、MemberLevel(会员等级定义)、CouponRule(满减规则)

  🟡 Role (角色)：
     Buyer(买家) ← 张三在下单时扮演
     Seller(卖家) ← 李四在接单时扮演
     Consignee(收货人) ← 张三在收货时扮演
     Shipper(发货员) ← 仓库人员在发货时扮演

  🔴 MI (时刻-时段/事件)：
     PlaceOrder(下单)、Payment(支付)、Shipment(发货)、Delivery(签收)、Refund(退款)
```

#### 从四色到代码

四色建模先帮助梳理业务语义，再由 DDD 战术设计决定代码结构。下面展示几种可能的实现，但这些代码不是由颜色自动推导出来的：

```java
// 🟡 Role 原型：买家角色
// 一个用户在"购物"这个上下文中扮演的角色
public class Buyer {
    private String userId;          // 关联的 PPT 实体
    private MemberLevel level;      // 🔵 Description：会员等级
    private BigDecimal totalSpent;  // 累计消费（角色特有属性）

    // 角色行为：作为买家，能否使用某优惠券
    public boolean canUseCoupon(CouponRule rule) {
        return level.compareTo(rule.getRequiredLevel()) >= 0
            && totalSpent.compareTo(rule.getThreshold()) >= 0;
    }
}

// 🔴 MI 发生后发布的领域事件
// 记录"谁在什么时间下了什么单"这个已经发生的业务事实
public class PlaceOrderEvent implements DomainEvent {
    private final String orderId;
    private final String buyerId;       // 🟡 买家角色
    private final String sellerId;      // 🟡 卖家角色
    private final List<String> productIds;  // 🟢 商品 PPT
    private final Money amount;
    private final LocalDateTime occurredAt;  // 时刻

    public PlaceOrderEvent(String orderId, String buyerId, String sellerId,
                           List<String> productIds, Money amount) {
        this.orderId = orderId;
        this.buyerId = buyerId;
        this.sellerId = sellerId;
        this.productIds = productIds;
        this.amount = amount;
        this.occurredAt = LocalDateTime.now();
    }
    // ... getter
}

// 🔵 Description 的一种实现：不可变商品类目值对象
// 如果类目需要独立标识、版本和生命周期，也可以建模为实体
public final class Category implements ValueObject {
    private final String code;        // "PHONE"
    private final String name;        // "手机通讯"
    private final String parentCode;  // 父类目

    public Category(String code, String name, String parentCode) {
        this.code = code;
        this.name = name;
        this.parentCode = parentCode;
    }
    // 不可变，equals/hashCode 基于属性值
}
```

::: tip

**四色建模法的实践流程：**

1. **读需求/讲故事**：用业务语言描述场景，标注名词和动词
2. **标 PPT**：找出核心业务实体（谁？什么？）→ 绿色
3. **标 Description**：找出分类/描述信息 → 蓝色
4. **标 Role**：找出实体在不同场景中的角色 → 黄色
5. **标 MI**：找出业务事件/交易记录 → 红色
6. **映射 DDD**：再判断标识、生命周期、不变量与一致性边界，决定 Entity、Value Object、Aggregate、Domain Service 或 Domain Event

:::

::: warning

**注意：** 四色建模法是**分析辅助工具**，提供分析框架。同一个对象在不同上下文中可能属于不同原型——比如"订单"在下单上下文中是 MI（事件），但在订单管理上下文中是 PPT（实体）。用它来**加速分析**即可，无需死扣分类。

:::

---

### 3.5 DDD 分层架构

把前面讲的所有战术设计元素组合起来，就是 DDD 的**四层架构**。它比传统的三层架构多了一层"领域层"，并且依赖方向被翻转了。

```text
┌─────────────────────────────────────────────────────┐
│  用户接口层 (Interface Layer)                         │
│  Controller / DTO / Assembler                       │
│  职责：接收请求、参数校验、返回响应                      │
├─────────────────────────────────────────────────────┤
│  应用层 (Application Layer)                          │
│  ApplicationService / DTO                           │
│  职责：流程编排、事务管理、安全认证                      │
│  ✗ 不含业务规则                                        │
├─────────────────────────────────────────────────────┤
│  领域层 (Domain Layer)              ★ 核心            │
│  Entity / ValueObject / Aggregate                   │
│  DomainService / DomainEvent / Repository接口        │
│  职责：业务规则、领域模型                               │
│  ✗ 不依赖任何外部框架                                   │
├─────────────────────────────────────────────────────┤
│  基础设施层 (Infrastructure Layer)                    │
│  Repository实现 / Mapper / MQ / 外部API              │
│  职责：技术细节、持久化、消息、缓存                      │
└─────────────────────────────────────────────────────┘

依赖方向：上层 → 下层（但领域层不依赖基础设施层）
          基础设施层 → 领域层（实现领域层定义的接口）= 依赖倒置
```

与三层架构对比：

<table>
<tr><th>层</th><th>三层架构</th><th>DDD 四层架构</th></tr>
<tr><td>用户接口层</td><td>Controller</td><td>Controller + DTO + Assembler（对象转换）</td></tr>
<tr><td>应用层</td><td>（Service 的一部分）</td><td>ApplicationService（纯编排，无业务逻辑）</td></tr>
<tr><td>领域层</td><td>（混在 Service 里）</td><td>Entity + VO + Aggregate + DomainService + Repository接口</td></tr>
<tr><td>基础设施层</td><td>DAO</td><td>Repository实现 + Mapper + MQ + 外部客户端</td></tr>
</table>

代码示例——各层的职责：

```java
// ====== 1. 用户接口层 (Interface) ======
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    @Autowired
    private OrderApplicationService orderAppService;

    @PostMapping
    public Result<String> createOrder(@RequestBody @Valid CreateOrderRequest request) {
        String orderId = orderAppService.createOrder(request);
        return Result.success(orderId);
    }

    @PostMapping("/{orderId}/pay")
    public Result<Void> pay(@PathVariable String orderId) {
        orderAppService.pay(orderId);
        return Result.success(null);
    }

    @PostMapping("/{orderId}/cancel")
    public Result<Void> cancel(@PathVariable String orderId,
                                  @RequestParam String reason) {
        orderAppService.cancel(orderId, reason);
        return Result.success(null);
    }
}

// ====== 2. 应用层 (Application) ======
// 注意：应用层只做编排，不含业务规则
@Service
@Transactional
public class OrderApplicationService {

    @Autowired
    private OrderRepository orderRepository;
    @Autowired
    private ProductRepository productRepository;
    @Autowired
    private PricingService pricingService;   // 领域服务
    @Autowired
    private DomainEventPublisher eventPublisher;

    public String createOrder(CreateOrderRequest request) {
        // 1. 查商品信息（基础设施调用）
        List<ProductInfo> products = productRepository
            .findByIds(request.getProductIds());

        // 2. 工厂创建聚合根
        Order order = OrderFactory.createOrder(
            request.getUserId(),
            products,
            request.getAddress(),
            request.getCoupon()
        );

        // 3. 定价（领域服务）
        Money finalPrice = pricingService.calculateFinalPrice(
            order, request.getCoupon(), request.getCustomerLevel());
        order.setFinalPrice(finalPrice);

        // 4. 持久化
        orderRepository.save(order);

        return order.getId();
    }

    public void pay(String orderId) {
        // 1. 加载聚合
        Order order = orderRepository.findById(orderId);
        if (order == null) {
            throw new BizException("订单不存在");
        }
        // 2. 调用聚合根的业务方法（业务规则在领域层）
        order.pay();
        // 3. 持久化（仓储会自动发布领域事件）
        orderRepository.save(order);
    }

    public void cancel(String orderId, String reason) {
        Order order = orderRepository.findById(orderId);
        if (order == null) {
            throw new BizException("订单不存在");
        }
        order.cancel(reason);   // ← 业务规则在 Order 内部
        orderRepository.save(order);
    }
}

// ====== 3. 领域层 (Domain) ======
// Order, OrderItem, Money, Address, OrderStatus
// OrderFactory, PricingService, OrderRepository(接口), DomainEvent
// （前面已经展示了完整代码，这里不重复）

// ====== 4. 基础设施层 (Infrastructure) ======
// OrderRepositoryImpl, OrderMapper, OrderItemMapper
// DomainEventPublisherImpl, ProductApiClient
// （前面已经展示了 Repository 实现，这里不重复）
```

::: tip

**判断应用层是否写对了的标准：** 关注业务不变量由谁负责，而不是机械检查有没有 `if`。应用层可以为权限、幂等、错误处理和流程分支使用条件判断；像 `if (order.getStatus() == PAID)` 这类决定领域行为是否合法的规则，通常应由聚合或领域服务封装。

:::

---

### 3.6 从需求到代码：DDD 实践流程

理论讲完了，实际工作中应该怎么落地？以下是一个推荐的 DDD 实践流程：

```text
需求文档
    │
    ▼
┌──────────────────────────────────────┐
│ Step 1: 领域故事讲述                    │
│ 用业务语言描述场景，提取领域名词和动词     │
└───────────────┬──────────────────────┘
                ▼
┌──────────────────────────────────────┐
│ Step 2: 识别限界上下文                  │
│ 划分语义边界，确定微服务边界             │
└───────────────┬──────────────────────┘
                ▼
┌──────────────────────────────────────┐
│ Step 3: 划分聚合                       │
│ 在上下文内识别聚合根、实体、值对象        │
└───────────────┬──────────────────────┘
                ▼
┌──────────────────────────────────────┐
│ Step 4: 设计领域事件                   │
│ 识别关键业务事件，设计事件流             │
└───────────────┬──────────────────────┘
                ▼
┌──────────────────────────────────────┐
│ Step 5: 编码实现                       │
│ 按四层架构落地代码                      │
└───────────────┬──────────────────────┘
                ▼
┌──────────────────────────────────────┐
│ Step 6: 持续重构                       │
│ 随着业务理解加深，持续调整模型            │
└──────────────────────────────────────┘
```

#### 实战演示：以"用户下单"为例

**Step 1：领域故事**

> 用户在购物车中选择商品，点击"去结算"。
> 系统检查商品库存是否充足。
> 系统计算订单金额（商品价格 × 数量 + 运费 - 优惠券抵扣）。
> 用户确认收货地址后提交订单。
> 订单状态变为"待支付"。
> 库存被预扣减。
> 系统发送"订单已创建"通知。
> 用户在 30 分钟内完成支付，否则订单自动取消。

**Step 2：识别限界上下文**

<table>
<tr><th>限界上下文</th><th>职责</th></tr>
<tr><td>订单上下文</td><td>订单创建、状态管理</td></tr>
<tr><td>商品上下文</td><td>商品信息、价格</td></tr>
<tr><td>库存上下文</td><td>库存查询、扣减、预扣</td></tr>
<tr><td>支付上下文</td><td>支付发起、回调处理</td></tr>
<tr><td>营销上下文</td><td>优惠券、促销活动</td></tr>
</table>

**Step 3：划分聚合（以订单上下文为例）**

<table>
<tr><th>聚合</th><th>聚合根</th><th>内部实体</th><th>值对象</th></tr>
<tr><td>订单聚合</td><td>Order</td><td>OrderItem</td><td>Money, Address, OrderStatus</td></tr>
</table>

**Step 4：领域事件**

<table>
<tr><th>事件</th><th>触发时机</th><th>消费者</th></tr>
<tr><td>OrderCreatedEvent</td><td>订单创建</td><td>库存（预扣）、通知（发短信）</td></tr>
<tr><td>OrderPaidEvent</td><td>支付成功</td><td>库存（确认扣减）、物流（创建运单）、积分（加积分）</td></tr>
<tr><td>OrderCancelledEvent</td><td>订单取消</td><td>库存（恢复）、优惠券（退还）</td></tr>
<tr><td>OrderShippedEvent</td><td>发货</td><td>通知（发物流信息）</td></tr>
</table>

**Step 5：编码**

按照 3.5 节的四层架构，从领域层开始写，然后应用层，最后基础设施层和接口层。（前面已展示完整代码）

---

### 3.7 常见陷阱与最佳实践

#### 陷阱一：贫血模型伪装成 DDD

```java
// ❌ 看起来用了 DDD 的包结构，但模型还是贫血的
public class Order {
    private String id;
    private String status;
    // 全是 getter/setter，没有业务方法
    public void setStatus(String status) { this.status = status; }
}

// Service 里还是事务脚本
public class OrderService {
    public void pay(String orderId) {
        Order order = repo.findById(orderId);
        order.setStatus("PAID");  // ← 贫血！直接改属性
        repo.save(order);
    }
}

// ✅ 正确的 DDD
public class Order {
    public void pay() {  // ← 业务方法封装规则
        if (this.status != CREATED) throw ...;
        this.status = PAID;
        this.events.add(new OrderPaidEvent(...));
    }
}
```

#### 陷阱二：聚合设计过大

::: danger

**错误示例：** 把 Order、OrderItem、Product、User、Address、Coupon 全放进一个"订单聚合"。这会导致：加载一个订单要联表查 6 张表，修改一个商品名要锁整个聚合。

:::

正确做法：Product、User、Coupon 都是**独立聚合**。Order 聚合只包含 Order 和 OrderItem。需要 Product 信息时，通过 ID 引用或通过领域事件同步。

#### 陷阱三：过度设计

不是所有系统都需要 DDD。以下场景用三层架构 + 贫血模型更高效：

- 以 CRUD 为主，业务逻辑简单
- 团队只有 2-3 个人
- 没有复杂的领域规则和状态流转

**DDD 是用来解决复杂性的，不是用来制造复杂性的。**

#### 陷阱四：领域层依赖框架

```java
// ❌ 领域层依赖了 Spring 框架
@Entity
@Table(name = "orders")
public class Order {
    @Id
    @Column(name = "order_id")
    private String id;
}

// ✅ 一种低耦合做法：领域对象保持为纯 POJO
public class Order {
    private String id;
    // 没有任何框架注解
}
```

领域层应尽量保持对框架和基础设施的低耦合，以便独立测试和演化。把 JPA/Spring 注解放在独立的数据对象上是一种做法；如果团队接受少量持久化注解并能保持业务模型清晰，也不必为了“绝对零依赖”复制整套对象。关键是领域规则不能依赖数据库会话、网络客户端等运行时细节。

#### 最佳实践清单

<table>
<tr><th>原则</th><th>说明</th></tr>
<tr><td>统一语言</td><td>代码中的命名和业务术语一致，如产品说"优惠券"代码就叫 <code>Coupon</code> 而非 <code>DiscountRecord</code></td></tr>
<tr><td>聚合要小</td><td>一个聚合只包含必须一起修改的对象，宁多勿大</td></tr>
<tr><td>充血模型</td><td>业务逻辑内聚在实体/值对象中，Service 只做编排</td></tr>
<tr><td>领域层低耦合</td><td>不依赖数据库和外部服务运行时细节，可独立单元测试；框架注解按项目权衡</td></tr>
<tr><td>事件驱动</td><td>跨聚合/跨上下文用领域事件解耦</td></tr>
<tr><td>防腐层</td><td>外部模型与本域语言差异明显、且存在污染风险时增加翻译层</td></tr>
<tr><td>持续重构</td><td>领域模型不是一次设计完，随着业务理解持续调整</td></tr>
</table>

![领域驱动设计总结图](/images/tech-design-guide/summary-03.svg)

## 第四章：如何写好技术方案

前面三章讲了架构知识，但实际工作中你更需要的可能是：**接到一个需求后，怎么写出一份好的技术方案文档？**

这一章不讲理论，只讲实操。

---

### 4.1 技术方案核心要素

一份合格的技术方案应该回答以下问题：

<table>
<tr><th>要素</th><th>回答什么</th><th>常见错误</th></tr>
<tr><td>1. 背景与目标</td><td>为什么要做？做成什么样？</td><td>只抄需求文档，没有技术视角</td></tr>
<tr><td>2. 需求分析</td><td>核心业务流程是什么？有哪些边界条件？</td><td>跳过分析直接给方案</td></tr>
<tr><td>3. 架构设计</td><td>在哪个限界上下文？涉及哪些聚合？</td><td>只画一张系统架构图就完了</td></tr>
<tr><td>4. 详细设计</td><td>数据模型、接口设计、核心流程</td><td>只写接口列表，不写业务规则</td></tr>
<tr><td>5. 异常与边界</td><td>异常怎么处理？并发怎么控制？</td><td>完全不考虑异常场景</td></tr>
<tr><td>6. 影响面评估</td><td>改了哪些系统？影响哪些功能？</td><td>不评估影响面导致线上故障</td></tr>
<tr><td>7. 排期</td><td>分几个阶段？各阶段产出什么？</td><td>只给一个总工期</td></tr>
</table>

---

### 4.2 技术方案模板

以下是一个可以直接使用的技术方案模板，以"订单超时自动取消"为例：

````markdown
# 技术方案：订单超时自动取消

## 1. 背景与目标
- **背景**：用户下单后 30 分钟未支付，需要自动取消订单并恢复库存
- **目标**：实现订单超时自动取消，保证库存及时释放
- **非目标**：不处理已支付订单的退款流程（属于另一个需求）

## 2. 需求分析
### 2.1 核心流程
用户下单 → 30分钟未支付 → 自动取消 → 恢复预扣库存 → 退还优惠券

### 2.2 边界条件
- 订单状态为 CREATED 的才需要超时取消
- 已支付/已取消/已发货的订单不受影响
- 超时时间可配置（运营可调整，默认 30 分钟）
- 需要支持批量处理（不能一条一条查）

## 3. 架构设计
### 3.1 所属限界上下文
订单上下文（Order Context）

### 3.2 涉及聚合
- Order 聚合（状态变更 + 事件发布）
- Inventory 聚合（库存恢复，通过事件触发）

### 3.3 方案选型
| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 定时任务轮询 | 实现简单 | 延迟高、数据库压力大 | ✗ |
| 延迟队列（MQ） | 精准触发、解耦 | 需要引入 MQ | ✓ 推荐 |
| Redis 过期通知 | 实时性好 | 可靠性差（Redis 重启丢失） | ✗ |

**最终方案**：RocketMQ 延迟消息 + 兜底定时任务

### 3.4 领域事件流
OrderCreatedEvent → 延迟30分钟 → OrderTimeoutCheckEvent
  → 检查订单状态 → 仍为 CREATED → Order.cancel()
  → OrderCancelledEvent → 库存恢复 + 优惠券退还

## 4. 详细设计
### 4.1 数据模型变更
无新增表，Order 实体新增 expireTime 字段（记录过期时间）

### 4.2 核心接口
- 内部接口：OrderTimeoutService.checkAndCancel(orderId)
- 由 MQ 消费者触发，不对外暴露 HTTP 接口

### 4.3 核心代码逻辑
（伪代码）
```
// 消费延迟消息
onMessage(OrderTimeoutMessage msg) {
    Order order = repo.findById(msg.orderId);
    if (order.getStatus() == CREATED) {
        order.cancel("超时未支付自动取消");
        repo.save(order);  // 触发 OrderCancelledEvent
    }
    // 如果已支付，忽略即可
}
```

## 5. 异常与边界处理
- MQ 消费失败：重试 3 次，仍失败则告警
- 兜底定时任务：每 5 分钟扫描一次 CREATED 状态且超时的订单
- 并发控制：消息可能重复投递，cancel() 方法需幂等
  （已 CANCELLED 状态再取消直接返回成功）

## 6. 影响面评估
| 影响系统 | 影响点 | 风险 |
|---------|--------|------|
| 订单服务 | 新增超时取消逻辑 | 低 |
| 库存服务 | 消费 OrderCancelledEvent 恢复库存 | 已有逻辑，无改动 |
| 优惠券服务 | 消费 OrderCancelledEvent 退还优惠券 | 已有逻辑，无改动 |
| 通知服务 | 发送"订单已取消"通知 | 需新增模板 |

## 7. 排期
| 阶段 | 内容 | 工期 |
|------|------|------|
| 设计评审 | 方案评审 + 修改 | 1天 |
| 编码 | 领域层 + 应用层 + MQ 消费者 | 2天 |
| 联调 | 与库存/优惠券/通知联调 | 1天 |
| 测试 | 自测 + 提测 | 2天 |
| 上线 | 灰度发布 + 监控 | 1天 |
````

::: tip

**核心原则：** 另一个工程师按方案就能实现，不需要追问任何问题。方案中出现"到时候再说"和"这里大概"，说明设计尚未完成。

:::

![如何写好技术方案总结图](/images/tech-design-guide/summary-04.svg)

## 总结：从 CRUD 到 DDD 的认知升级

全文串联：

<table>
<tr><th>阶段</th><th>思维模式</th><th>关键词</th></tr>
<tr><td>CRUD</td><td>"数据怎么存"</td><td>表、字段、增删改查</td></tr>
<tr><td>MVC 分层</td><td>"代码怎么组织"</td><td>Controller/Service/DAO、关注点分离</td></tr>
<tr><td>充血模型</td><td>"对象应该有行为"</td><td>封装、内聚、不暴露 setter</td></tr>
<tr><td>更多架构模式</td><td>"不同维度的问题"</td><td>六边形/整洁/洋葱、CQRS、事件驱动、微内核</td></tr>
<tr><td>DDD 战略设计</td><td>"系统边界在哪"</td><td>限界上下文、子域、上下文映射</td></tr>
<tr><td>DDD 战术设计</td><td>"领域模型怎么建"</td><td>聚合、实体、值对象、领域事件</td></tr>
</table>

这个认知升级路径呈现**层层叠加**的特征：

- 再复杂的 DDD 系统，底层也有 CRUD
- 领域模型需要清晰的模块与依赖边界，但不要求一定采用 MVC
- 限界上下文可以用充血模型、函数式模型等不同方式实现，关键是保持统一语言与业务规则边界
- 再好的分层，也可以叠加六边形架构、CQRS、事件驱动——它们是正交的

**架构能力不是背概念背出来的，是在一个个需求中磨出来的。**
