# OpenEMS 对外通信与 Odoo 通信接口

本文记录本机（`172.16.100.234`）当前运行的 OpenEMS Backend 云端对外接口，以及 Backend 与 Odoo 的通信接口。协议和路由以正在运行的进程、`/etc/openems-backend.d` 和 `openems-backend.jar` 中的 `Metadata.Odoo` 为准。

Edge 不连接 Odoo。浏览器和现场 Edge 都只连 OpenEMS Backend。用户、权限、设备目录由 Backend 的 `Metadata.Odoo` 再去访问 Odoo。功率、SOC 等历史不进 Odoo，由 Backend 写入 InfluxDB。

## 1. 对外入口

Backend 对外业务接口是 WebSocket 上的 JSON-RPC 2.0，没有单独的对外 REST API。

| 调用方 | 地址 | 实际服务 |
| --- | --- | --- |
| 浏览器、云端 UI | `http://172.16.100.234:8081` | Nginx 提供 `/opt/openems/backend-ui` |
| 同上 | `ws://172.16.100.234:8081/openems-backend` | Nginx 反代到 `127.0.0.1:8082` |
| 程序直连 | `ws://172.16.100.234:8082` | `Ui.Websocket`，与上一行是同一套 JSON-RPC |
| 现场 Edge | `ws://172.16.100.234:8084` | `openems-backend-edge`，组件 `edges0`，再连 `ws://127.0.0.1:8085` |
| Edge.Manager | `*:8085` | Backend 接收 Edge 长连接。正常路径是先到 `8084` |

`8082`、`8084`、`8085` 监听所有网卡。页面应走 `8081` 的 `/openems-backend`，这样 WebSocket 和页面在同一端口。

Edge 连上 `8084` 后，代理把连接转到 `8085`。`Edge.Manager` 的握手要求带 `id`，本机代理使用 `edges0`。设备身份由 Edge 配置 `Controller.Api.Backend` 的 `apikey` 决定，Backend 用它在 Odoo 库的 `openems_device` 里认出设备。本机 `edge0` 的 apikey 与设备名相同。

本机已启用的 Backend 组件是 `Ui.Websocket`、`Edge.Manager`、`Metadata.Odoo`、`Timedata.InfluxDB`（`timedata0`）。下列能力在 JAR 里，但没有配置，因此不是当前对外接口：

- `Backend2Backend.Rest`、`Backend2Backend.Websocket`
- `Authentication.OAuth`、`OAuthRegistry.Client`
- `Alerting`、`Metrics.Prometheus`

`8079` 是 Backend 的 Felix Web Console，不是业务 API。Odoo `8069` 和 Influx `8086` 由 Backend 自己访问，见第 3、4 节。

## 2. UI WebSocket JSON-RPC

连接 `ws://172.16.100.234:8082` 或 `ws://172.16.100.234:8081/openems-backend`。报文是 JSON-RPC 2.0。登录后的请求受每用户速率限制（配置 `requestLimit=20`）。

### 2.1 登录前

| 方法 | 作用 |
| --- | --- |
| `authenticateWithPassword` | 用户名和密码登录，返回 token |
| `authenticateWithToken` | 用已有 token 恢复会话 |
| `authenticateWithOAuth` | OAuth 登录。本机未配置 OAuth 组件 |
| `registerUser` | 注册用户，由 Odoo 落库 |
| `logout` | 结束会话 |

### 2.2 登录后，Backend 自己处理

这些方法不转发到 Edge。设备目录和用户资料来自 `Metadata.Odoo`。

| 方法 | 作用 |
| --- | --- |
| `getEdges` | 分页列出当前用户可见的 Edge |
| `getEdge` | 单台 Edge 的在线状态、版本、角色、系统状态 |
| `subscribeEdges` | 订阅多台 Edge 的状态变化 |
| `addEdgeToUser` | 用安装密码把 Edge 绑到用户 |
| `getEmsType` | 读取设备的 EMS 类型 |
| `updateEdgeSettings` | 写设备设置，要求 Owner |
| `getUserInformation` | 当前用户资料 |
| `setUserInformation` | 修改用户资料 |
| `updateUserSettings` | 修改用户设置 |
| `updateUserLanguage` | 修改界面语言 |
| `getSetupProtocol` | 取安装协议文件 |
| `submitSetupProtocol` | 提交安装协议 |
| `getSetupProtocolData` | 取安装协议数据 |
| `getLatestSetupProtocolCoreInfo` | 最新一份安装协议摘要 |
| `getProtocolsCoreInfo` | 安装协议列表，要求 Owner |
| `getUserAlertingConfigs` | 读取告警邮件配置 |
| `setUserAlertingConfigs` | 写入告警邮件配置 |

`getEdges`、`getEdge`、`getUserInformation` 会调用 Odoo HTTP。在线标志和系统状态的回写走 PostgreSQL，见第 3.2 节。

### 2.3 针对一台 Edge：`edgeRpc`

外层方法是 `edgeRpc`，参数里带 `edgeId` 和内层 JSON-RPC。调用前 Backend 检查该用户在这台设备上的角色，至少为 Guest。

Backend 自己用 Influx 回答历史查询，不把这些请求转到 Edge：

| 内层方法 | 作用 |
| --- | --- |
| `queryHistoricTimeseriesData` | 按时间范围和分辨率取通道曲线 |
| `queryHistoricTimeseriesEnergy` | 用区间首尾累计值相减，得到该段电量 |
| `queryHistoricTimeseriesEnergyPerPeriod` | 按周期切分的电量 |
| `queryHistoricTimeseriesExportXlxs` | 导出历史数据 |

Influx 里的 edge 标签是数字。`edge0` 对应标签 `"0"`，measurement 为 `data`，bucket 为 `openems`。所选日期按请求里的 `timezone` 从当地 0 点算起。某个电量通道在该窗口内没有点时，`queryHistoricTimeseriesEnergy` 返回错误 `Energy values are not available`，UI 显示为 “Error while fetching data. Please try again later.”。

下面这些内层方法由 Backend 转到当前在线的 Edge：

| 内层方法 | 作用 |
| --- | --- |
| `subscribeChannels` | 订阅实时通道 |
| `subscribeSystemLog` | 订阅 Edge 系统日志 |
| `getEdgeConfig` | 读取 Edge 组件配置 |
| `createComponentConfig` | 创建组件 |
| `updateComponentConfig` | 修改组件 |
| `deleteComponentConfig` | 删除组件 |
| `setChannelValue` | 写通道值 |
| `componentJsonApi` | 组件自己的 JSON API |
| `appCenter` | 应用中心，内部再转 Odoo 的 `/openems_app_center/*` |

`simulation` 在 `edgeRpc` 分发里有入口。本机没有启用仿真服务。

## 3. Backend 与 Odoo

组件配置在 `/etc/openems-backend.d/Metadata/Odoo.config`。`Metadata.Dummy` 和 `Metadata.File` 已暂停，避免多套元数据同时绑定。

```text
浏览器或 Edge
    │  WebSocket JSON-RPC（第 2 节、第 1 节的 8084）
    ▼
openems-backend  Metadata.Odoo
    ├─ HTTP JSON-RPC   127.0.0.1:8069
    └─ PostgreSQL      127.0.0.1:5432  数据库 odoo
```

### 3.1 HTTP JSON-RPC

`OdooHandler` 使用配置中的 Odoo 地址、协议、登录用户和 `odooUid`。请求打到 Odoo 模块 `openems` 的 `type="json"` 路由，由 `openems/controllers/openems_backend.py` 实现。这不是 Edge 使用的 WebSocket JSON-RPC。

| Backend 动作 | Odoo 路由 |
| --- | --- |
| 登录会话与用户信息 | `/openems_backend/info` |
| 设备列表 | `/openems_backend/get_edges` |
| 用户在单台设备上的角色 | `/openems_backend/get_edge_with_role` |
| 修改设备设置 | `/openems_backend/set_edge_settings` |
| 修改用户设置 | `/openems_backend/set_user_settings` |
| 注册邮件 | `/openems_backend/sendRegistrationEmail` |
| 安装协议邮件与最新协议 | `/openems_backend/sendSetupProtocolEmail`、`/openems_backend/get_latest_setup_protocol` |
| 告警邮件 | `/openems_backend/mail/<template>` |
| App Center 密钥与安装记录 | `/openems_app_center/is_key_applicable`、`get_possible_apps`、`get_installed_apps`、`get_registered_key`、`add_install_app_instance_history`、`add_deinstall_app_instance_history`、`add_register_key_history`、`add_deregister_key_history` |

用户查找在本机模块里同时接受 Odoo session、当前请求 UID、OAuth UID、登录名和数字 UID。

### 3.2 PostgreSQL

`PostgresHandler` 使用 HikariCP 直连同一台 PostgreSQL，不经过 Odoo HTTP。连接池大小来自配置 `pgConnectionPoolSize`。

| 动作 | 实现 | 作用 |
| --- | --- | --- |
| 启动加载设备 | `InitializeEdgesWorker` | 把 `openems_device` 读入 `EdgeCache` |
| Edge 接入认设备 | `PgEdgeHandler.getEdgeForApikey` | 用 apikey 找到 `edge0` 这类设备 |
| 周期回写 | `PeriodicWriteWorker` | 把是否在线、系统状态、最后通信时间写回 `openems_device` |

Backend 还会读或写这些表：`openems_device_user_role`、`openems_openemsconfigupdate`、`openems_alerting`、`openems_setup_protocol` 及其明细、`openems_systemmessage`、设备标签关系，以及 `res_users`、`res_partner`、`stock_lot`。

本机库里的设备记录是 `edge0`，产品类型 `openems-edge`。Edge 侧 `ctrlBackend0` 的 apikey 必须和 `openems_device.apikey` 一致，否则 `8084` 上的连接无法记到这台设备。

## 4. 不经过 Odoo 的数据面

| 数据 | 路径 |
| --- | --- |
| 实时通道 | UI `edgeRpc` / `subscribeChannels` → 在线 Edge |
| 历史曲线和电量 | UI `edgeRpc` / `queryHistoricTimeseries*` → `Timedata.InfluxDB` → `http://127.0.0.1:8086` |
| 设备目录、角色、在线状态 | `Metadata.Odoo` → Odoo HTTP 或 PostgreSQL |

Influx 的 org、bucket 都是 `openems`，measurement 是 `data`。Grafana 只读这个 bucket，不访问 Odoo。
