# OpenEMS Backend RBAC 权限架构与数据流深度剖析

本文档系统性剖析 OpenEMS 云端微电网操作系统中 **基于角色的访问控制体系（Role-Based Access Control, RBAC）**。内容涵盖核心权限模型、四级角色层级、Odoo 多租户持久化与行级安全规则、云端内存缓存、云端网关多层拦截机制、边缘端权限传递穿透（`AuthenticatedRpc`）以及典型业务场景的端到端数据流。

---

## 一、 系统总体 RBAC 架构设计

OpenEMS 的权限体系采用了 **“云端多租户集中裁决 + 边缘端本地终审”** 的分层协同设计。整个 RBAC 架构由三层核心构成：

1. **持久化与多租户权限源（Odoo ERP / PostgreSQL）**：统一维护用户账号、全局用户组（Manager、Reader、Portal/User）以及设备级角色授权关系表（`openems.device_user_role`），配合 Odoo 行级安全规则（`ir.rule`）提供天然的数据租户隔离。
2. **云端高性能接入与鉴权拦截层（OSGi Backend Core）**：`UiWebsocket` 与 `B2bWebsocket/Rest` 在长连接网关层识别用户身份并挂载会话；`MetadataOdoo` 维护 `userRoles` 双层高效哈希缓存字典；`EdgeRpcRequestHandler` 在云端对所有设备请求执行第一道权限守卫（`assertRoleIsAtLeast`）。
3. **边缘穿透与端侧本地守卫（Edge Core）**：对于需要写设备配置、切换运行策略或执行系统调度的控制指令，云端将用户身份与该设备上的计算角色打包为 `AuthenticatedRpcRequest` 下发至 Edge 端，Edge 端根据各模块端点的 `JsonrpcRoleEndpointGuard` 进行最终权限断言。

```mermaid
flowchart TD
    subgraph ClientLayer["客户端接入层"]
        UI["OpenEMS Web UI / Mobile App"]
        B2B["第三方系统 / B2B API Client"]
    end

    subgraph BackendGateway["云端接入网关层"]
        UWS["UiWebsocket 8082 网关 (WsData 会话挂载)"]
        B2B_WS["B2bWebsocket 8076 / REST 8075"]
        AUTH_SVC["Password / Token / OAuth2 鉴权服务"]
    end

    subgraph BackendCore["云端核心调度与缓存层"]
        CORE_REQ["CoreJsonRpcRequestHandler"]
        EDGE_RPC["EdgeRpcRequestHandler (权限第一防线)"]
        META["MetadataOdoo (元数据管理器)"]
        ROLE_CACHE["userRoles 双层内存缓存 (userId -> edgeId -> Role)"]
    end

    subgraph PersistenceLayer["持久化与业务层 (Odoo ERP)"]
        ODOO_CTRL["openems_backend.py 控制器"]
        RECORD_RULE["ir.rule 租户数据隔离规则"]
        TABLE_ROLE["openems_device_user_role 细粒度角色表"]
        TABLE_USER["res_users 用户与全局组表"]
    end

    subgraph EdgeLayer["边缘端现场执行层 (OpenEMS Edge)"]
        EDGE_EWS["EdgeWebsocket 8085 长连接"]
        EDGE_AUTH["AuthenticatedRequestHandler 解包"]
        EDGE_GUARD["JsonrpcRoleEndpointGuard (端侧最终守卫)"]
        COMP_MGR["ComponentManager / AppManager 执行引擎"]
    end

    UI -->|WebSocket 握手与鉴权| UWS
    B2B -->|Basic / Bearer Auth| B2B_WS
    UWS -->|委托认证| AUTH_SVC
    AUTH_SVC -->|查询用户与全局组| ODOO_CTRL
    ODOO_CTRL -->|读写| TABLE_USER

    UWS -->|已认证请求分发| CORE_REQ
    B2B_WS -->|已认证请求分发| CORE_REQ
    CORE_REQ -->|设备级请求路由| EDGE_RPC
    EDGE_RPC -->|assertRoleIsAtLeast 校验| META
    META -->|查询角色缓存| ROLE_CACHE
    ROLE_CACHE -.->|未命中时 RPC 穿透查询| ODOO_CTRL
    ODOO_CTRL -->|租户规则过滤| RECORD_RULE
    RECORD_RULE -->|关联检索| TABLE_ROLE

    EDGE_RPC -->|包装 AuthenticatedRpcRequest| EDGE_EWS
    EDGE_EWS -->|长连接下发| EDGE_AUTH
    EDGE_AUTH -->|上下文注入 User & Role| EDGE_GUARD
    EDGE_GUARD -->|验权通过执行| COMP_MGR
```

---

## 二、 核心权限模型与实体映射

### 1. 四级角色权限等级体系 (`io.openems.common.session.Role`)
OpenEMS 定义了严格的整型权重角色枚举，数值越小，特权级别越高：

```java
public enum Role {
    ADMIN(0),     // 系统管理员：完全控制权限（系统命令、固件升级、删除组件、全局配置）
    INSTALLER(1), // 安装调试工程师：工程交付权限（创建组件、修改高级电气参数、现场调试）
    OWNER(2),     // 电站业主/终端用户：运维管理权限（安装/更新/删除 App 实例、日常策略配置）
    GUEST(3);     // 访客/普通租户：只读权限（监控看板、实时状态订阅、历史时序查询导出）
}
```

- **权限比较逻辑**：
  - `role.isAtLeast(requiredRole)`: 当且仅当 `this.level <= requiredRole.level` 时为 `true`。
  - `role.assertIsAtLeast(resource, requiredRole)`: 若权限不足直接抛出 `OpenemsError.COMMON_ROLE_ACCESS_DENIED`。
  - 若用户未被授权该电站，角色计算为 `null`，抛出 `OpenemsError.COMMON_ROLE_UNDEFINED`。

### 2. 用户模型与抽象定义 (`AbstractUser` 与 `User`)
- `io.openems.common.session.AbstractUser`：定义用户基础属性（`id`, `userId`, `email`, `name`, `language`, `globalRole`, `settings`）。
- `io.openems.backend.common.metadata.User`：云端用户模型，附加 `token` 与 `hasMultipleEdges` 字段。
- `io.openems.edge.common.user.User`：边缘端用户模型，在 Edge 收到下发的 RPC 时从 JSON 参数就地还原。

### 3. 多租户数据库实体映射 (Odoo ERP / PostgreSQL)

| 模型/表名 | 核心字段 | 角色机制与职责说明 |
| :--- | :--- | :--- |
| **`res.users`** | `id`, `login`, `name`, `groups_id`, `global_role`, `settings` | 统一账号主体。关联的全局用户组决定初始身份：属于 `group_openems_manager` 则拥有跨所有电站的全局 `admin`；属于 `group_openems_reader` 则拥有跨所有电站的全局 `guest`。 |
| **`openems.device`** | `id`, `name` (Edge-ID), `apikey`, `user_role_ids`, `openems_is_connected` | 储能电站台账主表。通过 `user_role_ids` 反向关联该电站的所有授权用户。 |
| **`openems.device_user_role`** | `user_id`, `device_id`, `role` (`admin`, `installer`, `owner`, `guest`) | **细粒度电站-用户权限绑定表**。明确指定某一具体用户对特定具体电站所具备的独立角色。 |
| **`ir.rule`** (记录级隔离) | `domain_force` 过滤规则 | **多租户数据隔离防线**：<br>`['\|', ('user_role_ids.user_id', 'in', [user.id]), ('alerting_settings.user_id', 'in', [user.id])]` 保证普通 Portal 租户在 SQL 层面只能检索到属于自己的设备。 |

---

## 三、 云端与边缘端两级鉴权机制

### 1. 云端元数据权限缓存与双层映射 (`MetadataOdoo.java`)
为了支撑上万台设备与海量并发 UI 请求，云端绝不在每个请求中频繁远程调用 Odoo。`MetadataOdoo` 维护了高效的双层并发哈希映射表：

```java
// 映射结构: Map<userId, Map<edgeId, Role>>
private final Map<String, Map<String, Role>> userRoles = new ConcurrentHashMap<>();
```

- **缓存预热与懒加载**：
  - 用户登录拉取电站列表（`GetEdgesRequest`）时，批量预热该用户所有的 `edgeId -> Role` 映射；
  - 针对单个电站发起未预热的请求时，触发懒加载：`this.odooHandler.getEdgeWithRole(user, edgeId)` 向 Odoo 远程请求计算角色并写回缓存。

### 2. 边缘端权限守卫机制 (`JsonrpcRoleEndpointGuard` 与 `EdgeGuards`)
在 OpenEMS Edge 侧，OSGi 各服务组件在注册 JSON-RPC 路由时，使用声明式 Guard 守卫端点：

- **通用角色守卫**：
  ```java
  builder.handleRequest(new UpdateComponentConfig(),
      endpoint -> endpoint.setGuards(EdgeGuards.roleIsAtleast(Role.OWNER)),
      call -> { ... });
  ```
- **云端/本地环境差异化守卫**（安全加固设计）：
  ```java
  // 创建/删除组件：如果是从云端经鉴权通道下发，INSTALLER 即可执行；如果是本地局域网未经云端校验，则必须是本地 ADMIN
  builder.handleRequest(new CreateComponentConfig(),
      endpoint -> endpoint.setGuards(
          EdgeGuards.roleIsAtleastFromBackend(Role.INSTALLER),
          EdgeGuards.roleIsAtleastNotFromBackend(Role.ADMIN)
      ),
      call -> { ... });
  ```

---

## 四、 五大核心 RBAC 业务数据流剖析

### 1. 数据流一：用户登录认证与 RBAC 初始角色拉取流
展示用户通过前端输入账密或第三方 OAuth2 登录，云端向 Odoo 验证并建立带全局角色的 Session。

```mermaid
sequenceDiagram
    autonumber
    participant UI as OpenEMS Web UI
    participant UWS as UiWebsocket (OnRequest)
    participant AUTH as AuthPasswordService
    participant ODOO as Odoo ERP (/openems_backend)
    participant PG as PostgreSQL (odoo)

    UI->>UWS: AuthenticateWithPasswordRequest (login, password)
    UWS->>AUTH: authenticateWithPassword(login, password)
    AUTH->>ODOO: POST /web/session/authenticate
    ODOO->>PG: SELECT * FROM res_users WHERE login=...
    PG-->>ODOO: 返回用户信息与密码 Hash 比对
    ODOO-->>AUTH: 认证成功，返回 session_id (Token)
    AUTH->>ODOO: POST /openems_backend/info
    Note over ODOO: 判定用户组:<br/>若属于 group_openems_manager -> global_role='admin'<br/>检查 device_user_role 确定 has_multiple_edges
    ODOO-->>AUTH: 返回 User 信息 (id, global_role, settings)
    AUTH-->>UWS: 创建 User 对象并与当前 WebSocket 连接 (WsData) 绑定
    UWS-->>UI: AuthenticateResponse (Token, UserInfo)
```

---

### 2. 数据流二：多租户电站分页列表与权限穿透过滤流 (`GetEdgesRequest`)
展示多租户组织下，用户查询电站列表时，Odoo 如何通过行级规则（`ir.rule`）自动过滤可见设备，并将每座电站的独立角色合并返回。

```mermaid
sequenceDiagram
    autonumber
    participant UI as OpenEMS Web UI
    participant UWS as UiWebsocket
    participant MO as MetadataOdoo
    participant OH as OdooHandler
    participant ODOO as Odoo Web/ORM
    participant PG as PostgreSQL (odoo)

    UI->>UWS: GetEdgesRequest (page, limit, searchParams)
    UWS->>MO: getPageDevice(user, paginationOptions)
    MO->>OH: getEdges(user, options)
    OH->>ODOO: POST /openems_backend/get_edges (携带 session_id)
    Note over ODOO: device_model.with_user(uid).search_read()<br/>底层自动应用 ir.rule 过滤仅限本用户授权设备
    ODOO->>PG: SQL: SELECT ... FROM openems_device WHERE ... AND id IN (SELECT device_id FROM openems_device_user_role WHERE user_id=uid)
    PG-->>ODOO: 返回过滤后的设备记录集
    Note over ODOO: 循环遍历并合并计算每台设备的细粒度角色:<br/>role = user_role.role
    ODOO-->>OH: 返回 devices 列表 (带每台电站对应独立角色)
    Note over MO: 将各电站角色写入本地内存缓存:<br/>userRoles.get(userId).put(edgeId, role)
    MO-->>UWS: 拼装 EdgeMetadata 列表 (含实时在线状态)
    UWS-->>UI: GetEdgesResponse
```

---

### 3. 数据流三：云端只读请求的 RBAC 拦截与本地缓存命中流 (`QueryHistoricTimeseriesDataRequest`)
展示普通租户或访客查询历史时序数据（InfluxDB），云端如何以常数时间复杂度 $O(1)$ 拦截非授权访问或放行有效只读请求。

```mermaid
sequenceDiagram
    autonumber
    participant UI as OpenEMS Web UI
    participant UWS as UiWebsocket
    participant CORE as CoreJsonRpcRequestHandler
    participant RPC as EdgeRpcRequestHandler
    participant MO as MetadataOdoo
    participant TDATA as TimedataManager (InfluxDB)

    UI->>UWS: EdgeRpcRequest (edgeId="edge0", QueryHistoricTimeseriesDataRequest)
    UWS->>CORE: handleRequest("uiwebsocket", user, request)
    CORE->>RPC: handleRequest(user, messageId, edgeRpcRequest)
    RPC->>MO: assertRoleIsAtLeast(user, "edge0", Role.GUEST, "edgeRpc")
    Note over MO: 检索内存缓存: userRoles.get(userId).get("edge0")
    alt 缓存未授权 (role == null)
        MO-->>RPC: 抛出 COMMON_ROLE_UNDEFINED (403)
        RPC-->>UI: 错误响应: Role is undefined for user
    else 权限满足 (role >= GUEST)
        MO-->>RPC: 鉴权通过，返回 role 实例
        RPC->>TDATA: 查询 InfluxDB 获取通道时序曲线
        TDATA-->>RPC: 返回时序聚合指标
        RPC-->>UWS: 包装 QueryHistoricTimeseriesDataResponse
        UWS-->>UI: 返回历史曲线图表数据
    end
```

---

### 4. 数据流四：边缘控制指令的 RBAC 校验与下发穿透全链路 (`UpdateComponentConfig`)
展示业主或安装商修改边缘储能系统参数（如最大放电功率限值）时，云端鉴权拦截、下发打包、边缘解包及端侧本地守卫终审的完整数据流。

```mermaid
sequenceDiagram
    autonumber
    participant UI as OpenEMS Web UI
    participant UWS as UiWebsocket
    participant RPC as EdgeRpcRequestHandler
    participant MO as MetadataOdoo
    participant EM as EdgeManager
    participant BEG as openems-backend-edge (8085)
    participant EDGE as OpenEMS Edge (现场工控机)

    UI->>UWS: EdgeRpcRequest (edge0, UpdateComponentConfig)
    UWS->>RPC: 路由到 EdgeRpcRequestHandler
    RPC->>MO: assertRoleIsAtLeast(user, "edge0", Role.GUEST, "edgeRpc")
    MO-->>RPC: 校验通过 (云端第一道防线放行，获取实际角色例如 OWNER)
    Note over RPC: 检测为底层设备控制命令，后端无法就地处理，委托 EdgeManager 下发
    RPC->>EM: send("edge0", user, role=OWNER, request)
    Note over EM: 打包为鉴权信包:<br/>new AuthenticatedRpcRequest(user, role=OWNER, payload)
    EM->>BEG: WebSocket 隧道下发 (端口 8085)
    BEG->>EDGE: 发送 authenticatedRpc 报文
    Note over EDGE: AuthenticatedRequestHandler 解包:<br/>提取 user 与 role=OWNER<br/>注入 call.put(EdgeKeys.USER_KEY, user)
    Note over EDGE: ComponentManager 路由触发端点守卫:<br/>EdgeGuards.roleIsAtleast(Role.OWNER).test(call)
    alt 端侧角色比对通过
        EDGE->>EDGE: 真正执行 OSGi ConfigurationUpdate (更新储能组件配置)
        EDGE-->>BEG: 返回 Success Response
        BEG-->>EM: 穿透回云端
        EM-->>RPC: 解包并响应
        RPC-->>UI: UpdateComponentConfigResponse (配置修改成功)
    else 端侧角色比对失败 (如实际仅为 GUEST)
        EDGE-->>BEG: 抛出 COMMON_ROLE_ACCESS_DENIED 异常
        BEG-->>UI: 拒绝执行并报错
    end
```

---

### 5. 数据流五：动态权限变更与缓存一致性机制
展示当企业管理员在 Odoo ERP 后台调整用户权限（例如将用户由 `owner` 降级为 `guest` 或解绑设备）时，系统的权限同步与生效路径。

```mermaid
sequenceDiagram
    autonumber
    participant ADM as 企业管理员 (Odoo Web 管理台)
    participant ODOO as Odoo ERP 后台
    participant PG as PostgreSQL (odoo)
    participant MO as MetadataOdoo (Java Backend)
    participant UWS as UiWebsocket

    ADM->>ODOO: 修改 openems.device_user_role (变更用户角色或解绑设备)
    ODOO->>PG: UPDATE openems_device_user_role SET role='guest' ...
    Note over ODOO,MO: 后续增强通知机制 / 会话生命周期联动
    alt 方式 A: 用户重新登录或刷新页面
        UWS->>MO: 触发 GetEdgesRequest 或 AuthenticateWithToken
        MO->>ODOO: 重新调用 /openems_backend/get_edges
        ODOO-->>MO: 返回更新后的最新角色列表
        MO->>MO: 覆盖写入 userRoles.get(userId).put(edgeId, newRole)
    else 方式 B: 用户发起下一次单站请求 (未命中或缓存刷新)
        MO->>ODOO: 懒加载调用 /openems_backend/get_edge_with_role
        ODOO-->>MO: 获取最新数据库角色并更新内存字典
    end
    Note over MO: 后续所有针对该电站的指令均立即按照降级后的权限执行拦截
```

---

## 五、 OpenEMS 常见端点角色权限速查表

下表汇总了 OpenEMS 核心 API 端点及其在云端与边缘端要求的最低权限标准：

| 模块类别 | 接口/方法名 | 最低角色要求 (Edge/Backend) | 权限说明 |
| :--- | :--- | :---: | :--- |
| **监控与数据** | `SubscribeEdgesChannelsRequest` | **GUEST** | 订阅多电站实时通道遥测数据流 |
| **监控与数据** | `GetEdgesStatusRequest` | **GUEST** | 批量获取电站在线/离线健康状态 |
| **时序与报表** | `QueryHistoricTimeseriesDataRequest` | **GUEST** | 查询 InfluxDB 历史功率、SOC 等曲线数据 |
| **时序与报表** | `QueryHistoricTimeseriesExportXlxsRequest` | **GUEST** | 导出 Excel 历史运行报表 |
| **App 应用中心** | `AppCenterGetInstalledAppsRequest` | **GUEST** | 查阅当前电站已安装的应用包列表 |
| **App 应用中心** | `AddAppInstance` / `UpdateAppInstance` | **OWNER** | 新建或修改储能调度应用（如削峰填谷、动态分时） |
| **App 应用中心** | `DeleteAppInstance` | **OWNER** | 卸载电站的应用实例 |
| **组件生命周期** | `GetEdgeConfigRequest` | **GUEST** | 导出或查阅电站当前的 OSGi 组件拓扑与通道定义 |
| **组件生命周期** | `UpdateComponentConfig` | **OWNER** | 调整现有组件运行参数（如充放电限值、Modbus从机地址） |
| **组件生命周期** | `CreateComponentConfig` | **INSTALLER** (云端) / **ADMIN** (本地) | 动态实例化新的驱动或控制器组件 |
| **组件生命周期** | `DeleteComponentConfig` | **INSTALLER** (云端) / **ADMIN** (本地) | 移除现有硬件或控制驱动组件 |
| **控制与指令** | `SetChannelValueRequest` | **ADMIN** | 向通道强制写入指令（直接覆写硬件寄器/寄存器值） |
| **系统底层管理** | `executeSystemCommand` / `_host` | **ADMIN** | 执行现场工控机底层 Linux 系统 Shell 命令与服务重启 |
| **安装与验收** | `SubmitSetupProtocolRequest` | **INSTALLER** | 提交电站现场施工与调试验收工程报告 |

---

## 六、 架构设计总结与安全启示

1. **动静解耦的多租户隔离**：通过利用 Odoo 的 `ir.rule` 行级安全规则，天然在 SQL 驱动层阻止了租户间越权，避免了在业务逻辑代码中编写容易疏漏的手工 `WHERE tenant_id = ?`。
2. **两级防御与防篡改穿透**：云端首先根据用户在具体电站的计算权限执行预拦截（第一道防线）；对于下发的敏感操作，将角色封装在加密长连接传输的 `AuthenticatedRpcRequest` 中，现场 Edge 依据自身安全守卫进行本地二次验权（第二道防线），有效防御了请求绕过或伪造攻击。
3. **环境自适应守卫（`roleIsAtleastFromBackend` vs `roleIsAtleastNotFromBackend`）**：针对组件增删等敏感操作，允许云端经过企业 SSO/2FA 强认证的安装商（`INSTALLER`）执行，而在本地直连暴露的场景下收紧至 `ADMIN`，实现了运维便捷性与端侧物理安全的精细平衡。
4. **内存二级索引降低开销**：通过 `userRoles` 字典的高速缓存，使得每一笔 API 调用的权限断言仅耗时数十纳秒，保障了百万级时序与指令吞吐下的极低延迟。
