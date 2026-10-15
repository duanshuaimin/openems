# OpenEMS 本机部署与微电网控制系统

本项目包含针对本物理节点（`172.16.100.234`）部署的 **OpenEMS (Open Energy Management System)** 架构分析报告、核心配置及扩展开发工程。

## 核心文档

- 📘 **[OpenEMS 架构与功能深度分析报告](OPENEMS_ARCHITECTURE_ANALYSIS.md)**：
  - 宏观三层体系（Edge 边缘内核、Backend 云端聚合、UI 呈现）
  - OSGi 微内核、Declarative Services 与 ConfigAdmin 热重载
  - 1000ms Cycle 周期性确定性控制循环与 Simplex 约束解算器
  - 本机实时服务端口矩阵（80, 8075, 8080, 8086, 502）
  - 现行仿真微电网闭环拓扑（防逆流平衡、光伏、储能与智能充电桩）
  - 本地离线增强补丁剖析（AppCenter 离线 Mock 与系统更新适配）
  - 时序数据双擎架构（RRD4J + InfluxDB v2）

## 官方资源

- **OpenEMS 官方网站**: [https://openems.io](https://openems.io)
- **LF Energy 基金会项目主页**: [https://www.lfenergy.org/projects/openems/](https://www.lfenergy.org/projects/openems/)
- **社区交流论坛**: [https://community.openems.io](https://community.openems.io)
- **官方技术文档**: [https://openems.github.io/openems.io/openems/latest/index.html](https://openems.github.io/openems.io/openems/latest/index.html)
