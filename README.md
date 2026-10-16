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
