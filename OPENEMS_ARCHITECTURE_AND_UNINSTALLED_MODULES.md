# 本机 OpenEMS 架构与未安装模块

采集时间：2026-10-16。对照 `/opt/openems/source`、三份 `*.bndrun`、三个正在运行的 JAR，以及 `/etc/openems*.d` 里的组件实例。

## 架构

本机是三进程 OSGi（Apache Felix），外加 Nginx 上的两套静态 UI。Edge 跑现场逻辑，Backend 管设备和历史，Backend Edge 只做 WebSocket 转发。

```text
Nginx :80/:4200  /opt/openems/ui
    /openems-edge  ->  Edge WebSocket :8075
Nginx :8081        /opt/openems/backend-ui
    /openems-backend -> Backend UI WebSocket :8082

Edge  openems-edge.jar
  Core 周期、组件管理、AppManager
  Scheduler.AllAlphabetically
  仿真设备 ess0 / meter0 / meter1 / evcs0
  Controller.Symmetric.Balancing、Controller.Evcs
  Controller.Api.Websocket :8075
  Controller.Api.Backend   -> ws://127.0.0.1:8084
  Controller.Api.ModbusTcp.ReadOnly :502
  Timedata.Rrd4j（本地）
  Timedata.InfluxDB 只读同一桶

Backend Edge  openems-backend-edge.jar
  Backend.Edge.App  监听 :8084，连到 ws://127.0.0.1:8085

Backend  openems-backend.jar
  Edge.Manager            :8085
  Ui.Websocket            :8082
  Metadata.Odoo           Odoo :8069 + PostgreSQL
  Timedata.InfluxDB       写入 Influx :8086
```

Edge 一个控制周期里的关系：

1. **Core** 按周期唤醒组件。`Core.Cycle`、`Core.ComponentManager`、`Core.Sum`、`Ess.Power` 是单例，随 Edge 启动。
2. **Bridge / 设备** 读硬件或仿真器，露出通道。本机没有真实 Modbus 设备，功率来自 `Simulator.*`。
3. **Scheduler** 按顺序调用 **Controller**。当前调度器是 `Scheduler.AllAlphabetically`，实际跑的是自发自用平衡和充电桩余电充电。
4. **Timedata** 把通道留给本机 UI 和 Backend。Rrd4j 在 Edge 本地；Influx 由 Backend 写入，Edge 只读。
5. **Controller.Api.*** 把同一套通道暴露给本机 WebSocket、Modbus 和云端 Backend。

Backend 里同一类职责可以有多套实现，靠 Felix 配置选一套。本机选中的是 `Metadata.Odoo` 和 `Timedata.InfluxDB`。`Edge.Manager` 收 Edge 长连接，`Ui.Websocket` 把 UI 的 JSON-RPC 转到对应 Edge。

源码工程 236 个（`/opt/openems/source` 下带 `bnd.bnd` 的目录）。运行包里的 OpenEMS bundle：Edge JAR 204 个 Edge 业务 bundle，Backend JAR 含全部 `BackendApp.bndrun` 要求的 20 个，代理 JAR 含 `BackendEdgeApp.bndrun` 要求的 4 个。

Edge JAR 里已打包的 bundle 按目录前缀大致是：controller 58、meter 23、evcs 15、timeofusetariff 13、io 10、evse 9、ess 8、battery 7、predictor 6，其余为逆变器品牌、桥接、热泵、调度器、仿真器等。bundle 在 JAR 里只表示 OSGi 能加载，不表示已经有组件实例。

## 两种“没装上”

| 说法 | 判定 | 本机数量 |
| --- | --- | --- |
| 未打进运行 JAR | 源码和 `EdgeApp.bndrun` 的 `-runrequires` 有，`openems-edge.jar` 的 `jar/` 里没有 | 5 |
| 已打包、未建实例 | bundle 在 JAR 里，`/etc/openems.d` 没有对应 `factoryPid` | 312 个工厂组件 |

Backend、Backend Edge 的 `-runrequires` 与 JAR 一致，没有缺 bundle。

## 未打进 Edge JAR 的 5 个模块

这 5 个目录和 `EdgeApp.bndrun` 都有，当前 `openems-edge.jar`（2026-10-12 的 64MB 包）里没有。Felix 里创建不了它们的组件。

| Bundle | 作用 |
| --- | --- |
| `io.openems.edge.controller.ess.stepsoc` | 储能 SOC 分步控制 |
| `io.openems.edge.evse.chargepoint.ambibox` | Ambibox 充电桩 |
| `io.openems.edge.evse.chargepoint.voltie` | Voltie 充电桩 |
| `io.openems.edge.firealarmsystem.hekatron` | Hekatron 火警 |
| `io.openems.edge.fluidcooling.hydac` | Hydac 液冷 |

`io.openems.wrapper` 是第三方库的父目录，不是 Edge 业务模块。

## 已在 Backend JAR、配置未启用

这些 bundle 已经在 `openems-backend.jar` 里。`/etc/openems-backend.d` 没有对应配置，组件策略是 `require`，所以不会启动。

| 组件 PID | Bundle | 未被选用的原因 |
| --- | --- | --- |
| `Metadata.Dummy` | `io.openems.backend.metadata.dummy` | 元数据已用 Odoo |
| `Metadata.File` | `io.openems.backend.metadata.file` | 同上 |
| `Timedata.Dummy` | `io.openems.backend.timedata.dummy` | 时序已用 InfluxDB |
| `Timedata.AggregatedInfluxDB` | `io.openems.backend.timedata.aggregatedinflux` | 未配置聚合 Influx |
| `Alerting` | `io.openems.backend.alerting` | 没有告警组件配置 |
| `Metrics.Prometheus` | `io.openems.backend.metrics.prometheus` | 没有 Prometheus 导出配置 |
| `Authentication.OAuth` | `io.openems.backend.authentication.oauth2` | 没有 OAuth 登录配置 |
| `Authentication.OAuth.ClientConfig` | 同上 | 工厂，无实例 |
| `OAuthRegistry.Client` | `io.openems.backend.oauthregistry` | 工厂，无实例 |
| `Backend2Backend.Rest` | `io.openems.backend.b2brest` | 没有后端互联 |
| `Backend2Backend.Websocket` | `io.openems.backend.b2bwebsocket` | 没有后端互联 |
| `Simulator.Mailer` | `io.openems.backend.simulator` | 没有邮件仿真 |

已启用的 Backend 单例是 `Edge.Manager`、`Ui.Websocket`、`Metadata.Odoo`，工厂是 `Timedata.InfluxDB`（`timedata0`，可写）。

`Core.JsonRpcRequestHandler` 和 `Core.TimedataManager` 在源码里是 optional，没有单独的 `.config` 也会随 Backend 起来。代理进程里的 Prometheus bundle 同样没有业务配置。

## Edge 上已经启用的实例

`/etc/openems.d` 里实际存在的工厂：

- `Simulator.EssSymmetric.Reacting`（ess0）
- `Simulator.GridMeter.Acting`（meter0）
- `Simulator.PvInverter`（meter1）
- `Simulator.Evcs`（evcs0）
- `Simulator.Datasource.CSV.Predefined`（datasource0、datasource1）
- `Controller.Symmetric.Balancing`（ctrlBalancing0）
- `Controller.Evcs`（ctrlEvcs0）
- `Controller.Api.Backend`（ctrlBackend0）
- `Controller.Api.Websocket`（ctrlApiWebsocket0）
- `Controller.Api.ModbusTcp.ReadOnly`（ctrlApiModbusTcp0）
- `Controller.Debug.Log`（ctrlDebugLog0）
- `Scheduler.AllAlphabetically`（scheduler0）
- `Timedata.InfluxDB`（influx0，只读）
- `Timedata.Rrd4j`（两份配置，id 都是 rrd4j0）

单例已有配置：`Core.AppManager`、`Core.ComponentManager`、`Core.Cycle`、`Core.Energy`、`Core.Host`、`Core.Meta`、`Core.PredictorManager`、`Core.SerialNumber`、`Core.Sum`、`Core.User`、`Ess.Power`、`Evcs.SlowPowerIncreaseFilter`。

`Core.AppManager` 里登记了一个 App：`App.Api.ModbusTcp.ReadOnly`。

Edge 工厂组件一共 326 个，上面 14 种工厂已有实例，其余 **312** 个没有实例。bundle 已在 JAR 中，只是 `/etc/openems.d` 没给它们建配置。下面按 bundle 前两段分组列出工厂 PID。

## 已打包但没有实例的 Edge 工厂

### controller.ess（22）

- `Controller.Ess.AcIsland`（`io.openems.edge.controller.ess.acisland`）
- `Controller.Ess.ActivePowerVoltageCharacteristic`（`io.openems.edge.controller.ess.activepowervoltagecharacteristic`）
- `Controller.Ess.Cycle`（`io.openems.edge.controller.ess.cycle`）
- `Controller.Ess.DelayCharge`（`io.openems.edge.controller.ess.delaycharge`）
- `Controller.Ess.DelayedSellToGrid`（`io.openems.edge.controller.ess.delayedselltogrid`）
- `Controller.Ess.EmergencyCapacityReserve`（`io.openems.edge.controller.ess.emergencycapacityreserve`）
- `Controller.Ess.FastFrequencyReserve`（`io.openems.edge.controller.ess.fastfrequencyreserve`）
- `Controller.Ess.FixActivePower`（`io.openems.edge.controller.ess.fixactivepower`）
- `Controller.Ess.FixStateOfCharge`（`io.openems.edge.controller.ess.fixstateofcharge`）
- `Controller.Ess.GridOptimizedCharge`（`io.openems.edge.controller.ess.gridoptimizedcharge`）
- `Controller.Ess.Hybrid.Surplus-Feed-To-Grid`（`io.openems.edge.controller.ess.hybrid.surplusfeedtogrid`）
- `Controller.Ess.LimitTotalDischarge`（`io.openems.edge.controller.ess.limittotaldischarge`）
- `Controller.Ess.Limiter14a`（`io.openems.edge.controller.ess.limiter14a`）
- `Controller.Ess.LinearPowerBand`（`io.openems.edge.controller.ess.linearpowerband`）
- `Controller.Ess.MinimumDischargePower`（`io.openems.edge.controller.ess.mindischargeperiod`）
- `Controller.Ess.PrepareBatteryExtension`（`io.openems.edge.controller.ess.fixstateofcharge`）
- `Controller.Ess.ReactivePowerVoltageCharacteristic`（`io.openems.edge.controller.ess.reactivepowervoltagecharacteristic`）
- `Controller.Ess.RippleControlReceiver`（`io.openems.edge.controller.ess.ripplecontrolreceiver`）
- `Controller.Ess.SellToGridLimit`（`io.openems.edge.controller.ess.selltogridlimit`）
- `Controller.Ess.SoH.Cycle`（`io.openems.edge.controller.ess.sohcycle`）
- `Controller.Ess.Standby`（`io.openems.edge.controller.ess.standby`）
- `Controller.Ess.Time-Of-Use-Tariff`（`io.openems.edge.controller.ess.timeofusetariff`）

### io.shelly（17）

- `IO.Shelly.25`（`io.openems.edge.io.shelly`）
- `IO.Shelly.3EM`（`io.openems.edge.io.shelly`）
- `IO.Shelly.3EMG3`（`io.openems.edge.io.shelly`）
- `IO.Shelly.OutdoorPlugSG3`（`io.openems.edge.io.shelly`）
- `IO.Shelly.Plug`（`io.openems.edge.io.shelly`）
- `IO.Shelly.PlugSG3`（`io.openems.edge.io.shelly`）
- `IO.Shelly.Plus.PlugS`（`io.openems.edge.io.shelly`）
- `IO.Shelly.Plus1PM`（`io.openems.edge.io.shelly`）
- `IO.Shelly.PlusPMMini`（`io.openems.edge.io.shelly`）
- `IO.Shelly.Pro1PM`（`io.openems.edge.io.shelly`）
- `IO.Shelly.Pro2PM`（`io.openems.edge.io.shelly`）
- `IO.Shelly.Pro2PM.Terminal`（`io.openems.edge.io.shelly`）
- `IO.Shelly.Pro3`（`io.openems.edge.io.shelly`）
- `IO.Shelly.Pro3EM`（`io.openems.edge.io.shelly`）
- `IO.Shelly.Pro4PM`（`io.openems.edge.io.shelly`）
- `IO.Shelly.Pro4PM.Terminal`（`io.openems.edge.io.shelly`）
- `IO.Shelly1`（`io.openems.edge.io.shelly`）

### simulator（15）

- `Simulator.Battery`（`io.openems.edge.simulator`）
- `Simulator.Datasource.CSV.Direct`（`io.openems.edge.simulator`）
- `Simulator.Datasource.Single.Channel`（`io.openems.edge.simulator`）
- `Simulator.Datasource.Single.Direct`（`io.openems.edge.simulator`）
- `Simulator.EssAsymmetric.Reacting`（`io.openems.edge.simulator`）
- `Simulator.EssSinglePhase.Reacting`（`io.openems.edge.simulator`）
- `Simulator.Evse.ChargePoint`（`io.openems.edge.simulator`）
- `Simulator.GridMeter.Reacting`（`io.openems.edge.simulator`）
- `Simulator.IO.DigitalInputOutput`（`io.openems.edge.simulator`）
- `Simulator.Modbus`（`io.openems.edge.simulator`）
- `Simulator.NRCMeter.Acting`（`io.openems.edge.simulator`）
- `Simulator.Predictor`（`io.openems.edge.simulator`）
- `Simulator.ProductionMeter.Acting`（`io.openems.edge.simulator`）
- `Simulator.Thermometer`（`io.openems.edge.simulator`）
- `Simulator.Timedata`（`io.openems.edge.simulator`）

### evse.chargepoint（13）

- `Evcs.AlpitronicHypercharger`（`io.openems.edge.evse.chargepoint.alpitronic`）
- `Evcs.HardyBarth`（`io.openems.edge.evse.chargepoint.hardybarth`）
- `Evcs.Keba.KeContact`（`io.openems.edge.evse.chargepoint.keba`）
- `Evcs.Keba.P40`（`io.openems.edge.evse.chargepoint.keba`）
- `Evcs.Mennekes`（`io.openems.edge.evse.chargepoint.mennekes`）
- `Evse.ChargePoint.Alfen`（`io.openems.edge.evse.chargepoint.alfen`）
- `Evse.ChargePoint.Alpitronic`（`io.openems.edge.evse.chargepoint.alpitronic`）
- `Evse.ChargePoint.HardyBarth`（`io.openems.edge.evse.chargepoint.hardybarth`）
- `Evse.ChargePoint.HardyBarth.cPH1`（`io.openems.edge.evse.chargepoint.hardybarth`）
- `Evse.ChargePoint.Heidelberg.Connect`（`io.openems.edge.evse.chargepoint.heidelberg`）
- `Evse.ChargePoint.Keba.Modbus`（`io.openems.edge.evse.chargepoint.keba`）
- `Evse.ChargePoint.Keba.UDP`（`io.openems.edge.evse.chargepoint.keba`）
- `Evse.ChargePoint.Mennekes`（`io.openems.edge.evse.chargepoint.mennekes`）

### goodwe（12）

- `GoodWe.BatteryCluster.FeneconHome`（`io.openems.edge.goodwe`）
- `GoodWe.BatteryInverter`（`io.openems.edge.goodwe`）
- `GoodWe.Charger-PV1`（`io.openems.edge.goodwe`）
- `GoodWe.Charger-PV2`（`io.openems.edge.goodwe`）
- `GoodWe.Charger-PV3`（`io.openems.edge.goodwe`）
- `GoodWe.Charger.Mppt.Two-String`（`io.openems.edge.goodwe`）
- `GoodWe.Charger.Two-String`（`io.openems.edge.goodwe`）
- `GoodWe.EmergencyPowerMeter`（`io.openems.edge.goodwe`）
- `GoodWe.Ess`（`io.openems.edge.goodwe`）
- `GoodWe.Genset`（`io.openems.edge.goodwe`）
- `GoodWe.Grid-Meter`（`io.openems.edge.goodwe`）
- `GoodWe.StsBox`（`io.openems.edge.goodwe`）

### victron（9）

- `Victron.Battery`（`io.openems.edge.victron`）
- `Victron.Battery-Inverter`（`io.openems.edge.victron`）
- `Victron.DC-Charger`（`io.openems.edge.victron`）
- `Victron.Ess`（`io.openems.edge.victron`）
- `Victron.Meter.AcIn`（`io.openems.edge.victron`）
- `Victron.Meter.AcOut`（`io.openems.edge.victron`）
- `Victron.Meter.Grid`（`io.openems.edge.victron`）
- `Victron.PV-Inverter`（`io.openems.edge.victron`）
- `Victron.PvInverter.via.DCCharger`（`io.openems.edge.victron`）

### controller.io（7）

- `Controller.IO.Alarm`（`io.openems.edge.controller.io.alarm`）
- `Controller.IO.Analog`（`io.openems.edge.controller.io.analog`）
- `Controller.IO.ChannelSingleThreshold`（`io.openems.edge.controller.io.channelsinglethreshold`）
- `Controller.IO.Heating.Room`（`io.openems.edge.controller.io.heating.room`）
- `Controller.IO.HeatingElement`（`io.openems.edge.controller.io.heatingelement`）
- `Controller.Io.FixDigitalOutput`（`io.openems.edge.controller.io.fixdigitaloutput`）
- `Controller.Io.HeatPump.SgReady`（`io.openems.edge.controller.io.heatpump.sgready`）

### kostal（7）

- `Kostal.Piko.Charger`（`io.openems.edge.kostal`）
- `Kostal.Piko.Core`（`io.openems.edge.kostal`）
- `Kostal.Piko.Ess`（`io.openems.edge.kostal`）
- `Kostal.Piko.GridMeter`（`io.openems.edge.kostal`）
- `Kostal.Plenticore.Ess`（`io.openems.edge.kostal`）
- `Kostal.Plenticore.KSEM`（`io.openems.edge.kostal`）
- `Kostal.Plenticore.PV-Inverter`（`io.openems.edge.kostal`）

### meter.janitza（7）

- `Meter.Janitza.UMG104`（`io.openems.edge.meter.janitza`）
- `Meter.Janitza.UMG511`（`io.openems.edge.meter.janitza`）
- `Meter.Janitza.UMG604`（`io.openems.edge.meter.janitza`）
- `Meter.Janitza.UMG801`（`io.openems.edge.meter.janitza`）
- `Meter.Janitza.UMG806`（`io.openems.edge.meter.janitza`）
- `Meter.Janitza.UMG96PQL`（`io.openems.edge.meter.janitza`）
- `Meter.Janitza.UMG96RME`（`io.openems.edge.meter.janitza`）

### sma（7）

- `Ess.SMA.StpSe.Battery`（`io.openems.edge.sma`）
- `Ess.SMA.StpSe.DcCharger`（`io.openems.edge.sma`）
- `Ess.SMA.StpSe.Inverter`（`io.openems.edge.sma`）
- `Ess.SMA.SunnyBoyStorage`（`io.openems.edge.sma`）
- `Ess.SMA.SunnyIsland`（`io.openems.edge.sma`）
- `Meter.SMA.SHM20`（`io.openems.edge.sma`）
- `PV-Inverter.SMA.SunnyTripower`（`io.openems.edge.sma`）

### controller.api（6）

- `Controller.Api.MQTT`（`io.openems.edge.controller.api.mqtt`）
- `Controller.Api.ModbusRtu.ReadOnly`（`io.openems.edge.controller.api.modbus`）
- `Controller.Api.ModbusRtu.ReadWrite`（`io.openems.edge.controller.api.modbus`）
- `Controller.Api.ModbusTcp.ReadWrite`（`io.openems.edge.controller.api.modbus`）
- `Controller.Api.Rest.ReadOnly`（`io.openems.edge.controller.api.rest`）
- `Controller.Api.Rest.ReadWrite`（`io.openems.edge.controller.api.rest`）

### controller.symmetric（6）

- `Controller.Symmetric.BalancingSchedule`（`io.openems.edge.controller.symmetric.balancingschedule`）
- `Controller.Symmetric.FixReactivePower`（`io.openems.edge.controller.symmetric.fixreactivepower`）
- `Controller.Symmetric.LimitActivePower`（`io.openems.edge.controller.symmetric.limitactivepower`）
- `Controller.Symmetric.PeakShaving`（`io.openems.edge.controller.symmetric.peakshaving`）
- `Controller.Symmetric.RandomPower`（`io.openems.edge.controller.symmetric.randompower`）
- `Controller.TimeslotPeakshaving`（`io.openems.edge.controller.symmetric.timeslotpeakshaving`）

### battery.soltaro（5）

- `Battery.Soltaro.Cluster.VersionC`（`io.openems.edge.battery.soltaro`）
- `Bms.Soltaro.Cluster.VersionB`（`io.openems.edge.battery.soltaro`）
- `Bms.Soltaro.SingleRack.VersionA`（`io.openems.edge.battery.soltaro`）
- `Bms.Soltaro.SingleRack.VersionB`（`io.openems.edge.battery.soltaro`）
- `Bms.Soltaro.SingleRack.VersionC`（`io.openems.edge.battery.soltaro`）

### edge2edge（5）

- `Bridge.Edge2Edge.Websocket`（`io.openems.edge.edge2edge`）
- `Edge2Edge.Ess`（`io.openems.edge.edge2edge`）
- `Edge2Edge.Meter`（`io.openems.edge.edge2edge`）
- `Edge2Edge.Websocket.Ess`（`io.openems.edge.edge2edge`）
- `Edge2Edge.Websocket.GenericReadComponent`（`io.openems.edge.edge2edge`）

### fenecon.dess（5）

- `Fenecon.Dess.Charger1`（`io.openems.edge.fenecon.dess`）
- `Fenecon.Dess.Charger2`（`io.openems.edge.fenecon.dess`）
- `Fenecon.Dess.Ess`（`io.openems.edge.fenecon.dess`）
- `Fenecon.Dess.GridMeter`（`io.openems.edge.fenecon.dess`）
- `Fenecon.Dess.PvMeter`（`io.openems.edge.fenecon.dess`）

### fronius（5）

- `Ess.Fronius.Gen24.Battery`（`io.openems.edge.fronius`）
- `Ess.Fronius.Gen24.DcCharger`（`io.openems.edge.fronius`）
- `Ess.Fronius.Gen24.Inverter`（`io.openems.edge.fronius`）
- `Meter.Fronius`（`io.openems.edge.fronius`）
- `PV-Inverter.Fronius`（`io.openems.edge.fronius`）

### kaco.blueplanet（5）

- `Kaco.BlueplanetHybrid10.Charger`（`io.openems.edge.kaco.blueplanet.hybrid10`）
- `Kaco.BlueplanetHybrid10.Core`（`io.openems.edge.kaco.blueplanet.hybrid10`）
- `Kaco.BlueplanetHybrid10.Ess`（`io.openems.edge.kaco.blueplanet.hybrid10`）
- `Kaco.BlueplanetHybrid10.GridMeter`（`io.openems.edge.kaco.blueplanet.hybrid10`）
- `Kaco.BlueplanetHybrid10.PvInverter`（`io.openems.edge.kaco.blueplanet.hybrid10`）

### system.fenecon（5）

- `Fenecon.MasterBox2V0.Meter`（`io.openems.edge.system.fenecon`）
- `IO.Fenecon.MasterBox2V0.AO`（`io.openems.edge.system.fenecon`）
- `IO.Fenecon.MasterBox2V0.Relay`（`io.openems.edge.system.fenecon`）
- `IOC.Fenecon.MasterBox2V0`（`io.openems.edge.system.fenecon`）
- `System.Fenecon.Home`（`io.openems.edge.system.fenecon`）

### bosch.bpts5hybrid（4）

- `Bosch.BPTS5Hybrid.Core`（`io.openems.edge.bosch.bpts5hybrid`）
- `Bosch.BPTS5Hybrid.Ess`（`io.openems.edge.bosch.bpts5hybrid`）
- `Bosch.BPTS5Hybrid.Meter`（`io.openems.edge.bosch.bpts5hybrid`）
- `Bosch.BPTS5Hybrid.Pv`（`io.openems.edge.bosch.bpts5hybrid`）

### controller.asymmetric（4）

- `Controller.Asymmetric.BalancingCosPhi`（`io.openems.edge.controller.asymmetric.balancingcosphi`）
- `Controller.Asymmetric.FixReactivePower`（`io.openems.edge.controller.asymmetric.fixreactivepower`）
- `Controller.Asymmetric.PeakShaving`（`io.openems.edge.controller.asymmetric.peakshaving`）
- `Controller.Asymmetric.PhaseRectification`（`io.openems.edge.controller.asymmetric.phaserectification`）

### phoenixcontact.plcnext（4）

- `PLCnext.ESS.Device`（`io.openems.edge.phoenixcontact.plcnext`）
- `PLCnext.LoadCircuit.Device`（`io.openems.edge.phoenixcontact.plcnext`）
- `PLCnext.Meter.Device`（`io.openems.edge.phoenixcontact.plcnext`）
- `PLCnext.PvInverter.Device`（`io.openems.edge.phoenixcontact.plcnext`）

### solaredge（4）

- `SolarEdge.ESS`（`io.openems.edge.solaredge`）
- `SolarEdge.ESS.Charger`（`io.openems.edge.solaredge`）
- `SolarEdge.Grid-Meter`（`io.openems.edge.solaredge`）
- `SolarEdge.PV-Inverter`（`io.openems.edge.solaredge`）

### sungrow（4）

- `Ess.Sungrow`（`io.openems.edge.sungrow`）
- `Ess.Sungrow.DcCharger`（`io.openems.edge.sungrow`）
- `Ess.Sungrow.Gridmeter`（`io.openems.edge.sungrow`）
- `PV-Inverter.Sungrow`（`io.openems.edge.sungrow`）

### timeofusetariff.manual（4）

- `Tariff.Manual.EEG2025.GridSell`（`io.openems.edge.timeofusetariff.manual`）
- `Tariff.Manual.Fixed.GridSell`（`io.openems.edge.timeofusetariff.manual`）
- `TimeOfUseTariff.OctopusGo`（`io.openems.edge.timeofusetariff.manual`）
- `TimeOfUseTariff.OctopusHeat`（`io.openems.edge.timeofusetariff.manual`）

### ess.fenecon（3）

- `Ess.Fenecon.Commercial40`（`io.openems.edge.ess.fenecon.commercial40`）
- `Ess.Fenecon.Commercial40.PV1`（`io.openems.edge.ess.fenecon.commercial40`）
- `Ess.Fenecon.Commercial40.PV2`（`io.openems.edge.ess.fenecon.commercial40`）

### ess.samsung（3）

- `Samsung.ESS`（`io.openems.edge.ess.samsung`）
- `Samsung.ESS.Charger`（`io.openems.edge.ess.samsung`）
- `Samsung.ESS.Grid-Meter`（`io.openems.edge.ess.samsung`）

### evcs.goe（3）

- `Evcs.Goe.ChargerHome`（`io.openems.edge.evcs.goe.chargerhome`）
- `Evcs.Goe.Http`（`io.openems.edge.evcs.goe`）
- `Evcs.Goe.Modbus`（`io.openems.edge.evcs.goe`）

### evcs.ocpp（3）

- `Evcs.Ocpp.Abl`（`io.openems.edge.evcs.ocpp.abl`）
- `Evcs.Ocpp.IesKeywattSingle`（`io.openems.edge.evcs.ocpp.ies.keywatt.singleccs`）
- `Evcs.Ocpp.Server`（`io.openems.edge.evcs.ocpp.server`）

### fenecon.mini（3）

- `Fenecon.Mini.Ess`（`io.openems.edge.fenecon.mini`）
- `Fenecon.Mini.GridMeter`（`io.openems.edge.fenecon.mini`）
- `Fenecon.Mini.PvMeter`（`io.openems.edge.fenecon.mini`）

### meter.siemens（3）

- `Meter.Siemens`（`io.openems.edge.meter.siemens`）
- `Meter.Siemens.PAC1600`（`io.openems.edge.meter.siemens`）
- `Meter.Siemens.SICAMT7KG966`（`io.openems.edge.meter.siemens`）

### battery.fenecon（2）

- `Battery.Fenecon.Commercial`（`io.openems.edge.battery.fenecon.commercial`）
- `Battery.Fenecon.Home`（`io.openems.edge.battery.fenecon.home`）

### batteryinverter.refu（2）

- `Battery-Inverter.Refu`（`io.openems.edge.batteryinverter.refu`）
- `Battery-Inverter.Refu.REFUstore88k`（`io.openems.edge.batteryinverter.refu`）

### bridge.modbus（2）

- `Bridge.Modbus.Serial`（`io.openems.edge.bridge.modbus`）
- `Bridge.Modbus.Tcp`（`io.openems.edge.bridge.modbus`）

### controller.evse（2）

- `Evse.Controller.Cluster`（`io.openems.edge.controller.evse`）
- `Evse.Controller.Single`（`io.openems.edge.controller.evse`）

### controller.pvinverter（2）

- `Controller.PvInverter.FixPowerLimit`（`io.openems.edge.controller.pvinverter.fixpowerlimit`）
- `Controller.PvInverter.SellToGridLimit`（`io.openems.edge.controller.pvinverter.selltogridlimit`）

### ess.generic（2）

- `Ess.Generic.ManagedSymmetric`（`io.openems.edge.ess.generic`）
- `Ess.Generic.OffGrid`（`io.openems.edge.ess.generic`）

### ess.saxpower（2）

- `Ess.SaxPower`（`io.openems.edge.ess.saxpower`）
- `Ess.SaxPower.Grid-Meter`（`io.openems.edge.ess.saxpower`）

### evcs.webasto（2）

- `Evcs.Webasto.Next`（`io.openems.edge.evcs.webasto.next`）
- `Evcs.Webasto.Unite`（`io.openems.edge.evcs.webasto.unite`）

### fenecon.pro（2）

- `Fenecon.Pro.Ess`（`io.openems.edge.fenecon.pro`）
- `Fenecon.Pro.PvMeter`（`io.openems.edge.fenecon.pro`）

### heat.mypv（2）

- `Heat.MyPv`（`io.openems.edge.heat.mypv`）
- `Heat.MyPv.AcThor9s`（`io.openems.edge.heat.mypv`）

### huawei（2）

- `PV-Inverter.Huawei`（`io.openems.edge.huawei`）
- `PV-Inverter.Huawei.SmartLogger`（`io.openems.edge.huawei`）

### io.kmtronic（2）

- `IO.KMtronic`（`io.openems.edge.io.kmtronic`）
- `IO.KMtronic.4Port`（`io.openems.edge.io.kmtronic`）

### meter.carlo（2）

- `Meter.CarloGavazzi.EM100`（`io.openems.edge.meter.carlo.gavazzi`）
- `Meter.CarloGavazzi.EM300`（`io.openems.edge.meter.carlo.gavazzi`）

### meter.chint（2）

- `Meter.Chint.DDSU666`（`io.openems.edge.meter.chint`）
- `Meter.Chint.DTSU666`（`io.openems.edge.meter.chint`）

### meter.eastron（2）

- `Meter.Eastron.SDM120`（`io.openems.edge.meter.eastron`）
- `Meter.Microcare.SDM630`（`io.openems.edge.meter.eastron`）

### meter.pqplus（2）

- `Meter.PqPlus.UMD96`（`io.openems.edge.meter.pqplus`）
- `Meter.PqPlus.UMD97`（`io.openems.edge.meter.pqplus`）

### meter.socomec（2）

- `Meter.Socomec.Singlephase`（`io.openems.edge.meter.socomec`）
- `Meter.Socomec.Threephase`（`io.openems.edge.meter.socomec`）

### meter.virtual（2）

- `Meter.Virtual.Add`（`io.openems.edge.meter.virtual`）
- `Meter.Virtual.Subtract`（`io.openems.edge.meter.virtual`）

### pvinverter.kostal（2）

- `PV-Inverter.Kostal`（`io.openems.edge.pvinverter.kostal`）
- `PV-Inverter.Kostal.Piko`（`io.openems.edge.pvinverter.kostal`）

### tesla.powerwall2（2）

- `Tesla.Powerwall2.Battery`（`io.openems.edge.tesla.powerwall2`）
- `Tesla.Powerwall2.Core`（`io.openems.edge.tesla.powerwall2`）

### timeofusetariff.entsoe（2）

- `Tariff.ENTSO-E.GridSell`（`io.openems.edge.timeofusetariff.entsoe`）
- `TimeOfUseTariff.ENTSO-E`（`io.openems.edge.timeofusetariff.entsoe`）

### battery.bmw（1）

- `Battery.BMW`（`io.openems.edge.battery.bmw`）

### battery.bydcommercial（1）

- `Byd.BatteryBox.Commercial.C130`（`io.openems.edge.battery.bydcommercial`）

### battery.pylontech（1）

- `Battery.Pylontech`（`io.openems.edge.battery.pylontech`）

### batteryinverter.kaco（1）

- `Battery-Inverter.Kaco.BlueplanetGridsave`（`io.openems.edge.batteryinverter.kaco.blueplanetgridsave`）

### batteryinverter.sinexcel（1）

- `Battery-Inverter.Sinexcel`（`io.openems.edge.batteryinverter.sinexcel`）

### braiinsos（1）

- `Controller.BraiinsOS.Single`（`io.openems.edge.braiinsos`）

### bridge.mbus（1）

- `Bridge.Mbus`（`io.openems.edge.bridge.mbus`）

### bridge.mqtt（1）

- `Bridge.Mqtt`（`io.openems.edge.bridge.mqtt`）

### bridge.onewire（1）

- `Bridge.Onewire`（`io.openems.edge.bridge.onewire`）

### controller.channelthreshold（1）

- `Controller.ChannelThreshold`（`io.openems.edge.controller.channelthreshold`）

### controller.chp（1）

- `Controller.CHP.SoC`（`io.openems.edge.controller.chp.soc`）

### controller.cleverpv（1）

- `Controller.Clever-PV`（`io.openems.edge.controller.cleverpv`）

### controller.debug（1）

- `Controller.Debug.DetailedLog`（`io.openems.edge.controller.debug.detailedlog`）

### controller.evcs（1）

- `Controller.Evcs.FixActivePower`（`io.openems.edge.controller.evcs.fixactivepower`）

### controller.generic（1）

- `Controller.Generic.JsonLogic`（`io.openems.edge.controller.generic.jsonlogic`）

### controller.highloadtimeslot（1）

- `Controller.HighLoadTimeslot`（`io.openems.edge.controller.highloadtimeslot`）

### ess.adstec（1）

- `Ess.Adstec.StoraXe`（`io.openems.edge.ess.adstec.storaxe`）

### ess.cluster（1）

- `Ess.Cluster`（`io.openems.edge.ess.cluster`）

### evcs.abl（1）

- `Evcs.Abl`（`io.openems.edge.evcs.abl`）

### evcs.cluster（1）

- `Evcs.Cluster.PeakShaving`（`io.openems.edge.evcs.cluster`）

### evcs.heidelberg（1）

- `Evcs.Heidelberg.Energy`（`io.openems.edge.evcs.heidelberg`）

### evcs.openwb（1）

- `Evcs.OpenWB`（`io.openems.edge.evcs.openwb`）

### evcs.spelsberg（1）

- `Evcs.Spelsberg.SMART`（`io.openems.edge.evcs.spelsberg`）

### evse.electricvehicle（1）

- `Evse.ElectricVehicle.Generic`（`io.openems.edge.evse.electricvehicle.generic`）

### heat.askoma（1）

- `Heat.Askoma`（`io.openems.edge.heat.askoma`）

### io.filipowski（1）

- `IO.Flipowski.MR-AO-1`（`io.openems.edge.io.filipowski`）

### io.gpio（1）

- `IO.Gpio`（`io.openems.edge.io.gpio`）

### io.offgridswitch（1）

- `Io.Off.Grid.Switch`（`io.openems.edge.io.offgridswitch`）

### io.revpi（1）

- `IO.RevolutionPi.DigitalIO`（`io.openems.edge.io.revpi`）

### io.siemenslogo（1）

- `IO.Siemens.LOGO`（`io.openems.edge.io.siemenslogo`）

### io.wago（1）

- `IO.WAGO`（`io.openems.edge.io.wago`）

### io.weidmueller（1）

- `IO.Weidmueller.UR20`（`io.openems.edge.io.weidmueller`）

### meter.abb（1）

- `Meter.ABB.B23`（`io.openems.edge.meter.abb`）

### meter.artemes（1）

- `Meter.Artemes.AM2`（`io.openems.edge.meter.artemes.am2`）

### meter.bcontrol（1）

- `Meter.BControl.EM300`（`io.openems.edge.meter.bcontrol.em300`）

### meter.bgetech（1）

- `Meter.BGE-TECH.DRT428M2`（`io.openems.edge.meter.bgetech`）

### meter.camillebauer（1）

- `Meter.Camillebauer.Aplus`（`io.openems.edge.meter.camillebauer.aplus`）

### meter.discovergy（1）

- `Meter.Discovergy`（`io.openems.edge.meter.discovergy`）

### meter.hager（1）

- `Meter.Hager.ECR380D`（`io.openems.edge.meter.hager`）

### meter.kdk（1）

- `Meter.KDK.2PUCT`（`io.openems.edge.meter.kdk`）

### meter.opendtu（1）

- `Meter.OpenDTU`（`io.openems.edge.meter.opendtu`）

### meter.phoenixcontact（1）

- `Meter.PhoenixContact`（`io.openems.edge.meter.phoenixcontact`）

### meter.plexlog（1）

- `Meter.Plexlog.Datalogger`（`io.openems.edge.meter.plexlog`）

### meter.schneider（1）

- `Meter.Schneider.Acti9.Smartlink`（`io.openems.edge.meter.schneider.acti9.smartlink`）

### meter.weidmueller（1）

- `Meter.Weidmueller.525`（`io.openems.edge.meter.weidmueller`）

### meter.ziehl（1）

- `Meter.Ziehl.EFR4001IP`（`io.openems.edge.meter.ziehl`）

### onewire.thermometer（1）

- `OneWire.Thermometer`（`io.openems.edge.onewire.thermometer`）

### predictor.lstm（1）

- `Predictor.LSTM`（`io.openems.edge.predictor.lstm`）

### predictor.persistencemodel（1）

- `Predictor.PersistenceModel`（`io.openems.edge.predictor.persistencemodel`）

### predictor.production（1）

- `Predictor.Production.LinearModel`（`io.openems.edge.predictor.production.linearmodel`）

### predictor.profileclusteringmodel（1）

- `Predictor.ProfileClusteringModel`（`io.openems.edge.predictor.profileclusteringmodel`）

### predictor.similardaymodel（1）

- `Predictor.SimilardayModel`（`io.openems.edge.predictor.similardaymodel`）

### protectionrelay.telehaase（1）

- `ProtectionRelay.Tele.Na003M64`（`io.openems.edge.protectionrelay.telehaase`）

### pvinverter.cluster（1）

- `PvInverter.Cluster`（`io.openems.edge.pvinverter.cluster`）

### pvinverter.kaco（1）

- `PV-Inverter.KACO.blueplanet`（`io.openems.edge.pvinverter.kaco.blueplanet`）

### pvinverter.solarlog（1）

- `PV-Inverter.Solarlog`（`io.openems.edge.pvinverter.solarlog`）

### scheduler.daily（1）

- `Scheduler.Daily`（`io.openems.edge.scheduler.daily`）

### scheduler.fixedorder（1）

- `Scheduler.FixedOrder`（`io.openems.edge.scheduler.fixedorder`）

### scheduler.jscalendar（1）

- `Scheduler.JSCalendar`（`io.openems.edge.scheduler.jscalendar`）

### timeofusetariff.ancillarycosts（1）

- `TimeOfUseTariff.AncillaryCosts`（`io.openems.edge.timeofusetariff.ancillarycosts`）

### timeofusetariff.awattar（1）

- `TimeOfUseTariff.Awattar`（`io.openems.edge.timeofusetariff.awattar`）

### timeofusetariff.corrently（1）

- `TimeOfUseTariff.Corrently`（`io.openems.edge.timeofusetariff.corrently`）

### timeofusetariff.ews（1）

- `TimeOfUseTariff.Ews`（`io.openems.edge.timeofusetariff.ews`）

### timeofusetariff.groupe（1）

- `TimeOfUseTariff.GroupeE`（`io.openems.edge.timeofusetariff.groupe`）

### timeofusetariff.hassfurt（1）

- `TimeOfUseTariff.Hassfurt`（`io.openems.edge.timeofusetariff.hassfurt`）

### timeofusetariff.luox（1）

- `TimeOfUseTariff.LUOX.Energy`（`io.openems.edge.timeofusetariff.luox`）

### timeofusetariff.rabotcharge（1）

- `TimeOfUseTariff.RabotCharge`（`io.openems.edge.timeofusetariff.rabotcharge`）

### timeofusetariff.swisspower（1）

- `TimeOfUseTariff.Swisspower`（`io.openems.edge.timeofusetariff.swisspower`）

### timeofusetariff.tibber（1）

- `TimeOfUseTariff.Tibber`（`io.openems.edge.timeofusetariff.tibber`）

### weather.openmeteo（1）

- `Weather.OpenMeteo`（`io.openems.edge.weather.openmeteo`）
