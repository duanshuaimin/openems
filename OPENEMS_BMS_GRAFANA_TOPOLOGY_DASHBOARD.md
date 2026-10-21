# OpenEMS 储能柜五级物理拓扑与电芯数字孪生可视化架构与实现全景报告

> **目标版本**: OpenEMS 2026.x / Grafana v11.x / InfluxDB v2.7  
> **监控对象**: 工商业及电网级高压磷酸铁锂 (LiFePO4) 储能柜系统 (以 Pylontech Powercube M2 100kWh 512V 为物理蓝本)  
> **核心架构**: **储能柜 (Cabinet) $\rightarrow$ 电池阵列 (Array) $\rightarrow$ 电池簇 (Pack/Rack) $\rightarrow$ 电池模组 (Module) $\rightarrow$ 单体电芯 (Cell)**  
> **文档位置**: [OPENEMS_BMS_GRAFANA_TOPOLOGY_DASHBOARD.md](file:///home/user01/local/openems/OPENEMS_BMS_GRAFANA_TOPOLOGY_DASHBOARD.md)  
> **仪表盘文件**: [openems_bess_5tier_topology_dashboard.json](file:///home/user01/local/openems/scripts/openems_bess_5tier_topology_dashboard.json)  
> **仪表盘生成器**: [generate_bess_topology_dashboard.py](file:///home/user01/local/openems/scripts/generate_bess_topology_dashboard.py)  

---

## 1. 架构总览与五级拓扑设计理念

在现代化大型工商业储能与电网侧储能电站中，电池系统的管理复杂度呈现多层级、高耦合、高并发的物理特性。为了实现储能电站的精细化健康管理、热失控早期预警与毫秒级保护控制，传统的“单体或簇级扁平监控”已无法满足工程需求。

本项目在 OpenEMS 边缘与云端协同体系中，构建了严格遵循物理电气与机械装配关系的**五级递进式数字孪生拓扑模型**：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Tier 1: 储能柜 (Cabinet / BESS)                       │
│      100kW/100kWh 户外一体柜 / 集装箱, PCS 耦合, 液冷空调, 气溶胶消防安全联锁     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Tier 2: 电池阵列 (Array / DC Cluster)                     │
│           直流母线汇流 (512V~750V), 1~N 簇并联管理, DC 主断路器/主正负接触器          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                  Tier 3: 电池簇 / Pack (Battery Pack / Rack)                 │
│         160S1P 512.0V 标称, BMU 主控, SOC/SOH 库仑积分, 动态充放电包络安全曲线        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Tier 4: 电池模组 (Module 01 ~ Module 10)                  │
│       10 个高压串联模组 (每个 16S 51.2V 标称), CSC 从控采集, 10 点测温与压差定位      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Tier 5: 单体电芯 (Cell 001 ~ Cell 160)                    │
│     160 颗串联 LiFePO4 3.2V 电芯全景矩阵, 极值单体定位 (#14 Max / #3 Min), 主动均衡  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 五级物理拓扑逐级技术规格与看板面板设计

Grafana 看板通过 6 个主题行 (Rows) 和 33 个专业可视化面板 (Visual Panels) 实现对储能柜全生命周期的全景透视：

### 2.1 拓扑引导层 (Section 0: Topology Navigation)
- **面板形态**: 富文本 HTML/CSS 交互式拓扑架构图。
- **展示内容**:
  - 五级物理层级卡片：储能柜 (Cabinet)、电池阵列 (Array)、电池簇 (Pack)、电池模组 (Module)、单体电芯 (Cell)。
  - 核心电气参数：100kWh 容量、512V 直流母线、160S1P 拓扑、10 模组配置、160 单体矩阵。
  - 数字孪生状态指示器：动态流动指示与就绪状态。

---

### 2.2 第一级：储能柜系统级总览 (Tier 1: Cabinet Overview & Thermal / Safety)
从电站运营调度与机柜全局安全视角，监控储能柜的电能质量、热工管理与消防联锁：

| 监控面板 | 指标通道 (Flux Target) | 单位 | 阈值规则与视觉语义 |
| :--- | :--- | :--- | :--- |
| **储能柜系统运行工况** | `cabinet0/State` | 状态机枚举 | 0: 停机休眠 (灰), 1: 填谷充电 (#FF9900), 2: 削峰放电 (#5794F2), 3: 浮充待机 (绿), 4: 告警 (黄), 5: 故障 (红) |
| **储能柜交流有功功率** | `cabinet0/ActivePower` | W / kW | 正值表示放电上网，负值表示充电吸纳，平滑渐变面积图 |
| **系统充放电能效 RTE** | `cabinet0/RteEfficiency` (÷10) | % | 70%~100% 仪表盘；<88% 红色，88~90% 黄色，≥90% 绿色 |
| **今日累计充放电量** | `DailyChargeEnergy` / `DailyDischargeEnergy` | Wh / kWh | 双值对比 Stat，直观掌握日充放电循环通量 |
| **柜内热工与温控环境** | `AmbientTemp`, `HvacStatus`, `Humidity` | °C / 枚举 / % | 柜内温湿度状态与精密空调压缩机制冷/待机工况联锁 |
| **消防安全与电气联锁** | `FireSystemStatus`, `DoorLimitStatus`, `EmergencyStopStatus`, `InsulationResistance` | 状态机 / kΩ | 气溶胶灭火装置正常防备、柜门行程开关、急停按钮常闭及整柜绝缘阻抗 |
| **交/直流功率连续流** | `ActivePower` (AC) vs `DcPower` (DC) | W / kW | 双曲线重叠时序图，直观展现 PCS 逆变转换损耗与动态响应 |

---

### 2.3 第二级：电池阵列与多簇汇流管理 (Tier 2: Array & DC Cluster Management)
管理储能柜内部高压直流母线 (DC Busbar) 与并联电池簇群的电气汇流：

| 监控面板 | 指标通道 (Flux Target) | 单位 | 核心作用与工程意义 |
| :--- | :--- | :--- | :--- |
| **阵列直流母线电压** | `array0/DcVoltage` | V | 直流母线电压全景 (512V~750V)，过压/欠压阈值告警 |
| **阵列总直流电流** | `array0/DcCurrent` | A | 汇流总电流，充电为负、放电为正 |
| **并联簇数与簇间均衡** | `ParallelPiles`, `SocBalanceVariance`, `CirculatingCurrent` | 簇 / % / A | 监测并联簇数量、多簇间 SOC 方差一致性、防止簇间环流造成热失控 |
| **高压断路器与接触器** | `DcBreakerStatus`, `MainContactorPos`, `MainContactorNeg`, `PrechargeContactor` | 状态布尔值 | 高压盒 (High Voltage Box) 内主断路器、KM+、KM- 及预充接触器状态 |
| **母线电压与电流趋势** | `DcVoltage` (左轴) + `DcCurrent` (右轴) | V / A | 双 Y 轴时序曲线，分析充放电切换瞬态冲击与母线电压下垂响应 |

---

### 2.4 第三级：电池簇 / Pack 运行工况与保护包络 (Tier 3: Pack Electrical & Dynamic Envelope)
单簇电池柜的核心电气与动态保护边界 (Dynamic BMS Protection Envelope)：

| 监控面板 | 指标通道 (Flux Target) | 单位 | 视觉与告警逻辑 |
| :--- | :--- | :--- | :--- |
| **电池簇 SOC 荷电状态** | `battery0/Soc` | % | 0~100% 渐变色仪表盘，<15% 红色 (深放保护)，15~25% 黄色，25~85% 绿色，>85% 浅蓝 |
| **电池簇 SOH 与循环次数**| `battery0/Soh`, `battery0/CycleCount` | % / 次 | 电池健康衰减模型与累计等效满充满放循环次数监测 |
| **电池簇剩余可用电量** | `battery0/RemainingCapacity` | Wh / kWh | 基于实时 SOC 与 SOH 动态换算的剩余可调度能量 (kWh) |
| **极对地绝缘电阻** | `battery0/InsulationResistance` | kΩ | 正负母线对机箱外壳的电气绝缘，<1000kΩ 红色一级告警 |
| **BMS 动态安全包络线** | `ChargeMaxCurrent`, `DischargeMaxCurrent`, `Current` | A | **工业级亮点**: 展示 BMS 随 SOC 和温度动态下调的充放电降额包络，并叠加实际电流曲线验证不超限 |
| **端电压与 SOC 演变曲线** | `Voltage` (左轴) vs `Soc` (右轴) | V / % | 揭示 LiFePO4 平台特性与 OCV 开路电压非线性变化趋势 |

---

### 2.5 第四级：模组级均衡与温场分布 (Tier 4: 10-Module Voltage & Temperature Distribution)
高压电池簇由 10 个独立电池模组 (Module 01 ~ Module 10) 串联构成 (每个模组 16S 51.2V)：

| 监控面板 | 指标通道 (Flux Target) | 类型 | 核心作用 |
| :--- | :--- | :--- | :--- |
| **10个模组实时电压分布** | `Module_01_Voltage` ~ `Module_10_Voltage` | 水平 Bar Gauge | 10 根横向柱状图 (51.2V 标称)，直观对比各模组一致性与异常模组偏移 |
| **10个模组实时温度分布** | `Module_01_Temp` ~ `Module_10_Temp` | 水平 Bar Gauge | 10 点模组温场热分布，精确展示中间模组受热蓄积效应 |
| **模组电压极值与定位** | `MaxModuleVoltage`, `MaxVoltageModuleNumber`, `MinModuleVoltage`, `MinVoltageModuleNumber` | Stat | 瞬时抓取最高模组电压及模组编号 (例如 Mod #02: 52.8V)、最低模组及编号 (Mod #01: 51.6V) |
| **模组温度极值与定位** | `MaxModuleTemperature`, `MaxTemperatureModuleNumber`, `MinModuleTemperature`, `MinTemperatureModuleNumber` | Stat | 瞬时抓取最高模组温度 (Mod #04: 25.8°C) 与最低模组温度 (Mod #08: 23.9°C) |
| **模组级压差与温差趋势** | `ModuleVoltageDelta` (左轴) + `ModuleTemperatureSpread` (右轴) | Timeseries | 追踪模组级最大电压差 (ΔV) 与最大温度梯度 (ΔT) 的长期老化发散情况 |

---

### 2.6 第五级：电芯级单体极值与压差全景 (Tier 5: 160-Cell Matrix, Delta-V & Delta-T)
深入储能系统最小可更换物理单元 (Cell Level)，覆盖 160 颗串联 LiFePO4 电芯：

| 监控面板 | 指标通道 (Flux Target) | 规格与特性 |
| :--- | :--- | :--- |
| **最高单体电压与电芯号** | `MaxCellVoltage` (mV) + `MaxVoltageCellNumber` (#) | 精确锁定高电压单体位置 (例如 Cell #14: 3312 mV) |
| **最低单体电压与电芯号** | `MinCellVoltage` (mV) + `MinVoltageCellNumber` (#) | 精确锁定低电压单体位置 (例如 Cell #03: 3282 mV) |
| **电芯单体最大压差 (ΔV)** | `battery0/CellVoltageDelta` | 仪表盘；0~25mV 绿色 (优良)，25~40mV 黄色 (轻微发散)，>40mV 红色 (触发告警/均衡) |
| **最高单体温度与电芯号** | `MaxCellTemperature` (°C) + `MaxTemperatureCellNumber` (#) | 精确锁定热点单体位置 (例如 Cell #08: 26.4°C) |
| **最低单体温度与电芯号** | `MinCellTemperature` (°C) + `MinTemperatureCellNumber` (#) | 精确锁定冷点单体位置 (例如 Cell #01: 24.1°C) |
| **电芯单体最大温差 (ΔT)** | `battery0/CellTemperatureSpread` | 仪表盘；0~2.5°C 绿色，2.5~4.0°C 黄色，>4.0°C 红色 |
| **压差 ΔV 与温差 ΔT 演变** | `CellVoltageDelta` (mV) + `CellTemperatureSpread` (°C) | 双轴动态曲线，评估电芯一致性劣化速率与主动均衡电路工作效果 |
| **160颗电芯电压全景矩阵** | `battery0/Cell_001_V` ~ `battery0/Cell_160_V` (mV) | **LCD 风格 160 电芯全景 Bar Gauge**，以 160 个微单元连续排列展现 10 个模组的电芯体检分布 |
| **主动均衡与异常单体体检** | `BalancingState`, `BalancingActiveCells`, `MaxVoltageCellNumber`, `MinVoltageCellNumber`, `MaxTemperatureCellNumber`, `MinTemperatureCellNumber` | 全局单体健康档案，直观反映当前主动均衡电路是否介入放电/电荷转移 |

---

## 3. BMS 仿真设备数据面与 InfluxDB 实时管道

### 3.1 仿真物理设备参数 (Pylontech Powercube M2)
- **服务状态**: `openems-bms-mock.service` (Active, PID: 173351)
- **Modbus TCP 端口**: `0.0.0.0:8503` (Unit ID: 1)
- **电化学模型**:
  - 160 串 LiFePO4 电芯 (3.2V 标称，2.80V~3.45V 工作区间)。
  - 内阻模型：80 mΩ 机架总内阻，单体微内阻扰动 $\pm 5\,\text{m}\Omega$。
  - 库仑积分实时 SOC 计算与动态降额包络（高 SOC >90% 降额充电，低 SOC <15% 降额放电）。
  - 电热耦合模型：焦耳热散发系数 + 柜内环境温控散热微分方程。
  - 模组结构：第 4~7 模组处于机架中部，设置微热蓄积效应 (+0.9°C)；第 1、10 模组位于冷风入口/顶部排风口。

### 3.2 InfluxDB v2 数据管道与多站支持
- **数据库地址**: `http://127.0.0.1:8086`, Bucket: `openems`, Org: `openems`
- **数据推送周期**:
  - `openems-bms-mock.service`: 每 2 秒推送高频 `edge=bms` 与 `edge=0` 数据点。
  - `openems-demo-feeder.service`: 每 5 秒推送 `edge=0` 至 `edge=4` 五大微网/储能电站全量五级拓扑遥测数据。
- **Grafana 设备选择器变量**:
  - 通过 `schema.tagValues(bucket: "openems", tag: "edge")` 动态列出所有设备：
    * `bms`: ⚡ BMS 虚拟设备 (Pylontech Powercube M2 100kWh)
    * `0`: 🏭 园区光储充微电网储能柜 (500kW/1000kWh)
    * `1`: 🏗️ 重工业削峰填谷储能系统 (1000kW/2000kWh)
    * `2`: ⚡ 电网侧独立调频储能电站 (2000kW/4000kWh)
    * `3`: 🏬 商业综合体分布式储能柜 (200kW/400kWh)
    * `4`: 🏝️ 海岛多能互补离网储能系统 (100kW/250kWh)

---

## 4. 验证与测试记录

### 4.1 Modbus TCP 与 OpenEMS Edge 通信验证
```bash
$ curl -s -u admin:admin "http://127.0.0.1:8095/rest/channel/battery0/MaxVoltageCellNumber"
{"address":"battery0/MaxVoltageCellNumber","type":"INTEGER","accessMode":"RO","value":14}

$ curl -s -u admin:admin "http://127.0.0.1:8095/rest/channel/battery0/MaxCellVoltage"
{"address":"battery0/MaxCellVoltage","type":"INTEGER","accessMode":"RO","unit":"mV","value":3312}

$ curl -s -u admin:admin "http://127.0.0.1:8095/rest/channel/battery0/MinCellVoltage"
{"address":"battery0/MinCellVoltage","type":"INTEGER","accessMode":"RO","unit":"mV","value":3282}

$ curl -s -u admin:admin "http://127.0.0.1:8095/rest/channel/battery0/Voltage"
{"address":"battery0/Voltage","type":"INTEGER","accessMode":"RO","unit":"V","value":527}
```

### 4.2 Grafana 数据源查询 API 验证
```bash
# 验证 160 颗电芯单体矩阵查询
$ curl -s -u admin:admin -X POST http://127.0.0.1:3000/api/ds/query \
  -H "Content-Type: application/json" \
  -d '{"queries":[{"datasource":{"uid":"P0DBC1A8D6496B50C"},"query":"from(bucket: \"openems\") |> range(start: -15m) |> filter(fn: (r) => r.edge == \"bms\") |> filter(fn: (r) => r._measurement == \"data\" and r._field =~ /^battery0\\/Cell_[0-9]{3}_V$/) |> last()","refId":"A"}]}' | jq '.results.A.frames | length'
160

# 验证 10 个模组电压查询
$ curl -s -u admin:admin -X POST http://127.0.0.1:3000/api/ds/query \
  -H "Content-Type: application/json" \
  -d '{"queries":[{"datasource":{"uid":"P0DBC1A8D6496B50C"},"query":"from(bucket: \"openems\") |> range(start: -15m) |> filter(fn: (r) => r.edge == \"bms\") |> filter(fn: (r) => r._measurement == \"data\" and r._field =~ /^battery0\\/Module_[0-9]{2}_Voltage$/) |> last()","refId":"A"}]}' | jq '.results.A.frames | length'
10
```

### 4.3 Grafana 双向导航验证
- 从指挥中心看板 ([/d/openems-ess-analytics](http://127.0.0.1:3000/d/openems-ess-analytics)) 顶部可直接点击 `🔋 进入储能柜五级物理拓扑与电芯数字孪生看板`。
- 从拓扑看板 ([/d/openems-bess-topology](http://127.0.0.1:3000/d/openems-bess-topology)) 顶部可直接点击 `⚡ 返回智慧微电网与储能调度中心`。

---

## 5. 运维管理与快捷链接

| 服务/平台 | 访问端点 / 协议 | 鉴权 / 凭据 | 运行状态 |
| :--- | :--- | :--- | :--- |
| **Grafana 拓扑看板** | [http://127.0.0.1:3000/d/openems-bess-topology](http://127.0.0.1:3000/d/openems-bess-topology) | `admin / admin` | 运行中 (UID: `openems-bess-topology`) |
| **Grafana 调度中心** | [http://127.0.0.1:3000/d/openems-ess-analytics](http://127.0.0.1:3000/d/openems-ess-analytics) | `admin / admin` | 运行中 (UID: `openems-ess-analytics`) |
| **BMS 虚拟设备** | `0.0.0.0:8503` (Modbus TCP) | Unit-ID: 1 | `openems-bms-mock.service` (Active) |
| **OpenEMS Edge REST** | `http://127.0.0.1:8095/rest/channel/battery0` | `guest / guest` (只读) | `openems-edge.service` (Active) |
| **InfluxDB 时序库** | `http://127.0.0.1:8086` | Token: `<SCOPED_READONLY_TOKEN>` | Active (Bucket: `openems`) |
| **多站网关 Feeder** | 内部守护进程 | Tag: `0`, `1`, `2`, `3`, `4`, `bms` | `openems-demo-feeder.service` (Active) |

---
*报告生成于 2026-10-21，已同步纳入 OpenEMS Git 版本库与生产部署体系。*
