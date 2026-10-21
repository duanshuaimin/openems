# OpenEMS 仿 Dynatrace Smartscape 储能全景立体拓扑可视化系统架构与实现报告

> **目标版本**: OpenEMS 2026.x / Grafana v11.x / Nginx 1.28.x / InfluxDB v2.7  
> **核心参考标杆**: **Dynatrace Smartscape** 全栈纵横立体交互式拓扑架构  
> **监控对象**: 工商业及电网级光储充一体化微电网与高压磷酸铁锂 (LiFePO4) 储能系统  
> **独立拓扑应用**: [http://127.0.0.1/smartscape/](http://127.0.0.1/smartscape/) ｜ 外部直达：[http://172.16.100.234/smartscape/](http://172.16.100.234/smartscape/)  
> **Grafana 看板入口**: [http://127.0.0.1:3000/d/openems-smartscape-topology](http://127.0.0.1:3000/d/openems-smartscape-topology) (UID: `openems-smartscape-topology`)  
> **文档位置**: [OPENEMS_DYNATRACE_SMARTSCAPE_TOPOLOGY.md](file:///home/user01/local/openems/OPENEMS_DYNATRACE_SMARTSCAPE_TOPOLOGY.md)  
> **源码目录**: [smartscape/](file:///home/user01/local/openems/smartscape/)  

---

## 1. 为什么需要 Smartscape 风格的立体全栈拓扑？

在以 OpenEMS 为核心的新型电力系统与微电网中，系统复杂度具有极高的**信息物理融合（Cyber-Physical Convergence）**特征：
- 向上延伸至**云端商业调度与虚拟电厂（VPP）**、分时现货交易、需量削峰策略；
- 向中贯穿**边缘微内核软 PLC 确定性周期控制（1000ms Core Cycle）**、反向长连接加密隧道、时序时钟对齐；
- 向下扎根至**交流并网关口、PCS 双向变流器、储能高压柜、直流母线、高压电池簇（Rack 160S1P）**；
- 纵深微观直至 **10 个串联电池模组（Module 16S 51.2V）与 160 颗串联 LiFePO4 电芯单体（Cell 3.2V 280Ah）**。

传统平面拓扑往往将“通信网络”、“能量流向”与“物理机械装配”混杂在单张图纸中，或割裂为孤立报表，导致运维人员**无法在一张图上跨越软件应用与微观电芯的完整因果链（Causal Lineage Chain）**。

借鉴 APM 行业标杆 **Dynatrace Smartscape** 的拓扑设计哲学，本项目构建了兼具“纵向跨层切片（Vertical Tiers）”与“横向关联漫游（Horizontal Dependencies）”的工业级数字孪生全景拓扑系统。

---

## 2. OpenEMS Smartscape 六级纵向体系架构设计

系统严格按照微电网与储能物理拓扑，将全站划分为 **6 大纵向波段（Tiers）**，总计纳入 **185+ 个实时实体节点** 与 **260+ 条依赖边**：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 Tier 6: Applications & Business Dispatch (应用调度层)        │
│       VPP 虚拟电厂多能互补 ｜ 削峰填谷策略 ｜ 有序充电协同 ｜ 防逆流自发自用 ｜ 现货日前套利      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ 业务决策与控制设定点下发
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 Tier 5: Control Plane & Edge Engine (控制中枢与平台层)       │
│      OpenEMS Edge 软PLC ｜ OpenEMS Backend 路由网关 ｜ InfluxDB v2 ｜ Odoo ERP ｜ MPC 预测  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ 确定性周期扫描 (1000ms) ｜ Modbus/WSS 通信
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                Tier 4: Systems & Cabinets (机柜系统与并网变流层)              │
│       100kW/100kWh 储能一体柜 ｜ PCS 双向变流器 ｜ 10kV关口电表 ｜ 120kW光伏逆变器 ｜ 工业负荷  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ 高压直流母线 (512V~750V) ｜ 物理容纳
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│               Tier 3: DC Arrays & Battery Racks (直流阵列与电池簇层)         │
│          直流母线汇流 ｜ 高压电池簇 (Rack 160S1P) ｜ BMU 主控制器 ｜ 高压继电器与断路器盒       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ 高压铜排串联连接 ｜ CSC 从控采样
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Tier 2: Battery Modules (电池模组层)                     │
│         10 个高压串联电池模组 (Module 01 ~ Module 10, 每个 16S 51.2V 标称), 10 点温场分布   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ 电化学单体串联 ｜ 毫秒级电压温度采集
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Tier 1: Battery Cells (单体电芯层)                      │
│      160 颗串联 LiFePO4 3.2V 电芯全景矩阵 (#14 Max / #3 Min) ｜ 主动能量转移均衡总线   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Dynatrace 标志性交互体验与核心特性

### 3.1 左侧 Smartscape 垂直导轨 (Vertical Rail)
- 仿 Dynatrace 经典的左侧竖立式层级选择器，标配 6 个层级按钮：
  - `🌐 APPLICATIONS [5]`
  - `⚙️ CONTROL PLANE [5]`
  - `🏢 SYSTEMS & CABINETS [6]`
  - `⚡ DC ARRAYS & RACKS [4]`
  - `🧱 BATTERY MODULES [10]`
  - `🔬 BATTERY CELLS [160]`
- **交互效果**：点击任意层级导轨按钮，画布自动平滑平移并聚焦该层级，高亮其上下游纵向关联，淡化无关节点。

### 3.2 四种多模态拓扑视角 (Multimodal View Modes)
顶部导航栏提供一键视角切换，满足不同运维角色与业务场景需求：

1. **🔀 全景分层拓扑 (Full Smartscape)**：
   - 完整展示 6 级纵向波段，同时渲染跨层物理包含、控制信令和能量流动关系。
2. **⚡ 能流脉冲拓扑 (Power Flow Topology)**：
   - 聚焦微电网交直流主回路（光伏逆变器 $\rightarrow$ PCS 双向变流器 $\rightarrow$ 储能电池簇 $\rightarrow$ 车间负荷/电网并网点）。
   - **动态粒子流光**：连线上沿电流方向流动着发光能量微粒，流速与功率（kW）严格成正比；充电时呈现琥珀黄色（Sinking），放电时呈现科技天蓝色（Sourcing）。
3. **📡 软PLC与数采通信网 (Control & Communication Network)**：
   - 突出边缘侧与云端通信链路：Modbus TCP (`8503` / `502`)、WebSocket 反向加密隧道 (`8084`)、RESTful API (`8095`)、PostgreSQL HikariCP 连接池 (`5432`)，展示信令交互与心跳。
4. **🔋 储能五级数字孪生 (BESS Physical Digital Twin)**：
   - 纵深聚焦储能机柜内部结构（储能柜 $\rightarrow$ 直流母线 $\rightarrow$ 电池簇 $\rightarrow$ 10 模组 $\rightarrow$ 160 电芯）。
   - 160 颗电芯按照 10 个模组（每个模组 4×4 矩阵）整齐排列，以渐变色温展现单体电压与温度场梯度。

### 3.3 实体全景探针抽屉 (Right-Hand Inspector Drawer)
点击拓扑图中的任意节点（如点击 `模组 #02`、`电芯 #14`、`PCS 变流器` 或 `OpenEMS Edge`），右侧平滑滑出深度体检抽屉：
- **实体元数据卡片**：显示节点层级徽章、物理组件规格、唯一硬件 ID、运行状态（🟢 正常 / 🟡 预警 / 🔴 故障）。
- **实时运行遥测指标 (Real-Time KPIs)**：动态卡片网格，展示该实体的实时电压、电流、功率、SOC、SOH、温差、绝缘阻抗等。
- **30秒滚动时序走势 (Sparkline Canvas)**：通过独立 Canvas 在抽屉内以 60FPS 实时绘制该节点最近 30 秒的物理测量走势线。
- **上下游全栈依赖树 (Dependency Lineage)**：
  - **⬆️ 上游供给与控制依赖 (Inbound)**：例如清晰标注该模组来自哪个电池簇、由哪个 CSC 从控采集、受哪个 BMU 监控。
  - **⬇️ 下游受控与下级拓扑 (Outbound)**：例如展开该模组包含哪些单体电芯（Cell 017 ~ Cell 032）。
- **控制与联动动作按钮**：提供一键打开 Grafana 深度看板、一键探查 OpenEMS Edge REST 原始通道等快捷诊断操作。

### 3.4 悬停血缘高亮 (Lineage Hover Effect)
当鼠标悬停在任何节点上时，整个拓扑图自动进入“血缘探查模式”：
- 自动计算并点亮该节点的所有**上游祖先节点（Ancestors）**与**下游子孙节点（Descendants）**；
- 关联边缘连线加粗并散发霓虹光晕；
- 其余非关联节点自动降级为半透明灰色，极大消除视觉干扰。

---

## 4. 多级逐层下钻 (Hierarchical Drill-Down) 与自底向上聚合上卷 (Bottom-Up Roll-Up) 引擎

针对储能系统中高达数百个传感器节点的“信息过载”痛点，Smartscape 拓扑系统引入了完整的**六级粒度下钻（Drill-Down）与自底向上数学聚合上卷（Roll-Up）引擎**。运维人员既可以在宏观层面一眼掌握集团多站与整柜健康度，又能一键逐层下钻直至单颗电芯内部的电化学等效电路。

### 4.1 六级拓扑粒度深度模型 (`L0` ~ `L5`)

| 粒度层级 | 模式名称 | 拓扑视图展开/折叠行为 | 典型应用场景 |
| :--- | :--- | :--- | :--- |
| **`L0: 集团车队上卷`**<br>*(Fleet Roll-Up)* | 集团多站级聚合 | 将全站所有机柜、电池簇、10 模组、160 电芯全部向上卷曲（Roll-Up）至 **6 个场站宏节点**（`station-bms`, `station-edge0`..`edge4`） | 集团 VPP 虚拟电厂调度中心、多场站容量与告警态势总览 |
| **`L1: 储能柜系统上卷`**<br>*(Cabinet Roll-Up)* | 机柜与并网系统级 | 展开应用调度层、软 PLC 控制面与储能柜系统层；将直流阵列、高压电池簇、10 模组、160 电芯上卷至 **`sys-cabinet` (100kW/100kWh 储能一体柜)** | 场站值班长监控并网点功率、PCS 变流器与整柜综合健康度 |
| **`L2: 高压电池簇上卷`**<br>*(Rack Roll-Up)* | 直流阵列与电池簇级 | 从储能柜下钻展开直流母线 (`arr-dcbus`)、高压箱 (`arr-hvbox`)、BMU 主控 (`arr-bmu`) 与高压电池簇；将 10 模组与 160 电芯上卷至 **`arr-rack` (Rack 160S1P)** | 电气工程师排查直流母线绝缘、高压继电器与整簇充放电包络 |
| **`L3: 10模组聚合 (默认)`**<br>*(Module Roll-Up)* | 模组级聚合 + **按需局部下钻** | 展开 10 个串联电池模组 (`mod-01` ~ `mod-10`)，每个模组默认上卷其内部 16 颗电芯并绘制 **16 段式微缩健康光谱条 (Mini Health Bar)**；**支持双击任意单个模组独立展开/收起其下属 16 颗电芯** | 日常最常用的黄金平衡视图：既看清 10 模组串联结构，又能针对异常模组（如 `Mod #01`）局部下钻 |
| **`L4: 160电芯全展开`**<br>*(Full 160-Cell Unroll)* | 单体电芯全景矩阵 | 同时展开全部 10 个模组，完整呈现 **160 颗 LiFePO4 单体电芯**（10×16 矩阵）及主动均衡总线 | 电芯级深度均衡诊断、全簇电压/温度梯度分布普查 |
| **`L5: 电芯微观 RC 电路`**<br>*(Cell Micro-Twin)* | 电芯内部二阶 RC 等效电路 | 双击任意单颗电芯（如最高压电芯 `#014`），画布切换至**电芯内部二阶 Thevenin RC 等效电路微观数字孪生视图** (`OCV` 理想电压源、欧姆内阻 $R_0$、电化学极化 $R_1 \parallel C_1$、浓差极化 $R_2 \parallel C_2$、主动均衡 MOSFET 与 NTC 热模型) | 电池算法工程师分析极化内阻、压降构成与主动均衡电流路径 |

### 4.2 自底向上数学聚合上卷算子 (Bottom-Up Roll-Up Mathematical Operators)

每当底层节点向上卷曲（Roll-Up）至父容器时，引擎并非简单隐藏子节点，而是以 1.5 秒周期实时执行**五类自底向上数学聚合计算**，并将聚合结果渲染在父节点的**上卷胶囊徽章（Roll-Up Pill）**、**悬停提示框**与**右侧探针抽屉的数学上卷面板**中：

```
160 颗单体电芯 (Cells: 3.2V)
   │  ∑V = Σ Cell_V (16S)  |  μV = AVG(Cell_V)  |  ΔV = Max - Min  |  Status = MAX_SEVERITY
   ▼
10 个串联模组 (Modules: 51.2V)
   │  ∑V = Σ Mod_V (10S)   |  μV = AVG(Mod_V)   |  MAX=#14, MIN=#03 |  Status = MAX_SEVERITY
   ▼
高压电池簇 (Battery Rack: 512V 160S1P)
   │  P_dc = ∑V × I_rack   |  η_sys = 96.4%     |  HVAC & Insulation Roll-Up
   ▼
100kW/100kWh 储能一体柜 (BESS Cabinet)
   │  ∑P_fleet = Σ P_site  |  ∑E_fleet = 800kWh |  Multi-Site Health Roll-Up
   ▼
集团多站虚拟电厂集群 (Fleet VPP Level 0)
```

1. **`∑ SUM`（串联电压/容量/功率累加算子）**：
   - 模组级：$V_{\text{mod},k} = \sum_{i=1}^{16} V_{\text{cell},(k-1)\times 16 + i}$
   - 电池簇级：$V_{\text{rack}} = \sum_{k=1}^{10} V_{\text{mod},k} = \sum_{j=1}^{160} V_{\text{cell},j}$
   - 场站车队级：$P_{\text{fleet}} = \sum_{s=0}^{5} P_{\text{station},s}$
2. **`μ AVG`（子级算术均值算子）**：
   - 实时计算容器内所有子电芯/子模组的算术平均电压 $\mu_V$ 与平均温度 $\mu_T$。
3. **`MAX / MIN`（跨层穿透极值定位算子）**：
   - 即使在 `L1`（储能柜级）或 `L2`（电池簇级）完全收起 160 颗电芯的状态下，父节点依然实时穿透汇报底层极值电芯位置（如 `MAX: 3348mV (#14)`、`MIN: 3312mV (#03)`）。
4. **`Δ SPREAD`（内部离散极差算子）**：
   - 实时计算容器内部电压极差 $\Delta V = V_{\max} - V_{\min}$ 与温差 $\Delta T = T_{\max} - T_{\min}$，直观量化木桶效应。
5. **`STATUS`（最差状态传染上卷算子 / Worst-of-Children Propagation）**：
   - 遵循工业安全监控准则：若某模组内存在任意一颗电芯处于触发主动均衡或电压偏高预警状态（如 `Mod #01` 中的 `Cell #014`），该状态自动向上传染至 `Mod #01` $\rightarrow$ `Rack 160S1P` $\rightarrow$ `BESS Cabinet`，在父节点右上角渲染琥珀色/红色告警光环，引导运维人员沿光环逐级下钻定位根因。

### 4.3 四种直观的下钻与上卷交互方式
1. **画布双击直达 (Canvas Double-Click)**：
   - 双击任意带有 `🔽双击下钻` 或 `📦已上卷` 标记的父容器节点，自动向下钻取一级并平滑缩放对焦；
   - 在 `L3` 模式下双击任意模组（如 `模组 #01`），仅在画布下方展开该模组专属的 16 颗电芯发光子拓扑框，再次双击该模组即可将 16 颗电芯重新上卷收起。
2. **顶部面包屑路径导航栏 (`#breadcrumb-trail`)**：
   - 实时显示当前所处的拓扑层级路径：`🌍 集团多站集群 (Fleet) ▸ 🏢 储能一体柜 (Cabinet 100kWh) ▸ 🔋 高压电池簇 (Rack 160S1P) ▸ 🧱 10串联模组 ▸ 🔬 电芯 #014 (二阶RC等效电路)`；点击路径上的任意祖先节点即可一键上卷回退。
3. **粒度深度胶囊切换器 (`L0` ~ `L4` Pills + `[🔽 下钻一级]` / `[🔼 上卷一级]`)**：
   - 位于面包屑右侧，支持一键在任意粒度深度间切换。
4. **右侧探针抽屉下钻/上卷控制台**：
   - 抽屉顶部配备醒目的 `[🔽 下钻展开子拓扑]` 与 `[🔼 上卷至父容器]` 双按钮，中部展示 **自底向上聚合指标数学公式表**，底部列出所有 **下辖子实体列表（点击任意子项直接下钻定位）**。

---

## 5. 前后端技术栈与通信管道

### 5.1 前端自研引擎（零外部网络依赖，O(1) 索引架构）
- **通用树与 O(1) 哈希索引**：基于 `nodeById`、`childrenById`、`inEdgesById`、`outEdgesById`、`adjById` 五大 `Map` 索引构建 **197 个节点** 与 **261 条边**（含 10 个模组内部 16S 电芯串联铜排链路）；状态切换时一次性计算可见集 `visibleNodeIds` 与聚合边 `effectiveEdges`，保证 60FPS 渲染循环复杂度严格为 $O(V_{\text{vis}} + E_{\text{vis}})$。
- **Dynatrace 边上卷引擎 (Edge Roll-Up)**：当子实体随父容器收起时，所有跨容器边界的物理、控制与通信连线自动通过 `findVisibleAncestor(id)` 投影至最近的可见祖先容器，并自动合并平行链路、在连线中点渲染 `×N 上卷链路` 聚合徽章。
- **二阶 Thevenin RC 等效电路严格物理一致性**：在 `L5` 电芯微观数字孪生视图中，严格遵循基尔霍夫电压定律 $V_{\text{term}}(t) = V_{\text{ocv}}(\text{SOC}) - I(t) \cdot R_0 - U_1(t) - U_2(t)$（以放电 $I > 0$ 为正），实时反推 $V_{\text{ocv}} = V_{\text{term}} + \Delta U_0 + U_1 + U_2$。

### 5.2 Nginx 只读最小权限反向代理与安全加固
Nginx（端口 `80` 与 `8081`）已启用严格的方法白名单与最小权限只读凭据加固：

```nginx
# 1. Dynatrace-Style Smartscape 独立全景应用
location /smartscape {
    alias /opt/openems/smartscape;
    index index.html;
    try_files $uri $uri/ /smartscape/index.html;
}

# 2. OpenEMS Edge REST API 只读代理 (强制拦截 POST/PUT/DELETE 写入 + Guest 只读凭据)
location /openems-rest/ {
    limit_except GET {
        deny all;
    }
    proxy_pass http://127.0.0.1:8095/rest/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Authorization "Basic Z3Vlc3Q6Z3Vlc3Q=";
}

# 3. OpenEMS InfluxDB 时序查询只读代理 (绑定 --read-bucket 只读范围令牌，内核级拒绝 to() 写入)
location /openems-influx {
    limit_except POST {
        deny all;
    }
    proxy_pass http://127.0.0.1:8086/api/v2/query?orgID=6cbd3b34c2aada40;
    proxy_http_version 1.1;
    proxy_set_header Authorization "Token <SCOPED_READONLY_BUCKET_TOKEN>";
    proxy_set_header Content-Type "application/vnd.flux";
}
```

### 5.3 真实 InfluxDB 160电芯遥测与多场站 (`?station=${edge}`) 闭环
Smartscape 前端守护引擎支持通过 URL 参数 `?station=bms|0..4` 与 Grafana `${edge}` 变量实时联动，每 1.5 秒带 `AbortController` 防重入保护向 `/openems-influx` 拉取全量真实时序数据：
- 一次性获取当前场站全部 240+ 个真实物理通道（含 `battery0/Cell_001_V` ~ `Cell_160_V` 单体电压、`battery0/Cell_001_T` ~ `Cell_160_T` 单体温度、`Module_01` ~ `Module_10` 模组电压/温度、电池簇总压/电流/SOC 及机柜有功功率）；
- 同步拉取全车队 6 座电站（`bms`, `0`..`4`）的实时有功功率与 SOC%，驱动 `L0` 集群视图；
- 为每个节点维护独立的 **30秒环形缓冲区 (`nodeHistory`)**，在右侧探针抽屉中实时绘制所选节点专属的 30 秒趋势曲线。

---

## 5. Grafana 嵌入与三屏联动体系

为了与现有生产运维体系无缝集成，我们构建了**三大看盘全域互联网络**：

```
                    ┌────────────────────────────────────────┐
                    │  1. 智慧微电网与储能调度中心看板       │
                    │  (/d/openems-ess-analytics)            │
                    │  全站能流、电表平衡、削峰填谷策略      │
                    └───────────────▲────────────────────────┘
                                    │
                         双向跳转   │   双向跳转
                                    ▼
┌────────────────────────────────────────┐        ┌────────────────────────────────────────┐
│  2. 储能柜五级物理拓扑看板              │ ◄────► │  3. Dynatrace Smartscape 交互拓扑看板  │
│  (/d/openems-bess-topology)            │        │  (/d/openems-smartscape-topology)      │
│  时序趋势、160电芯矩阵、极值统计仪表盘  │        │  全栈立体拓扑、力导图、探针抽屉、能流动画│
└────────────────────────────────────────┘        └────────────────────────────────────────┘
```

### 5.1 Grafana Smartscape 看板规格
- **UID**: `openems-smartscape-topology`
- **标题**: `OpenEMS 储能全景 Smartscape 交互式立体拓扑看板 (Cyber-Physical Digital Twin)`
- **面板组成**:
  - **顶部实时指标栏**: 储能柜工况、有功功率、直流端电压/电流、SOC%、单体压差 ΔV、极值电芯位置 (#14/#3)、绝缘阻抗与空调状态。
  - **核心全景交互区**: 720px 高度无边框嵌入式 Smartscape 应用视口，支持全屏展开、拓扑拖拽与抽屉探针交互。
  - **底部时序对照区**: 交直流有功动态响应曲线、BMS 充放电安全降额包络线、10 模组电压柱状图、160 电芯全景矩阵。

---

## 6. 实机部署与测试验证

### 6.1 Nginx 静态服务与 API 连通性测试
```bash
# 测试 Smartscape 主页面响应
$ curl -s -I http://127.0.0.1/smartscape/
HTTP/1.1 200 OK
Server: nginx/1.28.3 (Ubuntu)
Content-Type: text/html
Content-Length: 6472

# 测试 Edge REST API 代理通道
$ curl -s http://127.0.0.1/openems-rest/channel/battery0/Soc
{"address":"battery0/Soc","type":"INTEGER","accessMode":"RO","unit":"%","value":68}

# 测试 InfluxDB 代理通道
$ curl -s -X POST http://127.0.0.1/openems-influx \
  -d 'from(bucket: "openems") |> range(start: -1m) |> filter(fn: (r) => r.edge == "bms" and r._field == "battery0/Voltage") |> last()'
,result,table,_time,_value,_field,edge
,_result,0,2026-10-21T04:14:16Z,529,battery0/Voltage,bms
```

### 6.2 Grafana 看板注册与数据源验证
```bash
$ curl -s -u admin:admin http://127.0.0.1:3000/api/dashboards/uid/openems-smartscape-topology | jq '{title: .dashboard.title, uid: .dashboard.uid, panels_count: (.dashboard.panels | length)}'
{
  "title": "OpenEMS 储能全景 Smartscape 交互式立体拓扑看板 (Cyber-Physical Digital Twin)",
  "uid": "openems-smartscape-topology",
  "panels_count": 15
}
```

---

## 7. 交付文件清单与版本库确认

| 文件路径 | 属性 | 功能与说明 |
| :--- | :--- | :--- |
| [`/opt/openems/smartscape/index.html`](file:///opt/openems/smartscape/index.html) | 前端结构 | Smartscape 响应式应用主页面与探针抽屉结构 |
| [`/opt/openems/smartscape/smartscape.css`](file:///opt/openems/smartscape/smartscape.css) | 前端样式 | Cyber-Industrial 科技暗色主题、霓虹光晕与微动效样式 |
| [`/opt/openems/smartscape/smartscape.js`](file:///opt/openems/smartscape/smartscape.js) | 核心引擎 | Canvas 拓扑渲染、视口平移缩放、粒子能流、悬停血缘高亮与实时轮询 |
| [`/etc/nginx/sites-available/openems`](file:///etc/nginx/sites-available/openems) | 生产网关 | Nginx `/smartscape`、`/openems-rest/`、`/openems-influx` 反向代理路由 |
| [`scripts/generate_smartscape_dashboard.py`](file:///home/user01/local/openems/scripts/generate_smartscape_dashboard.py) | 自动化脚本 | 声明式构建 Grafana Smartscape 看板 JSON 并推送 API |
| [`scripts/openems_smartscape_topology_dashboard.json`](file:///home/user01/local/openems/scripts/openems_smartscape_topology_dashboard.json) | 看板资产 | Grafana 自动化声明式 Provisioning 看板配置 |
| [`OPENEMS_DYNATRACE_SMARTSCAPE_TOPOLOGY.md`](file:///home/user01/local/openems/OPENEMS_DYNATRACE_SMARTSCAPE_TOPOLOGY.md) | 技术规范 | 架构设计全景分析与实现说明官方文档 |

---
*报告生成于 2026-10-21，已同步纳入 OpenEMS Git 版本库与生产部署体系。*
