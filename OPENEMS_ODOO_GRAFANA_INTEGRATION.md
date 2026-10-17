# 本机 OpenEMS、Odoo、Grafana 集成关系

采集时间：2026-10-16。依据本机正在运行的进程、Felix 配置、Odoo 数据库和 Grafana 供应配置，不复述安装步骤。口令、API Token 和设备 apikey 只标明所在配置文件，不写入本文。

## 结论

三套系统没有互相调用对方的业务 API。分工是：

- **Odoo 18** 保存设备、用户、角色和告警等元数据。OpenEMS Backend 既用 HTTP JSON-RPC 调 Odoo 模块，也直连同一套 PostgreSQL。
- **OpenEMS** 负责边缘仿真、云端接入和时序写入。Edge 经 WebSocket 连上 Backend，Backend 把通道数据写入 InfluxDB。
- **Grafana 13.2.3** 只读 InfluxDB。它不访问 Odoo，也不访问 OpenEMS WebSocket。大屏上的站点标识来自 Influx 的 `edge` 标签。

当前在线链路已经打通：Odoo 设备 `edge0` 的 `openems_is_connected` 为真，汇总状态为 `ok`，版本 `2026.10.0`，`lastmessage` 在采集时仍在刷新。Influx 桶 `openems` 里最近的 `_sum/EssSoc` 点也在写入。

## 运行实例

| 组件 | 版本 / 产物 | systemd | 监听 |
| --- | --- | --- | --- |
| OpenEMS Edge | `/opt/openems/openems-edge.jar` | `openems-edge.service` | Edge WebSocket `8075`，Modbus/TCP `502`，Felix 控制台 `8080` |
| OpenEMS Backend | `/opt/openems/openems-backend.jar` | `openems-backend.service` | UI WebSocket `8082`，Edge 管理 `8085`，Felix 控制台 `8079` |
| Backend Edge 代理 | `/opt/openems/openems-backend-edge.jar` | `openems-backend-edge.service` | `8084`，上游 `ws://127.0.0.1:8085` |
| Odoo | 18.0，模块 `openems` 已安装 | `odoo.service` | `8069` |
| PostgreSQL | 18 | `postgresql@18-main.service` | `5432`，库名 `odoo` |
| InfluxDB | 2.9.1 | `influxdb.service` | `8086`，组织 `openems`，桶 `openems` |
| Grafana | 13.2.3 | `grafana-server.service` | `3000` |
| Nginx | 站点 `/etc/nginx/sites-enabled/openems` | — | Edge UI `80`/`4200`，Backend UI `8081` |

配置目录：

- Edge：`/etc/openems.d`
- Backend：`/etc/openems-backend.d`
- Edge 代理：`/etc/openems-backend-edge.d`
- Odoo：`/etc/odoo/odoo.conf`，插件路径含 `/opt/odoo/odoo-openems`
- Grafana：`/etc/grafana/provisioning`

工作区副本 `odoo-addon-openems/openems/controllers/openems_backend.py` 与正在加载的 `/opt/odoo/odoo-openems/openems/controllers/openems_backend.py` 内容一致。Odoo `addons_path` 使用的是 `/opt/odoo/odoo-openems`。

## 数据怎么走

```text
仿真 Edge（ess0 / meter0 / meter1 / evcs0）
        │  Controller.Api.Backend
        │  ws://127.0.0.1:8084   apikey 配在 Edge 的 ctrlBackend0
        ▼
openems-backend-edge :8084
        │  ws://127.0.0.1:8085
        ▼
openems-backend
        ├─ Metadata.Odoo
        │     HTTP 127.0.0.1:8069     登录、设备列表、角色、邮件
        │     PostgreSQL 127.0.0.1:5432 / db odoo
        │         读设备、回写连接状态、配置更新、告警相关表
        ├─ Timedata.InfluxDB（可写）
        │     http://127.0.0.1:8086
        │     org openems / bucket openems / measurement data
        └─ Ui.Websocket :8082
              Nginx :8081  /openems-backend  反代到这里

Edge 自己的 Timedata.InfluxDB（influx0）是只读，指向同一个桶，给本机 UI 查历史。
Grafana 数据源 InfluxDB-OpenEMS 也只读同一个桶。
```

Edge 本机组件（Felix）：

- `Simulator.EssSymmetric.Reacting.ess0`：500 kW / 1000 kWh，别名「500kW/1000kWh C&I Battery ESS」
- `Simulator.GridMeter.Acting.meter0`、`Simulator.PvInverter.meter1`、`Simulator.Evcs.evcs0`
- `Controller.Symmetric.Balancing.ctrlBalancing0` 做自发自用平衡
- `Timedata.Rrd4j` 仍启用，承担 Edge 本地短周期缓存；跨进程历史以 Influx 为准

Nginx 把两套静态 UI 和 WebSocket 分开：

- `80` / `4200`：`/opt/openems/ui`，`/openems-edge` 反代到 Edge `8075`
- `8081`：`/opt/openems/backend-ui`，`/openems-backend` 反代到 Backend `8082`

## Odoo 与 OpenEMS

Backend 组件 `Metadata.Odoo`（`/etc/openems-backend.d/Metadata/Odoo.config`）同时配置了两路：

1. **Odoo HTTP**：协议 HTTP，主机 `127.0.0.1`，端口 `8069`，登录用户 `admin`，`odooUid=2`，并打开密码认证。源码在 `/opt/openems/source/io.openems.backend.metadata.odoo`。`OdooHandler` / `HttpBridgeOdooService` 以 Odoo JSON-RPC 调用本机模块路由。
2. **PostgreSQL**：同一台 `127.0.0.1:5432`，库、用户与 `/etc/odoo/odoo.conf` 相同。`PgEdgeHandler`、`InitializeEdgesWorker` 直接 `SELECT` / `UPDATE` `openems_device`，并 `INSERT` `openems_openemsconfigupdate`。启动时会把设备连接标志清掉，再按实际上线状态写回。

JSON-RPC 路径与模块控制器对应关系：

| Backend 调用 | Odoo 路由 | 作用 |
| --- | --- | --- |
| 用户信息 | `/openems_backend/info` | 登录名、全局角色、语言、是否多 Edge |
| 设备列表 | `/openems_backend/get_edges` | 按权限分页列出设备 |
| 单台权限 | `/openems_backend/get_edge_with_role` | 返回该用户在这台设备上的角色 |
| 设备设置 | `/openems_backend/set_edge_settings` | 写设备 settings |
| 用户设置 | `/openems_backend/set_user_settings` | 写用户 settings |
| 注册邮件 | `/openems_backend/sendRegistrationEmail` | |
| 调试协议 | `/openems_backend/sendSetupProtocolEmail`、`/openems_backend/get_latest_setup_protocol` | |
| 告警邮件 | `/openems_backend/mail/alerting_sum_state`、`/openems_backend/mail/alerting_offline` | |

这些路由实现在已安装模块 `openems`（清单版本 `18.0.1.0.1`）中。模块依赖 `base`、`web`、`mail`、`crm`、`resource`、`stock`、`web_m2x_options`、`partner_firstname`、`auth_oauth`，上述依赖在库里均为 `installed`。

Backend 直连的表由模型名把点换成下划线得到，本库实际存在：

- `openems_device`
- `openems_device_user_role`
- `openems_openemsconfigupdate`
- `openems_alerting`
- `openems_setup_protocol`、`openems_setup_protocol_item`、`openems_setup_protocol_production_lot`
- `openems_systemmessage`
- `openems_device_tag`、`openems_device_openems_device_tag_rel`

另外还会读 `res_users`、`res_partner`、`stock_lot`。

采集时库内只有一台设备：

| id | name | producttype | comment | 连接 | 状态 | 版本 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | edge0 | openems-edge | 500kW/1000kWh 园区储能微电网 | 已连接 | ok | 2026.10.0 |

`openems_device_user_role` 中，用户 `admin`（`res_users.id=2`）对该设备角色为 `admin`。`res_users.global_role` 仍是 `guest`；模块在用户属于 OpenEMS Manager 组时会把接口返回的全局角色提升为 `admin`。设备 apikey 存在 `openems_device.apikey`。Edge 侧 `Controller.Api.Backend.ctrlBackend0` 的 `apikey` 必须与这张表一致，Backend 才能把这条 WebSocket 认成 `edge0`。

## Grafana 与 Influx

Grafana 不配置 Odoo 数据源。供应文件：

- `/etc/grafana/provisioning/datasources/openems-influxdb.yaml`
- `/etc/grafana/provisioning/dashboards/openems.yaml`

数据源名称 `InfluxDB-OpenEMS`，类型 InfluxDB，Flux，`uid` 为 `P0DBC1A8D6496B50C`，地址 `http://127.0.0.1:8086`，组织 `openems`，默认桶 `openems`，并设为默认数据源。Token 写在该 YAML 的 `secureJsonData`，与 Backend、Edge 的 Influx 组件使用同一枚 Token。

仪表盘由文件供应，目录 `/var/lib/grafana/dashboards`，Grafana 文件夹名 `OpenEMS`，10 秒扫描一次。当前文件 `openems_ess_dashboard.json`：

- 标题：OpenEMS 智慧微电网与储能电站智能运维调度中心
- uid：`openems-ess-analytics`
- 31 个面板，数据源 uid 与上面的 Influx 数据源一致
- 查询形态：`from(bucket: "openems")`，`r._measurement == "data"`，`r.edge == "${edge}"`
- 变量 `edge` 用 `schema.tagValues`，采集时当前值为 `0`

面板覆盖系统状态、SOC、并网模式、电网 / 储能 / 光伏 / 负荷 / 充电桩功率、功率平衡、三相功率、累计电量，以及 Backend 侧的均衡设定值、UI WebSocket 连接数、Edge WebSocket 连接数、JSON-RPC 完成数。后一类字段来自 Backend 写入的通道，不是 Odoo 表。

`/etc/grafana/grafana.ini` 的 `[auth.anonymous]` 中 `enabled = true`，`org_role = Editor`。未登录访问 `http://127.0.0.1:3000/api/datasources` 能看到该数据源。匿名用户因此可以打开这块大屏，并通过 Grafana 代理查询 Influx。

## 标识不一致

三处「站点是谁」并不使用同一个字符串：

| 位置 | 当前值 | 含义 |
| --- | --- | --- |
| Odoo `openems_device.name` | `edge0` | Backend 认设备、权限和 UI 设备列表 |
| Edge `ctrlBackend0.apikey` | 配置里的 apikey 字符串 | 上线认证，应对齐 `openems_device.apikey` |
| Influx 标签 `edge` | `0` | Backend 写入时序时打的标签 |
| Grafana 变量 `edge` | 默认 `0` | 只按 Influx 标签过滤 |

所以 Odoo 里看到的电站名是 `edge0`，Grafana 大屏过滤的是 `edge=0`。最近 6 小时按 `edge=="edge0"` 计数没有点；按标签 `0` 能读到 `_sum/EssSoc`。大屏能出数，是因为它的变量对齐了 Influx，而不是对齐了 Odoo 设备名。若以后按 Odoo 的 `edge0` 去查 Grafana，曲线会是空的。

Edge 的 Influx 组件 `isReadOnly=true`，Backend 的为 `false`。时序只有 Backend 在写。Edge UI 查历史和 Grafana 查历史读的是同一桶。

## 三者边界

- Odoo 不知道 Grafana，Grafana 不知道 Odoo。没有从 Odoo 菜单跳到 Grafana，也没有用 Odoo 用户做 Grafana 登录。
- 权限在 Odoo：`openems_device_user_role` 和 OpenEMS 用户组决定谁能在 Backend UI 看到 `edge0`。Grafana 匿名 Editor 不走这套权限。
- 实时控制走 Edge WebSocket 和 Backend WebSocket。Grafana 只展示 Influx 里已经落下的点。
- 告警邮件由 Backend 调 Odoo 的 `/openems_backend/mail/...`，不经过 Grafana Alerting。Grafana 供应目录里的 `alerting/sample.yaml` 不是这条业务链。
