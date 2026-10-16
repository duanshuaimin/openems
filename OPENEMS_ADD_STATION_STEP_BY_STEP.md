# OpenEMS 新增电站监控与入网全流程操作指南 (Step-by-Step)

在工商业光储充、分布式台区储能及虚拟电厂（VPP）业务场景中，当现场新建一座储能电站或微电网系统后，需要将其接入到 OpenEMS 监控与调度管理体系中。

本文档提供一份标准化的 **端到端（Step-by-Step）实操指引**，涵盖从**边缘侧驱动与控制回路配置**、**云端安全反向隧道建立**、**中台元数据建档与多租户 RBAC 授权**，到 **Web UI 与 Grafana 调度大屏联动呈现** 的全生命周期流程。

---

## 一、 端到端入网拓扑与全景流程

```mermaid
flowchart TD
    subgraph Phase1 ["阶段一：边缘现场控制器与硬件配置 (OpenEMS Edge)"]
        EdgeHW["工控机安装 OpenEMS Edge 内核"]
        Modbus["配置硬件通信总线 (Modbus TCP/RTU)"]
        Drivers["配置核心电气设备驱动 (Meter / ESS / PV / EVCS)"]
        Ctrl["配置微电网调度控制器 (Balancing / PeakShaving)"]
        EdgeHW --> Modbus --> Drivers --> Ctrl
    end

    subgraph Phase2 ["阶段二：边缘安全加密反向隧道 (Tunnel & Timedata)"]
        BackendTunnel["配置 Controller.Api.Backend (设置 apikey 与云端地址)"]
        TimedataCfg["配置 Timedata.InfluxDB (时序数据通道)"]
        Ctrl --> BackendTunnel
        Ctrl --> TimedataCfg
    end

    subgraph Phase3 ["阶段三：云端元数据建档与多租户授权 (OpenEMS Backend & ERP)"]
        ERP["在 Odoo ERP / 元数据中台登记电站 (Name: edge2, API-Key)"]
        RBAC["分配多租户角色 (Owner 业主 / Installer 运维商)"]
        BackendSync["云端内存高速缓存 (EdgeCache) 毫秒级生效"]
        ERP --> RBAC --> BackendSync
    end

    subgraph Phase4 ["阶段四：全链路数据流验证与大屏展示 (UI & Visualization)"]
        WssHandshake["边缘发起 WSS 握手，云端比对 Apikey 建立隧道"]
        InfluxStream["时序数据注入 Tag: edge=2 写入 InfluxDB v2"]
        CloudUI["OpenEMS 云端 Web UI 自动激活车队大屏模式"]
        GrafanaDash["Grafana 智能调度大屏下拉框秒级联动呈现"]
        BackendTunnel -.->|"WSS 握手"| WssHandshake
        TimedataCfg -.->|"数据上报"| InfluxStream
        BackendSync --> WssHandshake
        WssHandshake --> InfluxStream --> CloudUI --> GrafanaDash
    end
```

---

## 二、 阶段一：边缘现场控制器与硬件配置 (OpenEMS Edge)

### 1. 边缘运行环境准备
在现场工业计算机（如 DIN 导轨工控机、树莓派工业板卡）上准备环境：
- **操作系统**：Ubuntu 20.04/22.04 LTS 或 Debian 11/12
- **Java 运行环境**：OpenJDK 17 或 21（`java -version` 确认）
- **服务状态确认**：
  ```bash
  sudo systemctl status openems-edge
  ```

### 2. 配置通信总线（Modbus 协议桥接）
储能设备通常采用 RS485 (RTU) 或以太网 (TCP) 通信。

#### 示例：配置 Modbus TCP 桥接 (`Bridge.Modbus.Tcp`)
创建配置文件 `/etc/openems.d/Bridge/Modbus/Tcp/bridge0.config`：
```properties
service.pid="Bridge.Modbus.Tcp.bridge0"
service.factoryPid="Bridge.Modbus.Tcp"
id="bridge0"
alias="站内PCS与关口电表以太网总线"
enabled=B"true"
ip="192.168.1.100"
port=I"502"
```

---

### 3. 配置核心电气设备驱动

电站监控依赖三大基础电气角色：**关口电表（Grid Meter）**、**储能系统（ESS）**、**光伏发电（PV）**。

#### A. 关口防逆流电表 (`Meter.Grid`)
创建配置文件 `/etc/openems.d/Meter/CarloGavazzi/meter0.config`（以 Carlo Gavazzi 电表为例）：
```properties
service.pid="Meter.CarloGavazzi.EM300.meter0"
service.factoryPid="Meter.CarloGavazzi.EM300"
id="meter0"
alias="10kV开闭所进线关口电表"
enabled=B"true"
type="GRID"
modbus.id="bridge0"
modbusUnitId=I"1"
```

#### B. 储能变流器与电池系统 (`Ess`)
创建配置文件 `/etc/openems.d/Ess/Generic/ManagedSymmetric/ess0.config`：
```properties
service.pid="Ess.Generic.ManagedSymmetric.ess0"
service.factoryPid="Ess.Generic.ManagedSymmetric"
id="ess0"
alias="500kW/1000kWh 磷酸铁锂储能集装箱"
enabled=B"true"
startStop="START"
capacity=I"1000000"
maxApparentPower=I"500000"
modbus.id="bridge0"
modbusUnitId=I"2"
```

#### C. 光伏并网逆变器 (`PvInverter`)
创建配置文件 `/etc/openems.d/PvInverter/Fronius/meter1.config`：
```properties
service.pid="PvInverter.Fronius.meter1"
service.factoryPid="PvInverter.Fronius"
id="meter1"
alias="厂房屋顶 300kW 分布式光伏"
enabled=B"true"
modbus.id="bridge0"
modbusUnitId=I"3"
```

---

### 4. 配置微电网控制算法与调度策略

#### A. 自发自用与防逆流平衡控制器 (`Controller.Symmetric.Balancing`)
创建配置文件 `/etc/openems.d/Controller/Symmetric/Balancing/ctrlBalancing0.config`：
```properties
service.pid="Controller.Symmetric.Balancing.ctrlBalancing0"
service.factoryPid="Controller.Symmetric.Balancing"
id="ctrlBalancing0"
alias="微电网防逆流与动态自平衡控制"
enabled=B"true"
ess.id="ess0"
meter.id="meter0"
targetGridSetpoint=I"0"
```
> **作用**：让储能系统根据关口电表 $P_{\text{Grid}}$ 实时调整充放电功率，优先让光伏电量在站内消纳，保持关口功率为 0W（严格防逆流）。

#### B. 任务调度执行器 (`Scheduler`)
确保调度器已启用：`/etc/openems.d/Scheduler/AllAlphabetically/default.config`
```properties
service.pid="Scheduler.AllAlphabetically.default"
service.factoryPid="Scheduler.AllAlphabetically"
id="scheduler0"
enabled=B"true"
controllers.ids=[ "ctrlBalancing0" ]
```

---

## 三、 阶段二：边缘安全加密反向隧道配置 (Edge-to-Backend)

边缘现场处于局域网私网内部，无须申请公网 IP 或配置端口映射，通过主动向云端建立反向 WebSocket 加密长连接实现穿透。

### 1. 配置云端通信组件 (`Controller.Api.Backend`)
创建或编辑文件 `/etc/openems.d/Controller/Api/Backend/ctrlBackend0.config`：
```properties
service.pid="Controller.Api.Backend.ctrlBackend0"
service.factoryPid="Controller.Api.Backend"
id="ctrlBackend0"
alias="云端监控中心反向安全隧道"
enabled=B"true"

# 云端 BackendEdgeApp 网关地址 (局域网测试填 172.16.100.234，生产填公网域名)
uri="ws://172.16.100.234:8084"

# 该电站专属安全接入凭证 (需与云端元数据完全一致)
apikey="secret_edge2_key_8899"

proxy=""
```

### 2. 配置时序数据上报组件 (`Timedata.InfluxDB`)
编辑文件 `/etc/openems.d/Timedata/InfluxDB/influx0.config`：
```properties
service.pid="Timedata.InfluxDB.influx0"
service.factoryPid="Timedata.InfluxDB"
id="influx0"
alias="高频时序数据写入通道"
enabled=B"true"
url="http://172.16.100.234:8086"
org="openems"
bucket="openems"
apiKey="OpenEmsInfluxSecretToken2026!"
measurement="data"
queryLanguage="FLUX"
noOfCycles=I"1"
maxQueueSize=I"5000"
isReadOnly=B"false"
```

### 3. 重启边缘控制器
```bash
sudo systemctl restart openems-edge
# 查看启动与连接日志
journalctl -u openems-edge -n 50 --no-pager
```

---

## 四、 阶段三：云端元数据建档与多租户授权 (Backend & ERP)

OpenEMS 支持两种常见管理模式：**企业级 Odoo ERP 模式** 与 **轻量开发/文件模式**。

### 选项 A：企业级 Odoo ERP 模式 (推荐生产采用)

1. **登录 Odoo 运营管理后台**：
   - 访问地址：`http://172.16.100.234:8069`；
   - 登录系统管理员账号。
2. **新建电站资产档案 (`openems.device`)**：
   - 点击顶部主菜单 **OpenEMS** $\rightarrow$ 进入 **Devices** 列表；
   - 点击 **新建 (New)**；
   - 录入电站基本参数：
     - **Name**：`edge2`（必须符合小写 `edge<数字>` 命名规则）；
     - **Comment**：`苏州工业园2号 500kW/1000kWh 光储充示范站`；
     - **Product Type**：选择对应机型；
     - **API-Key**：填写与边缘端配置完全一致的字符串：`secret_edge2_key_8899`。
   - 点击保存。
3. **分配多租户角色权限 (`User Roles`)**：
   - 在当前 `edge2` 详情页下方的 **User Roles** 明细列表中点击 **添加明细行**；
   - **选择用户**：例如选择租户用户 `李经理 (企业客户)`；
   - **赋予角色**：
     - 资产业主：选择 **Owner**（具备运行参数配置与收益报表查看权）；
     - 运维安装商：选择 **Installer**（具备硬件驱动重载与底层策略权）；
   - 点击保存完成授权。
4. **云端即时生效**：
   - OpenEMS Backend 的 `Metadata.Odoo` 模块通过数据库监听或定期缓存同步，毫秒级将 `edge2` 的 Apikey 载入内存 [`EdgeCache`](io.openems.backend.metadata.odoo/src/io/openems/backend/metadata/odoo/EdgeCache.java)，电站即刻具备接入资格。

---

### 选项 B：轻量测试/文件模式 (`Metadata.Dummy` / `Metadata.File`)

若当前环境处于离线测试或未启用 Odoo：
1. **修改 Dummy 范围**：
   查看 `/etc/openems-backend.d/Metadata.Dummy.config`：
   ```properties
   service.pid="Metadata.Dummy"
   edgeIdTemplate="edge%d"
   edgeIdMax=I"10"
   ```
   只需确保目标编号（如 `edge2` 的 `2`）小于 `edgeIdMax`，系统会自动将该电站纳入管理。

---

## 五、 阶段四：全链路数据流验证与大屏联动呈现

### 1. 验证边缘反向长连接隧道
在云端主机执行命令检查边缘连接：
```bash
journalctl -u openems-backend -n 30 --no-pager | grep -iE "edge2|websocket"
```
*预期输出：*
```text
INFO  [Edge.Manager] Edge [edge2] connected via WebSocket tunnel
```
在 Odoo 后台刷新 `edge2` 设备页面，**OpenEMS Is Connected** 状态将自动变更为 **已连接 (True)**，并同步显示固件版本与最新心跳时间戳。

---

### 2. 验证 InfluxDB v2 时序数据链路
在终端中执行 Flux 查询，验证新电站 `edge=2` 的数据是否按物理标签正确写入：
```bash
curl -s -X POST "http://127.0.0.1:8086/api/v2/query?org=openems" \
  -H "Authorization: Token OpenEmsInfluxSecretToken2026!" \
  -H "Accept: application/csv" \
  -H "Content-type: application/vnd.flux" \
  -d 'from(bucket: "openems")
  |> range(start: -5m)
  |> filter(fn: (r) => r.edge == "2")
  |> filter(fn: (r) => r._field == "_sum/GridActivePower" or r._field == "_sum/EssSoc")
  |> last()'
```
*若终端返回清晰的 CSV 数据行与最新时间戳，说明时序数据写入链路完全畅通。*

---

### 3. OpenEMS 云端 Web UI 验证
1. 打开浏览器访问：`http://172.16.100.234:8081`；
2. 输入被授权用户的账号密码登录；
3. **效果确认**：
   - 界面顶栏自动激活 **电站切换下拉选单**；
   - 首页自动展示 **车队网格视图（Fleet Grid View）**，包含 `edge0`、`edge1` 及新上线的 `edge2`；
   - 点击 `edge2` 卡片，平滑进入电站单站监控大屏，实时呈现储能拓扑与控制按钮。

---

### 4. Grafana 智能运维调度大屏联动
1. 打开浏览器访问 Grafana：`http://172.16.100.234:3000`（或直达大屏 `/d/openems-ess-analytics`）；
2. 观察看板左上角 **「选择监控电站 (Edge Fleet)」** 下拉选单；
3. **效果确认**：
   - 下拉选单已通过 InfluxDB 元数据动态识别出选项 `2`；
   - 切换到 `2`，全屏 **7 大业务行、24 个监控面板** 瞬间联动刷新为 `edge2` 的实时监控流：
     - 核心工况灯（正常运行 NORMAL）
     - 储能充放功率与实时状态
     - 电池 SOC 环形仪表盘
     - 微电网四象限物理平衡时序曲线
     - 电池三相电能质量与累计充放电量统计。

---

## 六、 现场运维排错与故障排查速查表

| 故障现象 | 根因定位 | 排查与解决办法 |
| :--- | :--- | :--- |
| **边缘端日志报错：`Connection refused`** | 边缘无法连通云端反向隧道端口 `8084` 或 `8085` | 1. 检查云端 `BackendEdgeApp` 服务是否存活；<br/>2. 检查现场路由器防火墙是否放行出站连接；<br/>3. 在边缘执行 `nc -zv 172.16.100.234 8084` 测通。 |
| **云端日志抛出：`OpenemsError.EDGE_KEY_NOT_FOUND`** | 边缘上报的 `apikey` 在元数据中不存在 | 1. 核对边缘 `/etc/openems.d/Controller/Api/Backend/...config` 中的 `apikey`；<br/>2. 确认 Odoo `Devices` 列表中的 `API-Key` 字符串与边缘完全一致（严防首尾空格）。 |
| **设备在 Odoo 显示已连接，但 Web UI 找不到电站** | 登录用户未在 Odoo 中获得该电站的访问授权 | 1. 检查 Odoo `edge2` 设备详情页底部的 `User Roles` 表；<br/>2. 确认当前登录用户的账号已添加为 `Owner` 或 `Installer`。 |
| **Grafana 下拉选单没有出现新电站编号** | InfluxDB 中尚未写入带有 `edge=<id>` 标签的数据 | 1. 检查边缘 `Timedata.InfluxDB` 的服务状态；<br/>2. 检查 InfluxDB Token 与 Bucket 权限是否匹配；<br/>3. 确保边缘至少正常完成过 1 次 Cycle 周期计算并成功推送数据。 |
| **功率平衡曲线残差过大（残差 $\neq 0\text{ W}$）** | 电表或光伏方向接线反相或互感器变比配置错误 | 1. 检查关口电表取电方向（正常购电有功应为正）；<br/>2. 确认光伏逆变器在发电时 $P_{\text{PV}} > 0$；<br/>3. 检查互感器 CT 穿线方向与变比系数。 |
