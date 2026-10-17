# OpenEMS 本机部署与微电网控制系统

本项目包含针对本物理节点（`172.16.100.234`）部署的 **OpenEMS (Open Energy Management System)** 架构分析报告、云端多租户微服务规范、核心配置及扩展开发工程。

## 核心技术文档

- 📘 **[OpenEMS 边缘微内核与整站架构深度分析报告](OPENEMS_ARCHITECTURE_ANALYSIS.md)**：
  - 宏观三层体系（Edge 边缘内核、Backend 云端聚合、UI 呈现）
  - OSGi 微内核、Declarative Services 与 ConfigAdmin 热重载
  - 1000ms Cycle 周期性确定性控制循环与 Simplex 约束解算器
  - 本机实时服务端口矩阵（80, 8075, 8080, 8086, 502）
  - 现行仿真微电网闭环拓扑（防逆流平衡、光伏、储能与智能充电桩）
  - 本地离线增强补丁剖析（AppCenter 离线 Mock 与系统更新适配）
  - 时序数据双擎架构（RRD4J + InfluxDB v2）

- ☁️ **[OpenEMS 云端多租户微服务与虚拟电厂架构技术规范](OPENEMS_CLOUD_BACKEND_ARCHITECTURE.md)**：
  - 云端多租户五层全景架构（WebUI / B2B $\leftrightarrow$ Ingress $\leftrightarrow$ Core $\leftrightarrow$ Influx/DB $\leftrightarrow$ Edge）
  - RBAC 多租户权限隔离体系（Admin / Installer / Owner / Guest 四级模型）
  - 边缘反向加密隧道与 NAT/防火墙无缝穿透机制（8085 端口 WSS 隧道与双向保活）
  - 透明 JSON-RPC 路由代理机制（RPC Proxy Router 与活动句柄池）
  - InfluxDB v2 按 `edgeId` 物理标签分区与原始流/降采样双轨存储

- 🏢 **[OpenEMS 多租户与权限隔离架构全景深度分析](OPENEMS_MULTI_TENANCY_ARCHITECTURE.md)**：
  - 核心设计哲学：资产中心主义（Asset-Centric）、边缘优先与反向长连接隧道
  - 端到端五层分层解耦模型（呈现层、会话层、核心 RBAC、网关代理、数据沙箱）
  - 细粒度 RBAC 四级角色继承金字塔（Admin / Installer / Owner / Guest）与 `assertRoleIsAtLeast` 拦截
  - 动态信令代理与反向穿透时序（`EdgeRpcRequestHandler` 与 `AuthenticatedRpcRequest`）
  - InfluxDB v2 物理标签分区与 `FluxProxy.java` 查询语法树安全注入
  - 三种元数据驱动模式横向对比（`Metadata.Dummy` vs `Metadata.File` vs `Metadata.Odoo`）
  - 架构优势与企业级商业化演进路线（树状组织模型、物理硬隔离、组件级 ACL、租户流控）

- 🔌 **[OpenEMS 对外通信与 Odoo 通信接口](OPENEMS_EXTERNAL_AND_ODOO_INTERFACES.md)**：
  - 本机云端入口：UI `8081`、`Ui.Websocket` `8082`、Edge 上云 `8084` → `8085`
  - UI JSON-RPC：登录、设备目录、用户与安装协议，以及 `edgeRpc` 下的历史查询和 Edge 转发
  - `Metadata.Odoo` 双通道：Odoo HTTP JSON-RPC（`8069`）与 PostgreSQL 直连（设备、apikey、在线状态回写）

- 🔄 **[OpenEMS 与 Odoo ERP 企业级集成实战指南](OPENEMS_ODOO_INTEGRATION_GUIDE.md)**：
  - 双轨架构驱动机制：直接 PostgreSQL JDBC 读写轨 (HikariCP) + HTTP JSON-RPC 业务鉴权轨
  - 核心元数据模型与数据表映射（`openems.device`、`openems.device_user_role`、`res.users`）
  - 6 步端到端实操部署手册（Docker Compose 编排、插件激活、资产录入、Backend/Edge 联调、UI 验证）
  - 全生命周期时序交互图（电站反向 WSS 隧道握手、30 秒批量异步状态回写、UI 多租户鉴权隔离）
  - 生产运维避坑指南（全集群 UTC 时间对齐、控制面/数据面严格分流、高并发连接池调优）

- 🛠️ **[OpenEMS 与 Odoo ERP 本机原生（非 Docker）部署与全链路集成实战指南](OPENEMS_ODOO_NATIVE_HOST_INSTALLATION.md)**：
  - 本机非容器化原生架构：共享 PostgreSQL 18.6 + TimescaleDB 2.25.1 数据库实例
  - 运行时隔离：通过 `uv` 部署独立 Python 3.12 虚拟环境，解决 Linux 最新发行版依赖兼容难题
  - Odoo 18.0 核心与 OpenEMS 专属模块部署、Systemd 守护服务编排
  - Odoo 18.0 控制器原生会话与多场景租户查找适配（`_get_user_rec` 支持 Session ID、OAuth UID、Login、UID）
  - OpenEMS Backend 生产迁移（停用 `Metadata.Dummy`，激活 `Metadata.Odoo` 双轨引擎）
  - 物理边缘长连接上线、PostgreSQL 30秒聚合回写与 Web UI WebSocket 多租户全链路自动化验证

- 🏛️ **[OpenEMS 云端多租户模块原生设计方案（去 Odoo 化）](openems_multitenant_design.md)**：
  - 原生 OSGi `Metadata.Tenant` 替代 Odoo，实现 OpenEMS 核心契约解耦与低延迟直连
  - “热路径内嵌 (PostgreSQL + HikariCP) + 管理平面外置 (REST + Admin UI)”双轨微服务架构
  - 多级树状租户模型（Closure Table 闭包表）、租户配额约束与 RBAC 两级角色映射体系
  - PostgreSQL 18 行级安全隔离（RLS）与 `edge_status` 冷热数据读写分离存储
  - InfluxDB v2 双轨多租户隔离与 Grafana Organization 动态权限注入
  - 零停机平滑演进：从 Odoo 双轨过渡至原生多租户的 P0~P3 四阶段迁移方案

- 🌐 **[OCMS 与 OpenEMS 云端多租户协同设计（v2.1）](openems_cloud_management_design.md)**：
  - OCMS 独立部署，通过 OpenEMS API 和直接读写 OpenEMS 侧数据库双通道集成
  - 共用租户、资产和授权主数据；公共管理模块、`Metadata.Tenant` 与 OCMS 业务模块按领域划分写入权
  - PostgreSQL 持久变更事件、版本控制及 Backend/网关生效确认，覆盖密钥轮换、撤销和断线对账
  - 原生监控门户、历史查询口径、告警恢复与工单闭环，以及配置命令跟踪和后续收益分析
  - 对照源码 commit `01083d6` 核对的 B2B 行为：订阅参数与 2 秒全量快照、`persistencePriority` 对通道可用性的影响、Basic 认证与按 Edge 角色、`setGridConnSchedule` 的固定组件、`subscribeSystemLog` 经 B2B 不可用
  - 存量 Odoo 迁移、分阶段验收及回滚边界；明确待实现能力和部署版本核验项


- 📊 **[OpenEMS 与 Grafana 时序监控平台集成规范](OPENEMS_GRAFANA_INTEGRATION.md)**：
  - 服务入口矩阵（端口 `3000` 匿名免密直达、默认重定向至储能专业大屏）
  - 三位一体监控架构（OpenEMS Edge/Backend $\rightarrow$ InfluxDB v2 $\rightarrow$ Grafana）
  - 预置工商业储能与微电网专业看板（`${edge}` 动态切换、四象限物理平衡、电池 SOC、母线电压/电流、累计量测）
  - 声明式自动化装配规范（Datasource & Dashboards Provisioning、iframe 嵌入与参数调优）
  - Systemd 服务运维管理与健康检测 API

- 🚀 **[OpenEMS 新增电站监控与入网全流程操作指南 (Step-by-Step)](OPENEMS_ADD_STATION_STEP_BY_STEP.md)**：
  - 阶段一：边缘工控机驱动配置（Modbus TCP/RTU 桥接、关口电表、储能 PCS、光伏逆变器与防逆流控制回路）
  - 阶段二：安全加密反向长连接隧道与时序通道装配（`Controller.Api.Backend` 与 `Timedata.InfluxDB`）
  - 阶段三：云端元数据资产建档与多租户 RBAC 授权（Odoo ERP 设备开户与业主/安装商角色绑定）
  - 阶段四：全链路数据流验证与大屏联动（WSS 握手抓包、InfluxDB 标签落库、Web UI 车队概览与 Grafana 多站秒级切换）
  - 阶段五：现场运维与通信排错速查表（常见故障定位与解决对策）

- 🔑 **[OpenEMS API Key 与接入密钥安全管理规范](OPENEMS_API_KEY_MANAGEMENT.md)**：
  - 密钥分类与鉴权矩阵（边缘反向隧道密钥、InfluxDB v2 令牌、B2B VPP 调度凭证、本地 Basic Auth）
  - 边缘反向隧道接入密钥（Edge API Key）全生命周期管控（256-bit CSPRNG 生成、Odoo 档案、Linux 640 权限加固）
  - 传输通道强制启用 TLS 加密（WSS 防中间人嗅探与源码内核警告剖析）
  - 零停机平滑热轮换机制（Odoo 更新 $\rightarrow$ ConfigAdmin 热重载 $\rightarrow$ WSS 隧道无感恢复）
  - InfluxDB v2 时序令牌安全治理（最小权限 Scoped Token 与 Flux 标签注入隔离）
  - 自动化入侵检测与应急响应（Fail2ban 自动封禁非法探测与密钥泄露 5 步 SOP）

- 🔋 **[OpenEMS 储能电站完整演示数据集与仿真环境规范](OPENEMS_ESS_DEMO_DATASET.md)**：
  - 500kW / 1000kWh 工商业光储充微电网单线拓扑与关键参数
  - “两充两放”削峰填谷日调度策略与严格物理功率守恒闭环（残差绝对值为 0.0 W）
  - 30 天连续高分辨率 InfluxDB v2 时序历史数据集与单调递增电能量测
  - OpenEMS BackendEdgeApp 网关、EdgeManager 与 UI 实时双向隧道联调
  - 多电站车队（Fleet）多租户资产管理与 Python 自动化时序生成脚本

## 官方资源

- **OpenEMS 官方网站**: [https://openems.io](https://openems.io)
- **LF Energy 基金会项目主页**: [https://www.lfenergy.org/projects/openems/](https://www.lfenergy.org/projects/openems/)
- **社区交流论坛**: [https://community.openems.io](https://community.openems.io)
- **官方技术文档**: [https://openems.github.io/openems.io/openems/latest/index.html](https://openems.github.io/openems.io/openems/latest/index.html)
