# OCMS 与 OpenEMS 云端多租户协同设计

> 版本：2.2 · 2026-10-17
>
> 状态：工程设计基线，待实现和联调验证。
>
> 核心决策：OCMS 独立部署，通过 API 和直接读写 OpenEMS 侧数据库集成；租户、资产和设备授权共用一套主数据，运行时状态与业务流程分别管理。
>
> 本文替代本文件旧版“分离部署、纯 API 集成”方案。旧版内容可通过 Git 历史查阅。2.1、2.2 不改变 2.0 的架构，只把对源码 commit `01083d6`（本机 `/opt/openems/source`，分支 `develop`）已核对的行为写入第 3.3、5.5、6.4 和 6.5 节。部署用的 JAR 若不是该 commit，须重跑同一组契约测试。

## 1. 需求、范围与设计依据

### 1.1 已明确的需求

1. OCMS 是独立的云端业务管理系统，承担统一门户、站群监控、资产运营、告警处置、运维工单及后续收益分析。
2. OCMS 与 OpenEMS 云端多租户模块分别承担业务管理和接入运行职责，两者独立部署。
3. OCMS 通过 OpenEMS API 和直接读写 OpenEMS 侧数据库两条链路集成。
4. 优先交付电站接入、监控和告警工单闭环；远程调度、收益结算逐步建设。
5. OCMS 页面原生呈现业务数据，按场景逐步覆盖现有 UI 和 Grafana 的业务功能。

### 1.2 本版采用的设计默认值

以下是本版的工程选择，不代表现有环境已具备这些能力：

- 两套系统由同一运营主体维护，数据库通过受控内网连接；数据库连接仅由服务端持有。
- 首期采用 OCMS 模块化单体和 OpenEMS Metadata.Tenant 插件。公共租户管理模块具有独立代码边界，先部署在 OCMS 进程内，对其他应用提供管理 API。
- 首期一个区域、一个 OpenEMS 集群；数据模型预留多个集群。每个集群首期只有一个活动 Backend 状态写入者，网关可按验证结果扩展。
- 公共元数据库位于 OpenEMS 侧。OCMS 业务库独立，首期可以同机部署，但使用不同数据库和账号。
- 首期账号与会话由公共身份模块管理；预留外部身份提供方 subject 映射，企业 SSO 按实际需求接入。
- 沿用 Java 21、Spring Boot、Vue 3、TypeScript 和 ECharts 的技术方向。OpenEMS 与依赖的准确版本须在阶段 0 锁定，OSGi 插件按目标版本编译。
- 元数据和原始遥测采用不同写入策略：OCMS 可维护获准的管理字段；Backend 维护设备实际状态和实际配置；原始遥测由采集链路写入。

若未来由不同主体运营两套系统，或要求跨区域独立容灾，应另行设计服务 API 与区域数据投影；不能直接将本版的数据库直连拓扑扩大到不可信网络。

### 1.3 与现有文档和代码的关系

- [OpenEMS 云端多租户模块设计](openems_multitenant_design.md)：提供 Metadata.Tenant、租户层级、角色映射和去 Odoo 化的基础。双方共享主数据，不重复建设租户与资产后台。
- [Odoo 集成指南](OPENEMS_ODOO_INTEGRATION_GUIDE.md)和[原生部署指南](OPENEMS_ODOO_NATIVE_HOST_INSTALLATION.md)：作为存量环境和迁移来源参考。
- [储能监控功能报告](储能管理系统监控侧功能全景报告_2026-10-14.md)：用于功能范围和点位验收对照。

仓库当前主要包含文档、Odoo 扩展和演示脚本，尚无 OCMS 或 Metadata.Tenant 的完整实现。多租户旧方案中单独 Tenant Admin Service、单一 edge_id 主键、仅通知刷新、简化回滚和整体 BYPASSRLS 等内容，在本次协同工程中按本文约束落实。本文没有宣称修改 OpenEMS 核心或网关一定为零；目标版本适配工作由阶段 0 确定。

## 2. 架构决策与职责

### 2.1 总体架构

~~~mermaid
flowchart TB
    Portal["OCMS 门户"] --> OCMS["OCMS 业务服务"]
    OCMS --> Tenant["统一租户与资产管理模块"]
    OCMS --> Biz[("OCMS 业务库")]

    subgraph Cloud["OpenEMS 云端"]
        Api["B2B REST / WebSocket"]
        Backend["OpenEMS Backend"]
        Metadata["Metadata.Tenant"]
        MetaDB[("公共元数据库 PostgreSQL")]
        Influx[("原始时序库 InfluxDB")]
        Gateway["Edge 接入网关"]

        Api <--> Backend
        Backend <--> Metadata
        Metadata -->|"加载主数据和授权"| MetaDB
        Metadata -->|"状态、配置、应用结果"| MetaDB
        Backend --> Influx
        Backend <--> Gateway
    end

    Tenant -->|"直接读写管理数据"| MetaDB
    OCMS -->|"读取资产、状态和应用结果"| MetaDB
    OCMS <-->|"实时订阅、配置与控制"| Api
    OCMS -->|"受授权约束的历史查询"| Influx
    Gateway <--> Edge["现场 Edge"]
~~~

### 2.2 三个职责边界

| 边界 | 负责内容 | 数据写入原则 |
| :--- | :--- | :--- |
| 公共租户与资产管理模块 | 租户、身份、成员关系、站点、设备登记、授权、接入密钥、审计 | 管理数据统一经过同一领域校验和事务入口 |
| OpenEMS Backend / Metadata.Tenant | Edge 接入鉴权、角色映射、实时通道、RPC 路由、运行状态、实际配置、原始时序 | 写入设备实际观测结果与元数据应用状态 |
| OCMS 业务模块 | 站群展示、业务告警、通知、工单、电价、分析和收益结果 | 写 OCMS 业务库；公共资产通过内部 UUID 引用 |

逻辑上存在独立公共模块，不要求首期拆成更多网络服务。其他应用的管理操作调用该模块 API；OCMS 内部调用同一模块。原生 OpenEMS UI 中涉及设备认领、授权、用户设置的写方法，适配到同一管理入口或明确禁用相应入口，不能产生另一套写入规则。

### 2.3 API 与数据库的分工

| 场景 | 主路径 | 一致性语义 |
| :--- | :--- | :--- |
| 资产列表、租户、站点和授权维护 | OCMS 管理模块直连公共 PostgreSQL | 提交后形成新版本；运行侧应用另行确认 |
| 在线状态与实时功率 | OpenEMS WebSocket / 查询 API | 携带接收时间与质量标记，超时转 UNKNOWN |
| 设备列表的状态摘要 | 公共 PostgreSQL 运行状态表 | 允许批量回写延迟，展示观测时间 |
| 历史曲线和报表 | OCMS 时序适配器直接查 InfluxDB | 固定查询模板、设备范围和聚合口径 |
| 历史兼容性验证 | OpenEMS 历史查询 API | 与直查结果做样本对照，不自动混用两种口径 |
| 远程组件配置、通道写入与调度 | OpenEMS API | 区分请求受理、响应和实际生效 |
| 告警确认、工单和业务审计 | OCMS 业务库 | 本地事务；跨库关联通过事件与重试处理 |

OCMS 的数据库直连封装在明确的数据访问模块中。业务模块不散落手写 OpenEMS 表结构的 SQL，前端不能提交任意 SQL、Flux 或数据库凭据。

## 3. 统一数据模型与写入权

### 3.1 存储边界

采用两个逻辑数据库：

- OpenEMS 侧公共元数据库：tenant schema 保存身份与管理主数据，runtime schema 保存运行观测，integration schema 保存可靠变更及应用结果。
- OCMS 业务库：ocms schema 保存告警、通知、工单、命令跟踪、电价和报表。

schema 名称是本项目新建契约，不是 OpenEMS 自带的标准表。具体 DDL、索引和迁移脚本在实现阶段生成，由单一迁移发布流程管理；应用账号无 DDL 权限。跨库引用使用 UUID，不依赖跨库外键或跨库 ACID 事务。

### 3.2 核心表契约

| 表 | 必需的主要信息 | 主写入方 |
| :--- | :--- | :--- |
| tenant.tenant / tenant_closure | 租户 UUID、层级关系、状态、revision | 公共管理模块 |
| tenant.app_user / user_session | 用户 UUID、登录标识、凭据哈希或外部 subject、会话期限 | 公共身份模块 |
| tenant.tenant_membership | 用户、租户、管理角色、状态和 revision | 公共管理模块 |
| tenant.site | 站点 UUID、tenant_id、时区、地理位置和额定参数 | 公共管理模块 |
| tenant.openems_cluster | 集群 UUID、API 地址、时序连接引用、凭据引用 | 平台管理入口 |
| tenant.edge | asset_id、tenant_id、site_id、cluster_id、remote_edge_id、管理状态、revision | 公共管理模块 |
| tenant.edge_credential | asset_id、密钥版本、密文、哈希、启用/过渡/撤销状态、到期时间 | 公共管理模块 |
| tenant.edge_grant | 用户或服务身份、asset_id、设备角色、revision | 公共管理模块 |
| tenant.audit_log | 操作主体、租户、对象、变更摘要、请求 ID、时间 | 公共管理模块，仅追加 |
| runtime.edge_status | asset_id、在线状态、汇总状态、observed_at、producer_epoch、sequence | Backend / Metadata |
| runtime.edge_config_snapshot / edge_config_history | asset_id、实际配置、配置版本或哈希、来源时间、变更记录 | Backend / Metadata |
| runtime.edge_registry | asset_id、cluster_id、remote_edge_id、启用标志等接入必要信息 | 公共管理模块 |
| integration.change_event / change_delivery | 事件 ID、对象 revision、事件类型、目标、投递状态和重试信息 | 事务生产者及投递器 |
| integration.runtime_event / runtime_delivery | 运行事件 ID、asset_id、连接代次、发生/观测时间、状态变化和消费确认 | Backend 事件适配器及 OCMS 消费者 |
| integration.consumer_state | 消费者、启动代次、加载水位、网关观测信息、最近对账时间 | Metadata / 应用确认组件 |
| ocms.alarm_rule / alarm_event / alarm_occurrence | 规则、活动事件、重复发生周期、信号质量和处置状态 | OCMS 告警模块 |
| ocms.work_order / work_order_log | 工单、状态机、负责人、验收和流转记录 | OCMS 运维模块 |
| ocms.command / command_attempt | 命令 ID、目标、期望版本、有效期、尝试及执行证据 | OCMS 命令模块 |
| ocms.notification_outbox | 消息、渠道、幂等键、发送结果 | OCMS 通知模块 |
| ocms.tariff / settlement_result | 时区、电价版本、计算区间、口径版本和数据质量 | OCMS 分析模块 |

runtime.edge_registry 是主数据的接入投影，和 tenant.edge 在同一公共库事务内更新；不含用户密码、业务权限或完整接入密钥。它用于将运行账号限制到明确的集群和资产集合，不能形成独立资产源。

### 3.3 设备身份与历史归属

- asset_id 为 OCMS 与公共平台使用的内部 UUID。
- 集群内的设备名保留为 remote_edge_id；数据库唯一约束为 (cluster_id, remote_edge_id)。
- OpenEMS API 使用目标集群的 remote_edge_id；OCMS API 和业务关联统一使用 asset_id。
- InfluxDB 的实际 edge 标签与 API 名称不同。commit `01083d6` 的 `Timedata.InfluxDB` 用 `parseNumberFromName(edgeId)` 取名称末尾的数字作为标签值，例如 `edge0` 写成 `0`，`site0` 也写成 `0`；名称不以数字结尾时写入失败。因此 remote_edge_id 必须是“非数字前缀 + 数字”，且该数字在同一个 bucket + measurement 内唯一。多个集群要么各用独立 bucket，要么在平台范围分配互不重复的数字。存储标识映射保存 (bucket, measurement, 数字标签)。迁移时不擅自重写已有标签。
- Edge 的 site_id 和 tenant_id 必须一致，使用约束或事务内校验保证。
- 首期不开放自助跨租户资产转移。后续通过受审计迁移任务完成，默认不把旧租户期间的历史和工单权限自动授予新租户；按资产归属有效时间段过滤查询。
- 首期不开放设备跨集群迁移。后续增加带有效时间的存储定位历史，保证旧时序仍可路由；禁止把旧 remote_edge_id 立即复用为另一资产。

### 3.4 写入边界

OCMS 管理模块可写登记信息、管理状态、授权和凭据生命周期。Backend 可写实际在线状态、实际配置、固件版本观测和执行反馈。字段按上述领域拆表，禁止双方对同一资产做全行覆盖更新。

配置需求存入 ocms.command；实际配置进入 runtime.edge_config_snapshot。修改期望配置不会直接修改实际配置快照。

OCMS 默认只读原始遥测。数据修复使用单独受审计的维护任务；派生结果写入独立业务表或独立 measurement/bucket，并记录算法版本与来源范围。

## 4. 身份、授权与租户隔离

### 4.1 身份和权限只有一个公共来源

公共身份模块负责登录与会话；OCMS 和 Metadata 使用同一用户 UUID 及有效授权。业务角色与设备角色分开：

| 公共管理角色 | 设备侧映射原则 | OCMS 业务权限 |
| :--- | :--- | :--- |
| PLATFORM_ADMIN | 显式平台特权，单独审计 | 平台配置和全局运营 |
| TENANT_ADMIN | 仅对被授予的租户资产映射 ADMIN | 本租户组织、资产和人员管理 |
| INSTALLER | 被授予资产的 INSTALLER | 调试安装、配置操作 |
| OPERATOR | 按设备能力映射 OWNER 或更窄权限 | 监控、告警处置和获准控制 |
| VIEWER | GUEST | 只读展示 |

工单派单、财务分析等角色属于 OCMS 业务权限，不自动增加设备控制权限。父子租户的数据可见性和代管规则需显式配置；停用、撤销和管理状态限制优先于角色的最大值合并。

### 4.2 数据库访问

- ocms_manager：按用户授权和事务级租户上下文访问管理表；不是表所有者、超级用户或 BYPASSRLS 角色。
- ocms_reader：只读运行摘要和允许的主数据视图。
- backend_runtime：仅写本集群的运行状态、配置和消费结果；通过专用视图或受限函数读取本集群必要主数据和密钥。
- migration_owner：仅用于迁移发布，不作为应用连接账号。

RLS 使用 USING 和 WITH CHECK 限制读写；租户上下文由服务端验证后的授权生成，在事务内 SET LOCAL，缺失上下文默认拒绝。RLS 用于约束数据访问，不能代替服务端权限判断。跨租户平台操作使用独立受审计路径，不能由客户端自报平台身份。

### 4.3 API 和时序访问

OCMS 先授权 asset_id，再从公共库解析 cluster_id、remote_edge_id 和时序标识。B2B 服务身份按集群和可访问租户/资产范围授权，区分只读与控制权限；不把一个全平台管理员凭据用于所有请求。所有控制审计保留原始人类操作者和服务身份。

对 commit `01083d6`，B2B WebSocket 在握手时、B2B REST 在每个请求上读取 HTTP Basic，并调用 `AuthUserPasswordAuthenticationService.authenticateWithPassword`。一条连接只有这一个 OpenEMS 用户，JSON-RPC 里不能再换成最终用户。随后每个方法执行 `metadata.assertRoleIsAtLeast(user, edgeId, role, method)`，设备角色来自 Metadata 里该用户对该 Edge 的授权。因此同一服务身份可以按资产映射不同角色，但一次连接不能代表多名最终用户。`Metadata.Tenant` 必须提供该认证服务；只读方法要求至少 `GUEST`，`setGridConnSchedule` 与 Edge 侧 `setChannelValue` 要求 `ADMIN`。OCMS 把 `OPERATOR` 映射为 `OWNER` 时，不能假定该身份可以执行这两项写操作。

首期服务身份与凭据选择器由公共身份模块管理，禁止客户端指定服务账号。权限撤销后立即阻止新的 OCMS 请求，并关闭相应门户订阅；OpenEMS 侧缓存和存量会话撤销按第 5 节同步确认。

直接查询 InfluxDB 的授权由 OCMS 时序适配器执行，查询条件来自已授权资产集合。共享 bucket 的 token 不能充当按 edge 标签隔离的证明。需要独立存储隔离的租户再启用独立 bucket 及适配路由，先验证目标 Timedata 写入路径。

## 5. 元数据变更与生效确认

### 5.1 同库事务和持久事件

一次设备注册、密钥轮换或授权变更，在公共元数据库的同一事务中完成：

1. 校验操作权限、对象状态和预期 revision。
2. 修改管理表；必要时同步 runtime.edge_registry 投影。
3. 追加脱敏审计记录。
4. 插入 integration.change_event，包含 event_id、aggregate_id、revision、事件类型和目标集群。
5. 为每个应接收的活动消费者建立投递记录。

事件仅携带对象引用和版本，不携带明文密钥。提交后返回 operation_id 和 PENDING_APPLY，不直接报告“已生效”。OCMS 业务库中的显示缓存异步更新，失败不撤销已提交的公共库事务。

### 5.2 投递、幂等与对账

- 使用持久投递表、租约、重试时间和唯一键 (event_id, consumer_id)。
- 多消费者广播时分别确认投递；不能让多个 Backend 竞争同一条事件后仅一个收到。
- 消费者按对象 revision 应用；重复事件无副作用，旧版本不得覆盖新版本。
- 密钥撤销和设备停用保留 tombstone 及版本，不能仅物理删除后依赖缓存自行发现。
- NOTIFY 作为唤醒提示，持久事件和周期对账负责恢复。事件发布前后都可能断线，不能仅靠通知保证送达。
- 不以数据库 sequence 的最大值直接证明之前所有事务已消费；按实际投递记录确认，避免提交顺序与序号分配顺序不同造成跳过。
- 新消费者先注册、建立一致性全量快照，再补齐覆盖该快照边界的事件。具体快照与事件覆盖实现须通过并发写入测试。
- 消费者停用、网关替换和事件清理需要受审计的生命周期规则，避免以删除未确认目标伪造完成。

### 5.3 Backend 与网关确认

操作跟踪至少区分：

| 状态 | 含义 |
| :--- | :--- |
| PENDING_APPLY | 公共库事务已提交 |
| BACKEND_APPLIED | 目标 Backend 已加载相应对象版本 |
| GATEWAY_PENDING | 涉及接入密钥，仍等待网关应用证据 |
| APPLIED | 所有必需目标达到要求的版本和会话处理条件 |
| RETRYING / FAILED | 暂时失败或需人工处理 |
| SUPERSEDED | 已被较新版本取代 |

现有 UpdateMetadataCache 是目标 OpenEMS 契约的核验项，本文不假定它自带版本确认协议。阶段 0 必须验证网关确认能力；如无确认，需要实现版本回执/观测适配。受控握手可作为新密钥验证的补充，但不能单凭一次成功握手证明所有网关已同步。

普通设备属性可在 BACKEND_APPLIED 后完成；密钥撤销、设备停用还必须核对网关缓存和已有连接。修改鉴权映射不会自然证明存量连接被断开，需明确强制断开或重认证机制及回执。

### 5.4 密钥轮换和撤销

- 使用密码学安全随机数生成接入密钥；公共库保存密文、哈希和版本，加密主密钥与数据库分开管理。
- 正常轮换允许两个有效版本共存，过渡期有明确截止时间。网关兼容多密钥映射由联调确认。
- 新版本应用并验证后再撤销旧版本；过渡期结束通过持久事件触发撤销，不依赖单进程内存定时器。
- 紧急撤销立即拒绝新的 OCMS 控制请求，推动网关撤销和连接处理；UI 展示各目标的确认状态。
- 首期 Backend 冷启动必须从公共数据库加载已提交的最新凭据状态；不启用陈旧磁盘凭据快照回退。
- 元数据库失联时，网关接入的缓存可用期必须有上限。基线为最后成功对账后 5 分钟，超期拒绝新握手，原有连接可继续采集；这期间撤销传播的最大延迟须明确展示。该限制需要网关或接入层适配，验证不通过不得宣称具备该降级行为。
- 缓存 TTL、批量回写周期等为可配置设计默认值，最终根据验收结果锁定。

### 5.5 运行事件与告警补偿

管理变更事件与运行事件分开存储。运行事件由 Backend 侧事件适配器生产，至少包含连接上下线、汇总状态变化及告警所需的选定原生状态通道变化。commit `01083d6` 的 `Edge.Events` 只覆盖在线、汇总状态、配置、版本、产品类型和最后消息时间，没有单个通道的变化事件；选定状态通道的变化须由 B2B 订阅流转换，或新增 Backend 挂点，选择在阶段 0 确定。每条事件具有 event_id、asset_id、producer_epoch、sequence、occurred_at（可得时）、observed_at、事件类型、配置版本和状态载荷。

- 运行事件先持久化到公共库 integration.runtime_event，再向 OCMS 提示有新事件；相应已持久化运行摘要与事件在同一事务中更新。摘要可批量回写，但事件不能因合并最终状态而被丢弃。
- OCMS 通过受授权的数据库访问模块读取未确认投递；后台消费身份仅能读取其被分配的资产范围，并更新自己的消费确认记录。
- OCMS 在业务库同一事务中写消费去重记录（event_id 唯一）、告警发生周期与通知待发送记录；事务提交后才确认公共库投递。确认丢失可重放，不能先确认后落业务库。
- 按同一资产的生产者代次和序号处理；缺少前序或发生切换时标记缺口并对账，不把全局最大事件 ID 当作连续消费证明。
- 默认保留运行事件 30 天；未确认事件不能被常规清理静默删除。接近容量上限或保留边界需告警；强制清理须留下缺口记录，并将消费者标记为需要重新对账。
- OCMS 停机期间先离线后上线，或原生故障发生后恢复，只要事件已完整持久化且仍在保留范围内，恢复后按发生时间重放并补建相应历史周期；恢复后的当前状态不被旧故障覆盖。
- 数据库不可用、Backend 事件采集进程停机或上游未提供变化期间，不承诺重建全部瞬态事件。恢复时记录不确定区间，核对当前状态，并在可用时借助历史数据补查；质量不足时保持 UNKNOWN，不能宣称该区间正常。
- 高频遥测默认不逐点写入运行事件表。阈值规则中断期间的补算取决于历史点位、采样精度和数据完整性；无法证明持续超限时标记未覆盖区间，不伪造满足防抖条件的告警。

因此首期保证为“已持久化运行事件可重放、恢复后当前状态可核对、不可重建区间可识别”，不承诺采集源中断期间的完整事件历史。

## 6. OpenEMS API 集成契约

### 6.1 适配器边界

OCMS 通过 OpenemsRuntimeClient 封装 WebSocket、REST、身份选择、错误映射和版本差异。目标版本建立能力矩阵，区分：

- 已验证的上游方法；
- 需启用配置或权限的方法；
- 需项目新增的网关确认、事件或管理接口。

B2B 原生认证方式按目标版本核验，不把 OCMS 登录令牌直接假定为 OpenEMS 可接受的令牌。TLS 终止点、内部明文端口和反向代理配置在部署清单中单列，端口号本身不代表已启用 HTTPS/WSS。

### 6.2 实时数据

基本能力包括 subscribeEdgesChannels、edgesCurrentData、getEdgesStatus 和 getEdgesChannelsValues。订阅器负责订阅集合、请求计数、重连、重新授权及取消订阅。

getEdgesStatus 的响应字段是 `online`（`GetEdgesStatusResponse.EdgeInfo`），不是 `isOnline`。订阅的替换语义、`count`、推送周期和全量快照行为，以第 6.5 节对 commit `01083d6` 的核对为准；其他版本须重跑同一组测试。

实时缓存键为 (asset_id, channel_address)，记录：

- value、source_timestamp（源提供时）、received_at；
- quality：GOOD / STALE / UNKNOWN / INVALID；
- connection_epoch、配置版本和已知数据缺口。

没有源时间戳时不得把 received_at 伪装为设备采样时间。缺少通道或 null 不能转换成零。长时间没有变化也不一定代表失联，新鲜度结合连接心跳、在线状态和按需取样判断。

### 6.3 历史查询与口径

直查 InfluxDB 和 OpenEMS 历史 API 使用独立适配器，共用单位、时区及结果 DTO。首期选定直查作为 OCMS 常规历史路径，API 用于兼容性和对照；未经对照验收不做静默回退。

以下是需针对部署版本验证的 JSON-RPC 示例：

~~~json
{
  "jsonrpc": "2.0",
  "id": "00000000-0000-4000-8000-000000000001",
  "method": "edgeRpc",
  "params": {
    "edgeId": "edge0",
    "payload": {
      "jsonrpc": "2.0",
      "id": "00000000-0000-4000-8000-000000000002",
      "method": "queryHistoricTimeseriesData",
      "params": {
        "timezone": "Asia/Shanghai",
        "fromDate": "2026-10-01",
        "toDate": "2026-10-01",
        "channels": ["_sum/EssActivePower"],
        "resolution": {"value": 5, "unit": "Minutes"}
      }
    }
  }
}
~~~

历史 API 示例的日期是站点本地日历日；目标解析器可能把 toDate 转为次日零点。OCMS 内部统一使用带时区边界的 [start, end) 区间，由适配器转换，避免跨日和夏令时错误。响应结构、Excel 导出的编码形式与大小限制由契约测试确定，不预设为未经包装的二进制流。

必须统一：measurement/bucket、存储 edge 标识、通道名称、单位、累计量重置、稀疏变化值的保持语义、降采样、缺失数据和保留策略。大范围查询限制资产数、通道数、时间跨度和点数；报表采用异步任务，不占用实时接入线程。

### 6.4 配置与控制

配置读写、通道操作和调度只使用第 6.5 节列出的方法。`setGridConnSchedule` 在 commit `01083d6` 中存在，但 Backend 把目标组件固定为 `ctrlBalancingSchedule0`，站点没有该组件时调用失败，不能当作通用调度接口。不同控制器的可写通道、控制模式、权限和生效周期由设备能力清单描述，不能仅凭通道名称推断控制语义。OCMS 对 `edgeRpc` 使用方法白名单：未列出的方法一律拒绝，其中包括指向 `_host` 的 `executeSystemCommand`、`executeSystemUpdate` 和 `executeSystemRestart`。

命令必须包含 command_id、asset_id、操作者、期望配置版本、参数、有效期和业务幂等键。OCMS 存储发出前的意图与每次尝试：

- 收到成功响应表示协议层完成到何种阶段，由适配器明确。
- 配置应用通过重新读取配置版本/哈希确认；控制效果通过相应运行通道确认。`getEdgeConfig` 返回的是 Backend Metadata 中缓存的配置，Edge 回传新配置后才会更新。确认须轮询到哈希变化或等到 `ON_SET_CONFIG` 运行事件，并设置超时；写入后立即读一次得到旧配置，不能据此判定失败。
- 发送后超时标记 UNKNOWN，先核对实际状态。对可能有副作用的操作不得盲目重发。
- 并发配置使用期望版本检查；回滚重新生成受授权命令，不能直接覆盖数据库快照。
- 在线控制要求新鲜状态；断线后不自动重放已过期命令。
- 高影响控制需要额外确认、参数边界与审计；现场保护和紧急停机能力由设备及边缘控制保持，云端不承担确定性保护承诺。

### 6.5 源码 commit 01083d6 已核对的行为

核对范围是该 commit 的 B2B、Backend JSON-RPC 和 Edge `Controller.Api.Backend`，不是本机未提交的本地补丁。部署 JAR 的 commit 不同时，下面各项都要重测。

| 项 | 已核对的行为 | 对 OCMS 的约束 |
| :--- | :--- | :--- |
| 订阅请求 | `subscribeEdgesChannels` 的参数是 `count`、`ids`、`channels`。源码注释里的 `edgeIds` 与实际解析字段不一致 | DTO 使用 `ids`。`getEdgesStatus` 才使用 `edgeIds`；`getEdgesChannelsValues` 使用 `ids` 和 `channels` |
| 订阅替换 | 每个连接只保留一组订阅；`count` 更大的请求整体替换旧订阅 | 增减 Edge 或通道时发送完整集合并递增 `count`。重连后同样全量重订阅 |
| 推送 | `SubscribedEdgesChannelsWorker` 每 2 秒推送一次 `edgesCurrentData`，内容是所订阅通道的全量快照，不是增量 | 站群展示和告警以秒级为下限。OCMS 自己做变化检测。单连接订阅规模设上限，超出时按 `remote_edge_id` 分片为多条连接，每条独立维护 `count` |
| 通道值 | 值来自 Backend 的 Edge 通道缓存；未上报的通道为 JSON `null` | `null` 不能当成 0。Edge 默认 `persistencePriority = HIGH`，只上报不低于该级别的通道。开局模板必须显式设置该参数，并在验收时确认告警所用通道非 `null`；持续为 `null` 走数据质量告警 |
| 历史查询 | `edgeRpc` 下由 Backend 处理 `queryHistoricTimeseriesData`、`queryHistoricTimeseriesEnergy`、`queryHistoricTimeseriesEnergyPerPeriod`、`queryHistoricTimeseriesExportXlxs` | Excel 导出是 JSON 里的 Base64 字段 `payload`，不是裸二进制流。查询队列满时，拒绝处理器只计数；`DebugExecutor.submit` 返回的 future 永远不会完成，`B2b.Rest` 又无超时地 `get()`，请求会一直挂起并占住 Jetty 线程。OCMS 必须设置客户端超时，并按 `queryThreadPoolSize` / `queryThreadPoolMaxQueueSize` 限制并发；超时后不能立即重发，要退避并监控 OpenEMS 侧拒绝计数和 `B2b.Rest` 可用性 |
| 配置方法 | Edge 把 `createComponentConfig`、`updateComponentConfig`、`deleteComponentConfig` 登记为顶层方法，并在内部转到 `_componentManager` 的 `componentJsonApi` | 经 `edgeRpc` 直接发送这三个方法。`getEdgeConfig` 由 Backend 从元数据回答，不转发到 Edge |
| 调度 | `setGridConnSchedule` 在 Backend 包装成对 `ctrlBalancingSchedule0` 的 `componentJsonApi`，并要求 `ADMIN` | 通用调度改为对 `getEdgeConfig` 中实际存在的调度组件发送 `componentJsonApi` |
| 系统日志 | `subscribeSystemLog` 的回推按 `Ui.Websocket` 的连接标识投递 | 经 B2B 转发时请求可以到达 Edge，日志回不到 OCMS 连接。本期不提供远程系统日志 |
| 监听端口 | `B2b.Websocket` 默认 8076，`B2b.Rest` 默认 8075，`Edge.Manager` 默认 8083。`B2b.Rest` 是 `new Server(port)`，进程内没有 TLS | 端口号不表示已经启用 HTTPS/WSS，TLS 在反向代理终结。本机 Edge 的 `Controller.Api.Websocket` 已占用 8075，启用 `B2b.Rest` 时必须改端口；本机 `Edge.Manager` 为 8085，`Backend.Edge.App` 为 8084 |

同一 OpenEMS 集群的 B2B 实时订阅只由一个 OCMS 实例持有。其他实例通过内部总线或第 5.5 节的运行事件消费，避免每个实例各订一份而产生重复告警。主实例失联后由新的持有者全量重订阅。

B2B 一条连接只对应一个 OpenEMS 用户和一组订阅。第 4.3 节按集群和资产范围划分服务身份后，连接数为“每个集群 × 每个服务身份 × 分片数”，全部由该集群的订阅主实例持有。每个资产只放在一个只读服务身份的订阅里，避免同一 Edge 被订阅两次；控制用服务身份默认不建立常驻订阅，只走按需的请求–响应调用。

## 7. OCMS 业务设计

### 7.1 门户与监控

首期页面包含租户/站点列表、单站概览、能量流、历史曲线、设备状态、告警中心和工单。每个指标显示单位、时间范围和数据质量。

BMS 热力图和拓扑图以真实点表为前提：建立组件发现、通道映射、单位及枚举字典；缺少电芯级点位时显示已具备的聚合层级。远程工程调试功能按能力清单逐项开放，原生 UI / Grafana 在迁移期保留工程对照用途。

### 7.2 告警与状态恢复

OpenEMS 提供原始状态、通道和连接信息，OCMS 负责业务告警判定、确认、升级、通知和工单。Backend 原有邮件通知在切换后按规则停用或标明独立用途，避免双重通知。

| 类型 | 输入 | 恢复条件 |
| :--- | :--- | :--- |
| 原生状态告警 | `_sum/State` 或汇总状态运行事件；触发后再用 `getEdgeConfig` 与 `getEdgesChannelsValues` 下钻具体状态通道 | 已知且新鲜的正常值；区分布尔状态通道和汇总等级 |
| 离线告警 | 连接事件、启动对账、周期状态查询 | 有效上线观测 |
| 阈值告警 | 遥测值、单位、质量、持续窗口 | 达到恢复阈值且满足持续时间 |
| 数据质量告警 | 连接健康度、数据缺口、通道有效性 | 采集和数据质量恢复 |

离线告警不能只依赖一次 Webhook。OCMS 启动/恢复后按第 5.5 节重放运行事件，并拉取当前状态核对，避免快照与事件先后关系覆盖较新观测。按发生/观测时间恢复延迟计时；事件按 event_id 幂等消费，并处理同一连接代次的顺序。过时事件不能把新连接重新标记为离线。

活动告警按 (asset_id, rule_id, channel) 去重，同一指纹只允许一个活动周期；新的发生周期有独立 occurrence_id。规则处理需要持久化活动状态和防抖起点，重启后重新核对质量与信号，不能把不确定区间计为持续正常。

将两个维度分别保存：

- 信号状态：ACTIVE / RECOVERED / UNKNOWN。
- 处置状态：UNACKNOWLEDGED / ACKNOWLEDGED / IN_PROGRESS / CLOSED。

普通自动恢复告警可按规则在信号恢复后关闭；需人工确认的告警保留处置任务。工单关联使用关联表，支持一个工单处理多个告警。人工关闭必须记录依据；数据 UNKNOWN 时不能自动通过现场恢复验收。

### 7.3 工单与通知

工单基本状态为 OPEN → ASSIGNED → IN_PROGRESS → VERIFYING → CLOSED，另有取消和退回路径，流转校验角色与乐观锁版本。记录派单、接单、处理、附件、备件、根因和验收时间。

告警写入与通知待发送记录在 OCMS 同一事务中提交；通知独立重试，外部发送失败不回滚告警。MTTA、MTTR 的起止事件及暂停规则固定为指标定义，不能随页面临时计算口径。

### 7.4 电价和收益

后续阶段再上线收益计算。每个结果保存站点时区、电价版本、计量边界、来源区间、算法版本、数据完整性和重算版本。迟到数据触发可审计重算。

每日放电量/充电量可作为日能量比展示；SOC 跨日变化、辅助用电及计量位置会影响解释，不能未经边界校正直接称为完整充放电效率。收益计算需明确购售电、储能独立计量和基线成本，未通过口径验收的结果仅作为分析参考。

## 8. 工程模块与接口

### 8.1 模块组织

~~~text
ocms/
  platform-contracts/        公共标识、事件、版本与 DTO
  tenant-domain/             租户、资产、授权及凭据事务规则
  tenant-jdbc/               公共元数据库访问与迁移契约
  ocms-server/
    identity/                登录、会话、身份和服务凭据选择
    asset/                   资产管理入口与生效状态展示
    openems-client/          REST / WebSocket 适配
    timeseries/              Influx 查询、范围授权和口径转换
    monitoring/              实时缓存与门户推送
    alarm/                   规则、活动状态、去重与恢复
    workorder/               运维流程
    command/                 配置与控制跟踪
    notification/            持久消息与渠道适配
    settlement/              电价与分析，后续阶段
  ocms-web/                  Vue 门户

openems-adapters/
  metadata-tenant/           Metadata、身份适配、缓存和运行状态
  gateway-apply-adapter/     仅在目标网关缺少所需确认/撤销能力时开发
~~~

跨进程共享框架无关的协议、标识和权限映射；Spring 运行组件不直接装入 OSGi。公共元数据库迁移由一个版本化交付物负责，OCMS 与 Metadata 分别声明可兼容的 schema 版本区间。

### 8.2 OCMS 北向接口

以下为项目新增接口，不是 OpenEMS 原生 API：

| 资源 | 示例接口 | 关键返回 |
| :--- | :--- | :--- |
| 租户与成员 | /api/v1/tenants、/tenants/{id}/members | revision、权限范围 |
| 站点与设备 | /api/v1/sites、/edges | asset_id、cluster_id、remote_edge_id |
| 元数据变更 | /api/v1/edges/{id}/credentials/rotate | operation_id、PENDING_APPLY |
| 生效查询 | /api/v1/operations/{id} | 每个 Backend/网关的应用状态 |
| 历史与实时 | /api/v1/edges/{id}/history、门户 WebSocket | 数据、单位、时间和质量 |
| 配置与控制 | /api/v1/edges/{id}/commands | command_id、状态与证据 |
| 告警与工单 | /api/v1/alarms、/work-orders | 信号状态、处置状态与版本 |

写操作要求幂等键和预期版本；错误明确区分权限不足、版本冲突、暂不可用、设备离线、能力不支持及执行结果未知。分页、时间范围和订阅配额为接口的一部分。

## 9. 可用性、容量与运行观测

### 9.1 故障行为

| 故障 | 允许继续的能力 | 恢复动作 |
| :--- | :--- | :--- |
| OCMS 停机 | 已有 OpenEMS 接入、数据采集和边缘本地控制 | 重建订阅；状态、事件和任务对账 |
| 公共元数据库失联 | 已加载缓存范围内的既有运行；新握手受第 5.4 节期限约束 | 停止新增管理写入；恢复后先对账再放开新操作 |
| Backend 在数据库故障期间冷启动 | 不加载过期凭据恢复正常接入 | 明确不可用，等待数据库或受控灾备恢复 |
| OCMS 业务库不可用 | OpenEMS 数据采集继续；暂停需要持久审计的 OCMS 写操作和控制 | 数据库恢复后核对命令及告警 |
| InfluxDB 不可用 | 实时监控按实际连接状况继续，历史功能降级 | 核对采集侧补传能力和数据缺口 |
| 网关或 Backend 切换 | 根据实际拓扑重连；不承诺无中断 | 更新连接代次、元数据版本和订阅 |

公共库和业务库采用明确的备份恢复策略。恢复旧数据库备份后需特别核对密钥撤销、授权版本和消费结果，不能直接以旧水位宣布全量生效。

### 9.2 状态写入者与扩展

首期每集群一个活动 Backend。运行写入携带持久化 producer_epoch 和单调 sequence；更旧代次或序号的写入被拒绝。接入归属变化和旧进程失效由租约/部署管理明确隔离，不能只用 last_message 最大值解决所有状态冲突。

扩展到多个活动 Backend 前，必须实现设备归属、RPC 路由、写入者隔离、消费者广播和状态合并测试；不能仅增加实例数就宣称可水平扩展。跨区域部署另外评估共享数据库延迟和失联边界。

### 9.3 容量和监控指标

不预先承诺“万站”或“毫秒级端到端告警”。阶段 0 固定基准负载：设备数、每设备通道数、采样/上报频率、变化率、在线用户数、历史查询跨度和保留期。

至少测量：

- 元数据提交到 Backend / 全部目标网关生效的 p95、p99；
- 事件积压量、最老事件年龄、重试率和消费者水位；
- 遥测端到端延迟、STALE 资产数、订阅断线恢复时间；
- 告警检测、通知及确认延迟，区分防抖窗口与计算耗时；
- 历史查询延迟和扫描量、连接池等待、数据库锁等待；
- 命令 UNKNOWN 数量、执行核对时延、未经确认的撤销数量。

所有管理操作、变更事件和控制请求通过 request_id、operation_id 或 command_id 关联。日志不记录密码、完整密钥和认证令牌。

## 10. 存量迁移与回滚

### 10.1 迁移顺序

1. 盘点部署版本、活动 Metadata、数据库 schema、Edge ID 与 Influx 标签映射、用户权限和实际点位。
2. 建立公共元数据库 schema 和迁移工具，保留存量源；验证重复 ID、空字段、角色映射和凭据完整性。
3. 导入 Odoo 用户、设备、授权和配置。首次导入不修改现场 API Key，原标签保持可追溯。
4. OCMS 先只读接入，使用若干电站对照资产、实时、历史和权限。
5. 约定短暂管理写冻结窗口；完成增量导入、校验和可恢复备份。
6. 切换到 Metadata.Tenant 并验证 Backend / 网关初始化、凭据和设备连接，放开公共管理入口。
7. 分阶段开放告警、工单和控制功能；每阶段按验收结果发布。

已有密码哈希的兼容方式、登录会话失效策略和用户告知方式必须在迁移测试中固定。管理员角色不能按名称自动全部升级为平台管理员，须导出并复核映射清单。

### 10.2 回滚边界

- 放开新写入之前：可以恢复原 Metadata 配置和对应一致性快照。
- 放开新写入之后：旧库已经可能落后。回滚前冻结管理写，导出切换后的凭据、授权和资产变更，完成反向同步与核对，或选择修复前进。
- 撤销过的密钥不得因回滚重新启用；无法确认时，阻止新接入并执行受控凭据恢复流程。
- 告警和工单等 OCMS 独有数据保留在业务库，不以恢复旧 Metadata 为由删除。
- 回滚需定义负责人、触发条件、可接受数据差异和演练证据；不能描述成只改配置后重启。

## 11. 实施阶段与验收

工作量在接口核验、点表和人员投入明确后估算。以下按依赖和验收划分，不用未经验证的周数作为交付承诺。

| 阶段 | 交付内容 | 退出条件 |
| :--- | :--- | :--- |
| 0：契约与能力验证 | 锁定版本；API、数据库、网关确认、点表、时序口径和容量基线 | 一站真实/仿真链路可重复验证；差异记录及适配范围确定 |
| 1：公共底座与开站闭环 | 公共 schema、身份/资产模块、Metadata.Tenant、持久事件、应用状态 | OCMS 注册 → 写库 → 网关生效 → Edge 上线；撤销和恢复验证通过 |
| 2：监控与租户隔离 | 原生门户、实时、历史、资产映射、质量标记 | 两租户和两个同名远端 Edge 的隔离验证；直查/API 历史口径对照 |
| 3：告警工单闭环 | 告警恢复、运行事件重放、通知重试、确认与工单验收 | 故障发生到关闭完整闭环；已持久化运行事件可补偿、数据缺口可识别、通知消费幂等 |
| 4：配置、分析与调度扩展 | 命令跟踪、配置回滚、电价和收益、获准调度 | 未知执行结果可核对；计算口径与控制边界分别验收 |

阶段 2 的多集群身份测试可用两个测试集群，不代表首期生产需要多区域部署。告警规则可以在阶段 2 并行开发，但发布依赖可靠的数据质量与状态恢复。

### 必须覆盖的验收场景

1. OCMS 管理提交成功后进程退出：事件仍可投递，应用结果可查询。
2. Backend 应用后、确认前退出：重试幂等，不恢复旧版本。
3. 网关未应用新密钥：操作保持未完成，不能伪报成功。
4. 密钥撤销遇到断网和重启：旧密钥不因快照或回滚恢复有效。
5. OCMS 停机期间 Edge 离线：恢复后对账能产生正确离线状态和告警。
6. 遥测为 null、乱序、缺失或仅变化上报：不误判为零或自动恢复正常。
7. 两集群均有 edge0：资产、告警、工单、命令及历史时序互不串用；共用 bucket 时须证明数字标签不冲突。
8. 未授权租户通过列表、详情、导出、WebSocket 和数据库查询路径均不可访问目标资产。
9. 数据库连接池复用：前一事务租户上下文不影响下一事务。
10. 控制请求已执行但响应丢失：标记 UNKNOWN，核对后再处理，不盲目重复。
11. 历史累计量重置、跨日、夏令时和稀疏数据：结果符合明确口径并带质量标记。
12. 放开写入后的迁移回滚：新授权和撤销不会遗失，回滚证据完整。
13. OCMS 停机期间先离线再上线或原生故障发生后恢复：重放已持久化事件并补建历史周期，当前状态保持正确。
14. 运行事件来源中断或超过保留边界：缺口被识别和展示，不伪报历史完整或正常。
15. `B2b.Rest` 查询队列打满：OCMS 请求按超时失败并退避，不无限占用连接；恢复后可继续查询。

## 12. 实施前必须核实的外部条件

以下事项是实施阶段的验证任务，本文不把它们当作已经成立的能力：

- 目标 OpenEMS JAR/源码 commit、OSGi 接口签名、B2B 方法和认证方式。第 6.5 节只覆盖 commit `01083d6`。
- 网关缓存确认、连接撤销、多密钥过渡及过期缓存拒绝新握手的可实现性。
- 当前 Odoo/其他 Metadata 的实际 schema、数据量与迁移窗口。
- BMS/PCS/电表点位和可写通道，单站控制模式及现场保护边界。
- InfluxDB 的版本、查询语言、measurement、edge 数字标签分配和保留/补传配置。
- 数据库网络条件、备份恢复目标、接入数量与压力测试基线。

在这些条件核实前，本文件可用于模块划分和接口设计，不能作为上线验证已通过的证明。

## 13. 参考与版本使用规则

以下是核对设计的官方参考。实现必须记录实际使用的版本或源码 commit；latest/develop 链接不能代替部署版本锁定。

- [OpenEMS Metadata 职责](https://openems.github.io/openems.io/openems/latest/backend/metadata.html)
- [OpenEMS B2B 通信与订阅](https://openems.github.io/openems.io/openems/latest/backend/backend-to-backend.html)
- [历史查询请求解析](https://github.com/OpenEMS/openems/blob/develop/io.openems.common/src/io/openems/common/jsonrpc/request/QueryHistoricTimeseriesDataRequest.java)
- [Backend Edge RPC 路由](https://github.com/OpenEMS/openems/blob/develop/io.openems.backend.core/src/io/openems/backend/core/jsonrpcrequesthandler/EdgeRpcRequestHandler.java)
- [PostgreSQL 行级安全](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)
- [PostgreSQL LISTEN](https://www.postgresql.org/docs/18/sql-listen.html)
- [PostgreSQL NOTIFY](https://www.postgresql.org/docs/18/sql-notify.html)
