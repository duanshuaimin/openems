# OCMS 首期实施计划（Implementation Plan）：接入、监控、告警与工单闭环

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 版本：1.2 · 2026-10-17；状态：开发执行基线，尚未实现或完成联调。本文不授权直接切换生产环境。

**Goal:** 交付“租户建站 → 设备接入 → 实时与历史监控 → 告警 → 工单验收”的首期闭环，覆盖 [OCMS 协同设计 v2.2](../../../openems_cloud_management_design.md) 的阶段 0–3。

**Architecture:** OCMS 独立部署，通过直接读写 OpenEMS 侧公共 PostgreSQL 和 OpenEMS B2B API 集成。租户、资产、授权主数据由 OCMS 内的公共管理模块统一写入，`Metadata.Tenant` 在 Backend 内读取同一份主数据；Backend 持久化运行事件，OCMS 在独立业务库中完成告警、通知和工单。

**Tech Stack:** Java 21；Spring Boot 3（精确版本由 T01 锁定）；Maven Wrapper；Flyway；PostgreSQL；InfluxDB v2（Flux）；JUnit 5 + Testcontainers；Vue 3 + TypeScript + ECharts 5 + pnpm + Vitest；OpenEMS OSGi 适配器沿用锁定 OpenEMS 源码的 Gradle/bnd 构建链。

## Global Constraints

每个任务都隐含包含本节。括号内为设计 v2.2 的出处。

- 首期范围为设计阶段 0–3；远程组件配置、通道控制、调度、收益结算不在首期。首期不提供任意 RPC 透传或控制命令入口（§6.4、本计划范围决定）。
- 生产首期：一个区域、一个 OpenEMS 集群、一个活动 Backend、一个活动 OCMS；故障后重启恢复，不承诺高可用无中断。测试使用两个集群（§1.2、§9.2）。
- 资产内部标识为 UUID `asset_id`；数据库唯一约束 `(cluster_id, remote_edge_id)`（§3.3）。
- `remote_edge_id` 必须是“非数字前缀 + 数字”，该数字在同一个 bucket + measurement 内唯一；存储标识映射保存 `(bucket, measurement, 数字标签)`；每集群默认独立 bucket；不重写已有标签（§3.3）。
- 公共元数据库分 `tenant`、`runtime`、`integration` 三个 schema；OCMS 业务库使用 `ocms` schema；跨库只用 UUID 引用，不用跨库外键或跨库事务（§3.1）。
- 数据库账号：`ocms_manager`、`ocms_reader`、`backend_runtime`、`migration_owner`；应用账号不是表所有者、超级用户或 BYPASSRLS 角色，无 DDL 权限（§4.2）。
- RLS 同时使用 `USING` 和 `WITH CHECK`；租户上下文在事务内 `SET LOCAL`，缺失上下文默认拒绝（§4.2）。父子租户默认不继承权限，代管显式授权（本计划决定）。
- 角色映射：`PLATFORM_ADMIN` 显式平台特权；`TENANT_ADMIN` → 被授予资产的 `ADMIN`；`INSTALLER` → `INSTALLER`；`OPERATOR` → `OWNER` 或更窄；`VIEWER` → `GUEST`（§4.1）。
- 元数据操作状态：`PENDING_APPLY`、`BACKEND_APPLIED`、`GATEWAY_PENDING`、`APPLIED`、`RETRYING`、`FAILED`、`SUPERSEDED`（§5.3），本计划增加 `FIELD_UPDATE_PENDING`、`NEW_KEY_OBSERVED`、`MIGRATION_OVERDUE`。
- 元数据库失联时网关缓存可用期：最后成功对账后 5 分钟，超期拒绝新握手；Backend 冷启动不使用陈旧凭据快照回退（§5.4）。
- 运行事件默认保留 30 天；未确认事件不被常规清理静默删除（§5.5）。
- 遥测质量：`GOOD` / `STALE` / `UNKNOWN` / `INVALID`；`null` 或缺失不能转换成 0（§6.2）。
- B2B：`subscribeEdgesChannels` 参数为 `count`、`ids`、`channels`，每连接一组订阅、`count` 更大者整体替换，每 2 秒推送全量快照；`getEdgesStatus` 用 `edgeIds`，响应字段 `online`；`getEdgesChannelsValues` 用 `ids`、`channels`（§6.2、§6.5）。
- 开局模板必须显式设置 Edge `Controller.Api.Backend` 的 `persistencePriority`，并在验收时确认告警所用通道非 `null`（§6.5）。
- 同一集群的 B2B 实时订阅只由一个 OCMS 实例持有；连接数 = 集群 × 只读服务身份 × 分片；每个资产只放在一个只读服务身份的订阅里（§6.5）。
- 历史查询客户端必须设置超时并按查询线程池上限限制并发，超时后退避，不立即重发（§6.5）。
- 告警信号状态 `ACTIVE` / `RECOVERED` / `UNKNOWN`；处置状态 `UNACKNOWLEDGED` / `ACKNOWLEDGED` / `IN_PROGRESS` / `CLOSED`；活动告警去重键含 `(asset_id, rule_id, channel)`（§7.2）。
- 工单状态 `OPEN → ASSIGNED → IN_PROGRESS → VERIFYING → CLOSED`，另有取消和退回（§7.3）。
- 日志、门户、数据库导出不得出现完整密码、密钥或认证令牌（§9.3）。
- 上游 OpenEMS 改动保存为可应用于锁定 commit 的补丁系列，并由 CI 验证可重建，不依赖任何服务器上的未提交修改（本计划决定）。
- 首期通知为站内通知和 SMTP 邮件，外部投递为至少一次语义；附件保存在独立持久目录，经鉴权接口访问（本计划决定）。
- 本计划不承诺工期；M0 完成后按任务清单估算，不以压缩验收范围换取进度。

---

## 0. 使用方式与范围拆分

本计划覆盖五个子系统，按“轨道”组织，每条轨道可以单独执行、单独评审：

| 轨道 | 子系统 | 任务 |
| --- | --- | --- |
| A | 契约、工程与验收基线 | T01、T02 |
| B | 公共管理底座（身份、租户、资产、数据库隔离） | T04A、T04B |
| C | OpenEMS 适配器（Metadata.Tenant、网关应用确认、运行事件生产） | T05、T06、T09A |
| D | OCMS 业务服务与门户（实时、历史、事件消费、告警、工单） | T07、T08、T09B、T10、T11 |
| E | 迁移、试运行与切换 | T03A、T03B、T12 |

每个任务的 **Files** 和 **Interfaces** 是给只看到该任务的实施者的完整上下文；跨任务的类型统一在第 2 节定义，不在任务里重新命名。每个任务按“写失败测试 → 运行确认失败 → 实现 → 运行确认通过 → 提交”执行。

依赖顺序：T01 → T02 → T04A → T04B → T05 → T06 为开站主链；T03A 的 `extract`、`diff` 从 M0 开始，`import` 依赖 T04B 的 `AssetCommands`；T03B 在 M3；T07、T08 依赖 T04B；T09A 依赖 T05；T09B 依赖 T09A；T10 依赖 T07、T09B；T11 依赖 T10；T12 汇总发布验收。前端可以按 OpenAPI 用模拟响应先开发，里程碑验收必须连接真实服务。

## 1. 文件结构

```text
ocms/
  pom.xml                                  # 聚合 POM，锁定依赖版本（T02）
  mvnw, .mvn/wrapper/
  platform-contracts/                      # 框架无关的共享类型，带 OSGi 清单，供 OCMS 与适配器共用
    src/main/java/io/ocms/contracts/
  tenant-domain/                           # 租户、资产、授权、凭据的领域规则（无 Spring）
    src/main/java/io/ocms/tenant/
  tenant-jdbc/                             # 公共元数据库访问与迁移脚本
    src/main/java/io/ocms/tenant/jdbc/
    src/main/resources/db/migration/common/
  ocms-server/                             # Spring Boot 应用
    src/main/java/io/ocms/server/
      identity/  asset/  operation/  openems/  monitoring/  timeseries/
      runtime/   alarm/  notification/  workorder/  attachment/  migration/
    src/main/resources/db/migration/ocms/
    src/main/resources/application.yaml
  ocms-web/                                # Vue 门户
    package.json, pnpm-lock.yaml, src/
  contract-tests/                          # T01：针对真实 OpenEMS 环境的 B2B 与时序契约测试（-Pcontract）
  acceptance-tests/                        # T12：负载、故障注入与切换演练（-Pacceptance）
deploy/ocms/                               # T12：配置模板、TLS、备份恢复与切换/回滚手册
openems-adapters/
  patches/series                           # 应用顺序
  patches/*.patch                          # 针对锁定 OpenEMS commit 的补丁
  scripts/apply-patches.sh                 # 检出锁定 commit 并应用补丁到 build/openems-src
  scripts/build.sh                         # 在 build/openems-src 内构建并运行适配器测试
  io.openems.backend.metadata.tenant/      # Metadata.Tenant bundle 源码（补丁引入）
  io.openems.backend.runtime.events/       # 运行事件生产 bundle 源码（补丁引入）
  gateway-apply-adapter/                   # 网关应用回执与连接处置（补丁引入）
docs/ocms/
  version-lock.md                          # T01：部署版本、JAR 校验值、依赖版本
  capability-matrix.md                     # T01：已验证 / 需配置 / 需新增 的能力
  channel-catalog.yaml                     # T01：点表与 ChannelContract
  acceptance-config.yaml                   # T01：第 5 节验收参数
  api/openapi.yaml                         # T01：北向接口
  events/*.schema.json                     # T01：ChangeEvent、ApplyReceipt、RuntimeEvent、RuntimeGap
  decisions/ADR-00N-*.md                   # T01：决策记录
.github/workflows/ocms.yaml                # T02：CI
```

## 2. 共享契约

### 2.1 platform-contracts 类型

以下类型在 T02 实现，之后的任务按这些名字和字段使用，不得另起名字。时间统一为 `java.time.Instant`，JSON 载荷以字符串保存，使本模块不依赖 Spring 或 Jackson。

```java
package io.ocms.contracts;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

public record StorageLocator(String influxInstance, String org, String bucket,
        String measurement, int edgeTag) {}

public record AssetLocator(UUID assetId, UUID tenantId, UUID siteId, UUID clusterId,
        String remoteEdgeId, StorageLocator storage) {}

public enum Quality { GOOD, STALE, UNKNOWN, INVALID }
public enum ReportMode { PERIODIC, CHANGE_ONLY, UNKNOWN }
public enum TimeEvidence { SOURCE_TIMESTAMP, BACKEND_RECEIVED, NONE }
public enum StateLevel { OK, INFO, WARNING, FAULT }

public record ChannelContract(String channelAddress, String unit, String valueType,
        StateLevel stateLevel /* 非状态通道为 null */, ReportMode reportMode,
        Duration reportInterval, Duration freshnessLimit, TimeEvidence timeEvidence,
        String configVersion) {}

public record TelemetrySample(UUID assetId, String channelAddress, String valueJson,
        Instant sourceTimestamp /* 可空 */, Instant sourceObservedAt /* 可空 */,
        Instant receivedAt, Quality quality, long connectionEpoch) {}

public enum ChangeType { EDGE_REGISTERED, EDGE_UPDATED, EDGE_DISABLED,
        CREDENTIAL_ISSUED, CREDENTIAL_REVOKED, GRANT_CHANGED, SERVICE_IDENTITY_CHANGED }

public record ChangeEvent(UUID eventId, UUID aggregateId, String aggregateType,
        long revision, ChangeType type, UUID targetClusterId, Instant committedAt) {}

public enum ApplyResult { APPLIED, REJECTED_STALE, FAILED }
public enum ConnectionAction { NONE, REAUTHENTICATED, DISCONNECTED }

public record ApplyReceipt(UUID eventId, String consumerId, long consumerEpoch,
        long appliedRevision, ApplyResult result, Integer credentialVersion /* 可空 */,
        ConnectionAction connectionAction, Instant at) {}

public enum OperationState { PENDING_APPLY, BACKEND_APPLIED, GATEWAY_PENDING,
        FIELD_UPDATE_PENDING, NEW_KEY_OBSERVED, APPLIED, RETRYING, FAILED,
        SUPERSEDED, MIGRATION_OVERDUE }

public enum RuntimeEventType { CONNECTED, DISCONNECTED, SUM_STATE_CHANGED,
        STATE_CHANNEL_CHANGED, CONFIG_CHANGED }

public record RuntimeEvent(UUID eventId, UUID assetId, long producerEpoch,
        long assetSequence, RuntimeEventType type, Instant occurredAt /* 可空 */,
        Instant observedAt, String configVersion, String payloadJson) {}

public enum GapReason { QUEUE_OVERFLOW, PAYLOAD_TOO_LARGE, DB_UNAVAILABLE,
        ABNORMAL_RESTART, RETENTION_PURGE, SOURCE_INTERRUPTED }

public record RuntimeGap(UUID gapId, UUID clusterId, UUID assetId /* 可空 = 全集群 */,
        long producerEpoch, Instant from, Instant to, GapReason reason) {}

public enum SignalState { ACTIVE, RECOVERED, UNKNOWN }
public enum HandlingState { UNACKNOWLEDGED, ACKNOWLEDGED, IN_PROGRESS, CLOSED }
public enum EvaluationEndReason { SUPERSEDED, DISABLED }

public record AlarmOccurrence(UUID occurrenceId, UUID tenantId, UUID assetId,
        UUID ruleId, int ruleVersion, String channelAddress, SignalState signal,
        HandlingState handling, EvaluationEndReason endReason /* 可空 */,
        UUID supersedesOccurrenceId /* 可空 */, Instant firstOccurredAt,
        Instant recoveredAt /* 可空 */) {}

public record MigrationManifest(UUID runId, String sourceSnapshotId, Instant snapshotAt,
        long mappedRecords, long differences, String credentialVersionsDigest,
        String revocationListDigest) {}

public record OcmsError(String code, String message, String requestId) {}
```

`OcmsError.code` 取值固定为：`FORBIDDEN`、`REVISION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`UNAVAILABLE`、`EDGE_OFFLINE`、`UNSUPPORTED`、`RESULT_UNKNOWN`、`VALIDATION_FAILED`。

### 2.2 北向接口规则

接口沿用设计 §8.2：`/api/v1/tenants`、`/sites`、`/edges`、`/operations`、`/alarms`、`/work-orders`；本计划增加 `/api/v1/auth/login`、`/api/v1/auth/logout`、`/api/v1/alarm-rules/{id}/versions`、`/api/v1/attachments`。历史接口和门户 WebSocket 的每个值都带时间与 `Quality`。

- 所有写接口要求请求头 `Idempotency-Key`；修改已有资源要求 `If-Match: <revision>`；创建操作校验唯一性。
- 相同主体、资源、幂等键和载荷的重试返回原结果；载荷不同返回 `409 IDEMPOTENCY_CONFLICT`。
- 分页、时间范围上限和订阅配额写进 `docs/ocms/api/openapi.yaml`，属于接口的一部分。

## 3. 任务

### M0：契约、环境与可执行验收基线

### Task T01：版本锁定、能力验证与决策记录

**Files:**
- Create: `docs/ocms/version-lock.md`、`docs/ocms/capability-matrix.md`、`docs/ocms/channel-catalog.yaml`、`docs/ocms/acceptance-config.yaml`
- Create: `docs/ocms/api/openapi.yaml`、`docs/ocms/events/change-event.schema.json`、`apply-receipt.schema.json`、`runtime-event.schema.json`、`runtime-gap.schema.json`
- Create: `docs/ocms/decisions/ADR-001-version-lock.md` 至 `ADR-006-freshness-parameters.md`
- Create: `ocms/contract-tests/`（可重跑的 B2B 与时序契约测试，T02 接入 CI）

**Interfaces:**
- Consumes: 设计 v2.2；部署环境的 OpenEMS JAR 与配置。
- Produces: 第 2 节类型对应的 JSON Schema 与 OpenAPI；`acceptance-config.yaml` 中第 5 节每一项的数值、单位与理由；下列 ADR。

| ADR | 决策 | 默认方案（ADR 推翻时须同步修改下游任务） |
| --- | --- | --- |
| ADR-001 | 部署版本与依赖锁 | 以部署 JAR 对应的源码 commit 为准；不一致时以 JAR 为准并重跑契约测试 |
| ADR-002 | 状态通道事件来源（设计 §5.5 要求阶段 0 选定） | 采用 Backend 挂点（T09A）；订阅流转换作为备选，不同时实现两套 |
| ADR-003 | 网关应用确认 | 实现 `gateway-apply-adapter`（T06）；若网关已原生提供回执，适配器只做透传，接口不变 |
| ADR-004 | B2B REST 历史对照入口 | 生产使用修复并验证后的适配制品；修复未通过验收时，生产配置 `ocms.history.api-compare.enabled=false` 关闭对照入口 |
| ADR-005 | 用户密码迁移 | 只有通过真实样本认证测试的哈希格式允许导入，否则强制重置；旧登录会话统一失效；设备密钥保持不变 |
| ADR-006 | 通道新鲜度参数 | 按第 4.2 节默认值，按实际通道验证后写入 `channel-catalog.yaml` |

- [ ] **Step 1：写失败的契约测试。** 在 `ocms/contract-tests/src/test/java/io/ocms/contract/B2bSubscriptionContractTest.java` 写入：

```java
@Test
void higherCountReplacesWholeSubscription() {
    var ws = B2bTestClient.connect(env.cluster("A"), env.readOnlyIdentity("A"));
    ws.subscribe(1, List.of("edge0"), List.of("_sum/EssSoc", "_sum/GridActivePower"));
    ws.subscribe(2, List.of("edge0"), List.of("_sum/EssSoc"));
    var snapshot = ws.awaitEdgesCurrentData(Duration.ofSeconds(5));
    assertThat(snapshot.channels("edge0")).containsExactly("_sum/EssSoc");
}
```

  同一文件再写：`snapshotIsFullEveryTwoSeconds`（连续两次推送间隔 2 s ± 0.5 s 且都包含全部订阅通道）、`missingChannelIsJsonNull`、`getEdgesStatusUsesOnlineField`。另建 `HistoryContractTest`（日历日边界、累计量重置）和 `HistoryQueueSaturationTest`（打满查询队列后客户端在配置超时内失败）。

- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml -pl contract-tests verify -Pcontract -Docms.env=docs/ocms/acceptance-config.yaml`；Expected: FAIL，原因是 `B2bTestClient` 尚不存在。

- [ ] **Step 3：建立隔离环境并实现测试客户端。** 环境含两个租户、两个测试集群、两个集群都有 `edge0` 且使用不同 bucket；禁止运行任何向生产库写数据的演示脚本。实现 `B2bTestClient`、`HistoryTestClient`，把脱敏后的请求与响应报文保存到 `ocms/contract-tests/src/test/resources/recordings/`。

- [ ] **Step 4：运行确认通过，并写入结论。** 重跑 Step 2 命令；Expected: PASS。把结果写进 `capability-matrix.md`（每项标“已验证 / 需启用配置或权限 / 需项目新增”），完成六份 ADR 和 `acceptance-config.yaml`。检查：`rg -n "TBD|待定|TODO" docs/ocms` 输出为空。

- [ ] **Step 5：提交。**

```bash
git add docs/ocms ocms/contract-tests
git commit -m "docs(ocms): lock versions, record capability matrix and ADRs"
```

**退出条件：** 一站接入、订阅、历史链路的契约测试可重跑并通过；ADR-001 至 ADR-006 已评审；`acceptance-config.yaml` 没有空值。

### Task T02：工程骨架、共享类型与 CI

**Files:**
- Create: `ocms/pom.xml`、`ocms/mvnw`、`ocms/.mvn/wrapper/maven-wrapper.properties`
- Create: `ocms/platform-contracts/pom.xml`（`bnd-maven-plugin` 生成 OSGi 清单）及第 2.1 节全部类型
- Create: `ocms/tenant-jdbc/src/main/resources/db/migration/common/V1__roles_and_schemas.sql`
- Create: `ocms/ocms-server/src/main/resources/db/migration/ocms/V1__ocms_schema.sql`
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/db/TenantContextDataSource.java`
- Create: `ocms/ocms-web/package.json`、`pnpm-lock.yaml`、`vitest.config.ts`
- Create: `openems-adapters/patches/series`、`openems-adapters/scripts/apply-patches.sh`、`openems-adapters/scripts/build.sh`
- Create: `.github/workflows/ocms.yaml`
- Test: `ocms/platform-contracts/src/test/java/io/ocms/contracts/ContractJsonSchemaTest.java`、`ocms/ocms-server/src/test/java/io/ocms/server/db/DatabaseRoleIsolationTest.java`

**Interfaces:**
- Consumes: T01 的 JSON Schema、`version-lock.md`。
- Produces: 第 2.1 节类型；`TenantContextDataSource`（每个事务开始时执行 `SET LOCAL app.tenant_ids = ...`，连接归还时清理）；稳定构建入口 `./mvnw -f ocms/pom.xml verify`、`pnpm --dir ocms/ocms-web test`、`pnpm --dir ocms/ocms-web build`、`openems-adapters/scripts/build.sh`。

- [ ] **Step 1：写失败测试。**

```java
class DatabaseRoleIsolationTest extends PostgresIT {
    @Test
    void applicationRoleCannotRunDdl() {
        assertThatThrownBy(() -> asRole("ocms_manager").execute("CREATE TABLE tenant.x(id int)"))
            .hasMessageContaining("permission denied");
    }

    @Test
    void missingTenantContextReturnsNoRows() {
        seedTwoTenantsWithOneSiteEach();
        assertThat(asRole("ocms_manager").query("SELECT * FROM tenant.site")).isEmpty();
    }

    @Test
    void pooledConnectionDoesNotLeakPreviousTenantContext() {
        inTenantTransaction(TENANT_A, tx -> tx.query("SELECT 1"));
        assertThat(asRole("ocms_manager").query("SELECT current_setting('app.tenant_ids', true)"))
            .containsOnlyNullOrEmpty();
    }
}
```

  `ContractJsonSchemaTest` 逐个序列化第 2.1 节类型，并用 T01 的 JSON Schema 校验。

- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml verify`；Expected: FAIL（模块与迁移脚本不存在）。
- [ ] **Step 3：实现。** 建立聚合 POM 与五个模块；写 `V1__roles_and_schemas.sql`（创建四个账号、三个 schema、默认权限，应用账号无 DDL）；实现 `TenantContextDataSource`；配置 Testcontainers（两个 PostgreSQL、InfluxDB、模拟 Edge）；`apply-patches.sh` 检出 `version-lock.md` 中的 commit 到 `build/openems-src` 并按 `series` 应用补丁；CI 依次运行四个构建入口。
- [ ] **Step 4：运行确认通过。** Run: `./mvnw -f ocms/pom.xml verify && pnpm --dir ocms/ocms-web test && pnpm --dir ocms/ocms-web build && openems-adapters/scripts/build.sh`；Expected: 全部成功；空库初始化与重复迁移均通过。
- [ ] **Step 5：提交。**

```bash
git add ocms openems-adapters .github/workflows/ocms.yaml
git commit -m "build(ocms): add project skeleton, shared contracts and CI"
```

**退出条件：** 四个构建入口在 CI 中通过；应用账号无法执行 DDL、跨租户查询或越权更新。

### Task T03A：迁移工具——抽取、导入与差异（M0–M1）

**Files:**
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/migration/MigrationCli.java`
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/migration/OdooExtractor.java`、`IdMappingStore.java`、`TenantImporter.java`、`SnapshotDiffer.java`
- Create: `ocms/tenant-jdbc/src/main/resources/db/migration/common/V5__migration_mapping.sql`
- Test: `ocms/ocms-server/src/test/java/io/ocms/server/migration/MigrationRoundTripIT.java`

**Interfaces:**
- Consumes: T02 的 `TenantContextDataSource`；T04B 的资产写入用例 `AssetCommands`（导入走同一领域校验与事务入口）。
- Produces: 子命令 `extract`、`import`、`diff`，均支持 `--dry-run` 与 `--run-id`；`MigrationManifest`；映射表 `tenant.migration_id_map(source_system, source_id, asset_or_user_id)`。

- [ ] **Step 1：写失败测试。**

```java
@Test
void reimportingSameSourceRecordKeepsUuid() {
    var first = cli.run("import", "--run-id", RUN_1, "--snapshot", SNAPSHOT_A);
    var second = cli.run("import", "--run-id", RUN_2, "--snapshot", SNAPSHOT_A);
    assertThat(second.uuidFor("openems.device", "42")).isEqualTo(first.uuidFor("openems.device", "42"));
}

@Test
void diffDetectsDeletionAndRevokedGrant() {
    cli.run("import", "--run-id", RUN_1, "--snapshot", SNAPSHOT_A);
    var diff = cli.run("diff", "--snapshot", SNAPSHOT_B_WITH_DELETED_DEVICE_AND_REVOKED_ROLE);
    assertThat(diff.deletedSources()).contains("openems.device:43");
    assertThat(diff.revokedGrants()).contains("openems.device_user_role:7");
}
```

  另写：`roleMappingRequiresExplicitReviewForAdmins`（Odoo 管理员不自动映射为 `PLATFORM_ADMIN`）、`exportsContainNoSecrets`、`plaintextDeviceKeyIsStoredEncrypted`。
- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml -pl ocms-server -am verify -Dit.test=MigrationRoundTripIT`；Expected: FAIL。
- [ ] **Step 3：实现。** 盘点 Odoo 用户、设备、授权、配置、密钥及源外键；每类记录建立稳定的“源 ID → UUID”映射；`diff` 基于一致性全量快照，显式处理删除与撤权，不按更新时间增量扫描；导入与 `integration.change_event` 在公共库同一事务内提交；旧库中的明文设备密钥经受控通道导入后加密存储。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2 命令；Expected: PASS。
- [ ] **Step 5：提交。** `git add ocms/ocms-server/src/main/java/io/ocms/server/migration ocms/tenant-jdbc ocms/ocms-server/src/test/java/io/ocms/server/migration && git commit -m "feat(migration): add idempotent extract, import and diff"`

**退出条件：** 首次导入、重复导入、删除与撤权、密码重置规则（ADR-005）均可重跑通过；未完成本任务不进入生产只读试运行。

### M1：公共底座与开站闭环

### Task T04A：身份、会话与服务身份

**Files:**
- Create: `ocms/tenant-domain/src/main/java/io/ocms/tenant/identity/{AppUser,Session,ServiceIdentity,PasswordPolicy}.java`
- Create: `ocms/tenant-jdbc/src/main/resources/db/migration/common/V2__identity.sql`
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/identity/{AuthController,SessionService,ServiceIdentitySelector}.java`
- Test: `ocms/ocms-server/src/test/java/io/ocms/server/identity/AuthControllerIT.java`

**Interfaces:**
- Consumes: T02 的数据源与 `OcmsError`。
- Produces: `POST /api/v1/auth/login`、`POST /api/v1/auth/logout`；`SessionService.revokeAll(UUID userId)`；`ServiceIdentitySelector.readOnlyFor(UUID clusterId, UUID assetId)` 返回服务身份引用（不含明文口令），客户端不能指定服务账号（设计 §4.3）。

- [ ] **Step 1：写失败测试。**

```java
@Test
void revokedSessionIsRejectedImmediately() {
    var token = login("alice", "pw").token();
    sessions.revokeAll(ALICE_ID);
    assertThat(get("/api/v1/sites", token).status()).isEqualTo(401);
}

@Test
void clientCannotChooseServiceIdentity() {
    var res = post("/api/v1/edges/" + ASSET + "/history", aliceToken, Map.of("serviceIdentity", "admin"));
    assertThat(res.json("code")).isEqualTo("VALIDATION_FAILED");
}
```

  另写：`passwordHashNeverAppearsInLogs`、`loginFailureDoesNotRevealWhetherUserExists`。
- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml -pl ocms-server -am verify -Dit.test=AuthControllerIT`；Expected: FAIL。
- [ ] **Step 3：实现。** 实现用户、会话（带期限与撤销）、服务身份及凭据引用；预留外部身份提供方 subject 映射字段，不接入 SSO。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2；Expected: PASS。
- [ ] **Step 5：提交。** `git commit -m "feat(identity): add login, session revocation and service identities"`

**退出条件：** 登录、退出、会话撤销可用；服务身份只能由服务端选择。

### Task T04B：租户、资产、授权与数据库隔离

**Files:**
- Create: `ocms/tenant-domain/src/main/java/io/ocms/tenant/{Tenant,Site,Edge,EdgeGrant,EdgeCredential,AssetCommands,RoleMapping}.java`
- Create: `ocms/tenant-jdbc/src/main/resources/db/migration/common/V3__tenant_assets.sql`、`V4__integration_events.sql`
- Create: `ocms/tenant-jdbc/src/main/java/io/ocms/tenant/jdbc/{AssetRepository,ChangeEventWriter,AssetLocatorQuery}.java`
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/asset/{TenantController,SiteController,EdgeController,OnboardingTemplate}.java`
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/operation/OperationController.java`
- Create: `ocms/ocms-web/src/views/admin/{TenantsView,SitesView,EdgesView}.vue`
- Test: `ocms/tenant-domain/src/test/java/io/ocms/tenant/AssetCommandsTest.java`、`ocms/ocms-server/src/test/java/io/ocms/server/asset/TenantIsolationIT.java`

**Interfaces:**
- Consumes: T04A 的会话与 `ServiceIdentitySelector`；T02 的 `TenantContextDataSource`。
- Produces: `AssetCommands.registerEdge(RegisterEdge cmd) -> OperationRef`，其中 `RegisterEdge(UUID tenantId, UUID siteId, UUID clusterId, String remoteEdgeId, String measurement, int edgeTag)`，`OperationRef(UUID operationId, OperationState state)`，创建后为 `PENDING_APPLY`；`AssetLocatorQuery.locate(UUID assetId, Principal p) -> AssetLocator`（先授权后解析，无权限抛 `FORBIDDEN`）；`OnboardingTemplate.render(UUID assetId)` 输出 Edge 开局配置，其中显式包含 `Controller.Api.Backend.persistencePriority`；`GET /api/v1/operations/{id}`。

- [ ] **Step 1：写失败测试。**

```java
@Test
void registeringEdgeWritesAssetProjectionAuditAndEventInOneTransaction() {
    var op = assets.registerEdge(new RegisterEdge(TENANT_A, SITE_A, CLUSTER_1, "edge7", "data", 7));
    assertThat(op.state()).isEqualTo(OperationState.PENDING_APPLY);
    assertThat(db.count("tenant.edge")).isEqualTo(1);
    assertThat(db.count("runtime.edge_registry")).isEqualTo(1);
    assertThat(db.count("tenant.audit_log")).isEqualTo(1);
    assertThat(db.count("integration.change_event")).isEqualTo(1);
}

@Test
void rejectsDuplicateNumericTagInSameBucket() {
    assets.registerEdge(new RegisterEdge(TENANT_A, SITE_A, CLUSTER_1, "edge7", "data", 7));
    assertThatThrownBy(() -> assets.registerEdge(new RegisterEdge(TENANT_B, SITE_B, CLUSTER_1, "site7", "data", 7)))
        .hasMessageContaining("edge tag 7 already used");
}

@Test
void rejectsRemoteEdgeIdWithoutNumericSuffix() {
    assertThatThrownBy(() -> assets.registerEdge(new RegisterEdge(TENANT_A, SITE_A, CLUSTER_1, "edgeA", "data", 0)))
        .hasMessageContaining("remote_edge_id");
}

@Test
void onboardingTemplateSetsPersistencePriorityExplicitly() {
    assertThat(template.render(ASSET)).contains("persistencePriority");
}
```

  `TenantIsolationIT` 覆盖：租户 B 通过列表、详情、导出、`/operations` 均看不到租户 A 资产；`If-Match` 并发冲突返回 `REVISION_CONFLICT`；相同幂等键不同载荷返回 `IDEMPOTENCY_CONFLICT`；site 与 tenant 不一致被拒绝；平台特权操作写审计。
- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml verify -Dtest=AssetCommandsTest -Dit.test=TenantIsolationIT`；Expected: FAIL。
- [ ] **Step 3：实现。** 实现租户层级（`tenant_closure`）、成员、站点、设备、设备授权和凭据密文存储；资产登记校验 site/tenant 一致性、`remote_edge_id` 格式与数字标签唯一；管理修改、`runtime.edge_registry` 投影、脱敏审计、`change_event` 与目标投递同一事务提交；首期不支持跨租户或跨集群转移；交付基本管理页面。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2 并运行 `pnpm --dir ocms/ocms-web test`；Expected: PASS。
- [ ] **Step 5：提交。** `git commit -m "feat(asset): add tenants, sites, edges and isolated asset registration"`

**退出条件：** 只有授权范围内的用户可登记、查看和管理资产；开局模板包含 `persistencePriority`。

### Task T05：Metadata.Tenant 与可靠应用

**Files:**
- Create（经补丁引入）: `openems-adapters/io.openems.backend.metadata.tenant/src/io/openems/backend/metadata/tenant/{MetadataTenant,TenantEdgeCache,ChangeEventConsumer,ReconcileWorker,RuntimeStatusWriter}.java`、`bnd.bnd`
- Create: `openems-adapters/patches/0001-metadata-tenant.patch`，并更新 `patches/series`
- Test: `openems-adapters/io.openems.backend.metadata.tenant/test/io/openems/backend/metadata/tenant/ChangeEventConsumerTest.java`

**Interfaces:**
- Consumes: `platform-contracts` 中的 `ChangeEvent`、`ApplyReceipt`、`AssetLocator`；公共库 `runtime.edge_registry` 与 `integration.change_delivery`。
- Produces: OSGi 组件 `Metadata.Tenant`（实现 OpenEMS `Metadata` 与 B2B 所需的认证服务，按 §4.1 映射设备角色）；每条投递写回 `ApplyReceipt`；`runtime.edge_status` 带 `producer_epoch`、`sequence`。

- [ ] **Step 1：写失败测试。**

```java
@Test
void olderRevisionNeverOverwritesNewer() {
    consumer.apply(event(EDGE_A, 5));
    consumer.apply(event(EDGE_A, 4));
    assertThat(cache.revisionOf(EDGE_A)).isEqualTo(5);
    assertThat(lastReceipt().result()).isEqualTo(ApplyResult.REJECTED_STALE);
}

@Test
void crashAfterApplyBeforeAckIsIdempotentOnRetry() {
    consumer.apply(event(EDGE_A, 5));
    simulateCrashBeforeAck();
    consumer.apply(event(EDGE_A, 5));
    assertThat(receiptsFor(EDGE_A, 5)).hasSize(1);
}
```

  另写：`tombstoneRemovesCredentialFromCache`、`writesFromOlderProducerEpochAreRejected`、`coldStartLoadsLatestCommittedState`、`newConsumerSnapshotThenCatchUpHasNoGap`（并发写入期间建立全量快照）。
- [ ] **Step 2：运行确认失败。** Run: `openems-adapters/scripts/build.sh :io.openems.backend.metadata.tenant:test`；Expected: FAIL。
- [ ] **Step 3：实现。** 逐消费者投递、租约、重试、revision 去重、tombstone、周期对账、新消费者“先快照后补事件”；`producer_epoch` 在启动时持久分配；不用全局最大 sequence 代表消费完成。原生 UI 的公共管理写入口（设备认领、授权、用户设置）接入公共模块或关闭。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2；Expected: PASS。再用集成环境验证 OCMS 停机不影响既有采集。
- [ ] **Step 5：提交。** `git add openems-adapters && git commit -m "feat(adapter): add Metadata.Tenant with reliable change delivery"`

**退出条件：** 对象版本可以从数据库一路追踪到 Backend；配置快照只作为观测数据，管理端不能直接覆盖。

### Task T06：网关应用确认与现场密钥轮换

**Files:**
- Create（经补丁引入）: `openems-adapters/gateway-apply-adapter/src/.../{CredentialVersionTracker,ApplyReceiptPublisher,ConnectionRevoker}.java`
- Create: `openems-adapters/patches/0002-gateway-apply-adapter.patch`
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/asset/credential/{RotationService,RotationDeadlineJob,SecretPickupController}.java`
- Create: `ocms/tenant-jdbc/src/main/resources/db/migration/common/V6__credential_rotation.sql`
- Test: `ocms/ocms-server/src/test/java/io/ocms/server/asset/credential/RotationServiceIT.java`

**Interfaces:**
- Consumes: T04B 的 `EdgeCredential`；T05 的 `ApplyReceipt`。
- Produces: `RotationService.start(UUID assetId) -> OperationRef`；`POST /api/v1/edges/{id}/credentials/rotate`；一次性领取接口 `POST /api/v1/edges/{id}/credentials/{version}/pickup`（要求重新认证并写审计）；`OperationState` 的轮换相关取值。

- [ ] **Step 1：写失败测试。**

```java
@Test
void manualTickDoesNotCompleteRotationWithoutNewKeyHandshake() {
    var op = rotation.start(ASSET);
    gateways.confirmAll(op);
    installer.markFieldUpdated(op);
    assertThat(operations.state(op)).isEqualTo(OperationState.FIELD_UPDATE_PENDING);
    edgeSim.handshakeWithVersion(ASSET, 2);
    assertThat(operations.state(op)).isEqualTo(OperationState.NEW_KEY_OBSERVED);
}

@Test
void overdueRotationRevokesOldKeyAndNeverReportsSuccess() {
    var op = rotation.start(ASSET);
    clock.advance(Duration.ofHours(24).plusSeconds(1));
    deadlineJob.run();
    assertThat(operations.state(op)).isEqualTo(OperationState.MIGRATION_OVERDUE);
    assertThat(credentials.isActive(ASSET, 1)).isFalse();
}
```

  另写：`partialGatewayConfirmationKeepsGatewayPending`、`emergencyRevokeDisconnectsExistingSession`、`revokedKeyIsNotRestoredFromBackup`、`deadlineJobSurvivesRestart`、`secretIsNeverInLogsOrReceipts`、`cacheOlderThanFiveMinutesRejectsNewHandshake`。
- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml -pl ocms-server -am verify -Dit.test=RotationServiceIT && openems-adapters/scripts/build.sh :gateway-apply-adapter:test`；Expected: FAIL。
- [ ] **Step 3：实现。** 正常轮换：生成新版本 → 所有目标网关确认接受 → 安装人员经领取接口取得新密钥 → 现场更新 → Edge 用新版本认证成功 → 撤销旧版本 → 网关与旧连接处置确认。默认窗口 24 小时，到期转 `MIGRATION_OVERDUE` 并告警，按已声明截止时间撤销旧密钥；延期须在截止前显式受审计修改；已撤销密钥不能复活。紧急撤销不等现场迁移，立即拒绝旧版本新握手并断开存量连接。秘密不经邮件、工单附件或日志传递；领取结果丢失时重新签发新版本，不提供读取已有密钥的接口。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2；Expected: PASS。
- [ ] **Step 5：提交。** `git commit -m "feat(credential): add gateway receipts and field-verified key rotation"`

**退出条件：** 登记到上线、正常轮换、紧急撤销闭环通过；`APPLIED` 必须带有所需的凭据版本与连接处置证据。

### M2：监控、历史与隔离

### Task T07：实时客户端与监控门户

**Files:**
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/openems/{B2bConnectionManager,SubscriptionPlanner,SubscriptionLease}.java`
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/monitoring/{TelemetryCache,FreshnessEvaluator,PortalPushGateway}.java`
- Create: `ocms/ocms-web/src/views/monitoring/{SiteListView,SiteOverviewView,EnergyFlowView,DeviceStatusView}.vue`
- Test: `ocms/ocms-server/src/test/java/io/ocms/server/monitoring/FreshnessEvaluatorTest.java`、`ocms/ocms-server/src/test/java/io/ocms/server/openems/SubscriptionPlannerTest.java`

**Interfaces:**
- Consumes: T04B 的 `AssetLocatorQuery`；T04A 的 `ServiceIdentitySelector`；T01 的 `channel-catalog.yaml`（`ChannelContract`）。
- Produces: `TelemetryCache.latest(UUID assetId, String channel) -> TelemetrySample`；`FreshnessEvaluator.evaluate(TelemetrySample, ChannelContract, Instant now) -> Quality`；门户 WebSocket 主题 `/topic/assets/{assetId}/telemetry`；`SubscriptionPlanner.plan(Collection<AssetLocator>) -> List<ConnectionPlan>`，`ConnectionPlan(UUID clusterId, String serviceIdentityRef, int shard, int count, List<String> ids, List<String> channels)`。

- [ ] **Step 1：写失败测试。**

```java
@Test
void repeatedSnapshotDoesNotExtendSourceFreshness() {
    var contract = periodic("_sum/EssSoc", Duration.ofSeconds(2), Duration.ofSeconds(10));
    var first = sample("_sum/EssSoc", "55", SOURCE_T0, RECEIVED_T0);
    var repeated = sample("_sum/EssSoc", "55", SOURCE_T0, RECEIVED_T0.plusSeconds(20));
    assertThat(evaluator.evaluate(first, contract, RECEIVED_T0)).isEqualTo(Quality.GOOD);
    assertThat(evaluator.evaluate(repeated, contract, RECEIVED_T0.plusSeconds(20))).isEqualTo(Quality.STALE);
}

@Test
void nullValueIsUnknownNotZero() {
    assertThat(evaluator.evaluate(sample("bms0/MaxCellTemperature", "null", null, NOW), periodicContract(), NOW))
        .isEqualTo(Quality.UNKNOWN);
}

@Test
void eachAssetAppearsInExactlyOneReadOnlySubscription() {
    var plans = planner.plan(assetsAcrossTwoIdentities());
    assertThat(plans.stream().flatMap(p -> p.ids().stream())).doesNotHaveDuplicates();
}
```

  另写：`resubscribeSendsFullSetWithHigherCount`、`lostLeaseStopsPublishingAndEvaluation`、`revokedGrantClosesPortalSubscription`、`crossTenantSubscriptionIsRejected`、`outOfOrderSampleIsIgnored`。
- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml -pl ocms-server -am test -Dtest='FreshnessEvaluatorTest,SubscriptionPlannerTest'`；Expected: FAIL。
- [ ] **Step 3：实现。** 按“集群 × 只读服务身份 × 分片”管理 B2B 连接；每次变更发送完整集合并递增 `count`，重连后重新授权并全量重订阅；部署使用互斥租约防止重启时两个实例重叠，失去租约立即停止订阅发布和告警评估，旧代次结果被拒绝；按第 4.2 节计算质量；交付站点列表、单站概览、能量流、设备状态页面，缺少电芯点位时展示已有的聚合层级。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2，并运行 `pnpm --dir ocms/ocms-web test`；Expected: PASS。
- [ ] **Step 5：提交。** `git commit -m "feat(monitoring): add B2B subscriptions, freshness evaluation and portal views"`

**退出条件：** 真实通道正确展示时间和质量；新鲜度不足不能作为告警恢复证据。

### Task T08：历史查询与异步报表

**Files:**
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/timeseries/{InfluxHistoryAdapter,ApiHistoryAdapter,HistoryQueryPolicy,CalendarRangeConverter,ReportJobService}.java`
- Create: `ocms/ocms-server/src/main/resources/flux/{power_series.flux,energy_delta.flux}`
- Create: `ocms/ocms-web/src/views/history/HistoryView.vue`
- Test: `ocms/ocms-server/src/test/java/io/ocms/server/timeseries/HistoryEquivalenceIT.java`、`CalendarRangeConverterTest.java`

**Interfaces:**
- Consumes: T04B 的 `AssetLocatorQuery`（`StorageLocator` 决定 bucket、measurement、数字标签）。
- Produces: `GET /api/v1/edges/{id}/history?from&to&channels&resolution`，内部区间统一为带时区的 `[start, end)`；`ReportJobService.submit(...) -> UUID jobId`；配置项 `ocms.history.api-compare.enabled`（ADR-004）。

- [ ] **Step 1：写失败测试。**

```java
@Test
void sameNameEdgesInTwoClustersNeverMix() {
    var a = history.query(ASSET_EDGE0_CLUSTER_1, DAY, List.of("_sum/EssActivePower"));
    var b = history.query(ASSET_EDGE0_CLUSTER_2, DAY, List.of("_sum/EssActivePower"));
    assertThat(a.points()).isNotEqualTo(b.points());
    assertThat(a.storage().bucket()).isNotEqualTo(b.storage().bucket());
}

@Test
void dstDayHasTwentyThreeHoursInBerlin() {
    var range = converter.localDay(LocalDate.of(2026, 3, 29), ZoneId.of("Europe/Berlin"));
    assertThat(Duration.between(range.start(), range.end())).isEqualTo(Duration.ofHours(23));
}

@Test
void apiAdapterTimesOutAndBacksOffInsteadOfRetryingImmediately() {
    apiStub.hangForever();
    assertThatThrownBy(() -> apiAdapter.query(ASSET, DAY, CHANNELS)).hasMessageContaining("RESULT_UNKNOWN");
    assertThat(apiStub.requestCountWithin(Duration.ofSeconds(1))).isEqualTo(1);
}
```

  另写：`cumulativeCounterResetIsHandled`、`sparseValuesUseHoldSemantics`、`missingDataIsMarkedNotZero`、`queryLimitsRejectTooManyChannels`、`revokedUserCannotDownloadReport`、`directAndApiResultsMatchOnFixedSamples`。
- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml -pl ocms-server -am verify -Dtest=CalendarRangeConverterTest -Dit.test=HistoryEquivalenceIT`；Expected: FAIL。
- [ ] **Step 3：实现。** 直查 Influx 是常规路径，API 适配器仅用于对照，不做静默回退；统一单位、日历日转换、累计量重置、缺失、稀疏保持与聚合；限制资产数、通道数、点数和并发；报表走持久任务；API 适配器设置超时、退避和熔断；按 ADR-004 处理生产对照入口。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2；Expected: PASS。
- [ ] **Step 5：提交。** `git commit -m "feat(history): add Influx history adapter, API comparison and report jobs"`

**退出条件：** 固定样本下两种口径一致；过载不会因重试放大；同名 Edge 的历史不串用。

### M3：告警、通知与工单闭环

### Task T09A：Backend 运行事件生产与背压

**Files:**
- Create（经补丁引入）: `openems-adapters/io.openems.backend.runtime.events/src/io/openems/backend/runtime/events/{RuntimeEventProducer,BoundedEventQueue,EventWriter,GapAccumulator,CoverageCheckpoint}.java`
- Create: `openems-adapters/patches/0003-runtime-events.patch`
- Create: `ocms/tenant-jdbc/src/main/resources/db/migration/common/V7__runtime_events.sql`
- Test: `openems-adapters/io.openems.backend.runtime.events/test/io/openems/backend/runtime/events/BoundedEventQueueTest.java`、`EventWriterFaultTest.java`

**Interfaces:**
- Consumes: ADR-002（采用 Backend 挂点）；`platform-contracts` 的 `RuntimeEvent`、`RuntimeGap`。
- Produces: `integration.runtime_event`、`integration.runtime_delivery`、`integration.runtime_gap` 表中的记录；运行摘要与对应事件同一事务写入。

- [ ] **Step 1：写失败测试。**

```java
@Test
void fullQueueRejectsWithoutBlockingAndRecordsGap() {
    var queue = new BoundedEventQueue(2, 32 * 1024 * 1024);
    queue.offer(event(1));
    queue.offer(event(2));
    var accepted = assertTimeoutPreemptively(Duration.ofMillis(50), () -> queue.offer(event(3)));
    assertThat(accepted).isFalse();
    assertThat(gaps.current()).extracting(RuntimeGap::reason).contains(GapReason.QUEUE_OVERFLOW);
}

@Test
void unknownCommitIsRetriedWithSameEventId() {
    db.failNextCommitAfterWrite();
    writer.flush(List.of(event(1)));
    writer.flush(List.of(event(1)));
    assertThat(db.count("integration.runtime_event")).isEqualTo(1);
}
```

  另写：`eventLargerThan16KiBIsRejectedAsGap`、`dbOutageForTenMinutesKeepsMemoryBounded`、`abnormalRestartCreatesConservativeGapFromLastCheckpoint`、`summaryAcceptsOnlyNewerEpochOrSequence`、`acceptThreadNeverRunsJdbc`。
- [ ] **Step 2：运行确认失败。** Run: `openems-adapters/scripts/build.sh :io.openems.backend.runtime.events:test`；Expected: FAIL。
- [ ] **Step 3：实现。** 按第 4.1 节：每个活动 Backend 一个有界 FIFO 队列和一个写入 worker；资产内分配 `asset_sequence`；独立连接池；批量事务；相同 `event_id` 重试；固定大小的每集群 gap 累加器；覆盖检查点。连接、汇总状态和选定状态通道事件走同一规范化接口。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2；Expected: PASS。
- [ ] **Step 5：提交。** `git add openems-adapters ocms/tenant-jdbc && git commit -m "feat(adapter): add bounded runtime event producer with gap tracking"`

**退出条件：** 只对已持久化的事件承诺可重放；无法重建的区间有明确记录。

### Task T09B：OCMS 运行事件消费

**Files:**
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/runtime/{RuntimeEventConsumer,RuntimeInbox,SnapshotReconciler}.java`
- Create: `ocms/ocms-server/src/main/resources/db/migration/ocms/V2__runtime_inbox.sql`
- Test: `ocms/ocms-server/src/test/java/io/ocms/server/runtime/RuntimeEventConsumerIT.java`

**Interfaces:**
- Consumes: T09A 的 `integration.runtime_event` / `runtime_delivery` / `runtime_gap`；T07 的 `TelemetryCache`（当前状态对账）。
- Produces: `RuntimeEventConsumer` 回调 `AlarmEngine.onRuntimeEvent(RuntimeEvent)` 与 `AlarmEngine.onGap(RuntimeGap)`（接口在本任务定义，T10 实现）；`ocms.runtime_inbox(event_id PRIMARY KEY)`。

- [ ] **Step 1：写失败测试。**

```java
@Test
void ackHappensOnlyAfterBusinessTransactionCommits() {
    alarmEngine.failNextTransaction();
    consumer.pollOnce();
    assertThat(delivery.isAcked(EVENT_1)).isFalse();
    consumer.pollOnce();
    assertThat(delivery.isAcked(EVENT_1)).isTrue();
    assertThat(db.count("ocms.runtime_inbox")).isEqualTo(1);
}

@Test
void staleEventDoesNotMarkNewConnectionOffline() {
    consumer.handle(connected(ASSET, epoch(2), seq(1)));
    consumer.handle(disconnected(ASSET, epoch(1), seq(9)));
    assertThat(state.isOnline(ASSET)).isTrue();
}
```

  另写：`sequenceGapTriggersReconcile`、`replayAfterOcmsDowntimeRebuildsHistoricOccurrences`、`lostAckReplaysWithoutDuplicates`。
- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml -pl ocms-server -am verify -Dit.test=RuntimeEventConsumerIT`；Expected: FAIL。
- [ ] **Step 3：实现。** inbox 去重、告警变化与通知 outbox 在 OCMS 同一业务事务提交后再确认公共库投递；资产内按 `producer_epoch` + `asset_sequence` 顺序；缺口触发当前快照对账。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2；Expected: PASS。
- [ ] **Step 5：提交。** `git commit -m "feat(runtime): consume persisted runtime events with inbox and reconcile"`

**退出条件：** 重复、乱序、确认丢失都不产生重复业务周期；OCMS 停机后可补建历史周期。

### Task T10：规则版本、告警与通知

**Files:**
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/alarm/{AlarmEngine,AlarmRuleService,RuleVersion,DebounceWindow,OccurrenceRepository}.java`
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/notification/{NotificationOutbox,SmtpSender,InAppNotifier}.java`
- Create: `ocms/ocms-server/src/main/resources/db/migration/ocms/V3__alarms_notifications.sql`
- Create: `ocms/ocms-web/src/views/alarm/{AlarmCenterView,AlarmRuleEditor}.vue`
- Test: `ocms/ocms-server/src/test/java/io/ocms/server/alarm/{DebounceWindowTest,RuleVersionSwitchIT}.java`

**Interfaces:**
- Consumes: T07 的 `TelemetrySample` 与 `Quality`；T09B 的 `AlarmEngine` 回调接口。
- Produces: `AlarmOccurrence`；`POST /api/v1/alarm-rules`、`POST /api/v1/alarm-rules/{id}/versions`、`POST /api/v1/alarms/{id}/ack`；通知幂等键 `occurrence_id + kind + channel`。

- [ ] **Step 1：写失败测试。**

```java
@Test
void staleSampleClearsPendingWindow() {
    var w = new DebounceWindow(Duration.ofSeconds(30));
    w.accept(good(T0, 60));
    w.accept(stale(T0.plusSeconds(10)));
    w.accept(good(T0.plusSeconds(31), 60));
    assertThat(w.isSatisfied()).isFalse();
}

@Test
void editingRuleDoesNotFakeRecovery() {
    var occ = engine.trigger(RULE_V1, ASSET);
    rules.publishVersion(RULE, v2());
    var old = occurrences.get(occ);
    assertThat(old.signal()).isEqualTo(SignalState.UNKNOWN);
    assertThat(old.recoveredAt()).isNull();
    assertThat(old.endReason()).isEqualTo(EvaluationEndReason.SUPERSEDED);
}
```

  另写：`sameSourceSampleRepeatedDoesNotAdvanceWindow`、`newVersionStartsFreshWindowAndLinksSupersededOccurrence`、`replayUsesRuleVersionEffectiveAtEventTime`、`recoveredHistoricCycleIsNotNotifiedInRealTime`、`stillActiveAfterRecoveryNotifiesOnceAsLateDiscovery`、`unknownSendResultIsRecordedAsPossibleDuplicate`、`dataMissingRuleFiresWhenChannelStaysNull`。
- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml -pl ocms-server -am verify -Dtest=DebounceWindowTest -Dit.test=RuleVersionSwitchIT`；Expected: FAIL。
- [ ] **Step 3：实现。** 原生状态、离线、阈值、数据质量四类规则，按第 4.2、4.3 节处理质量、时间、防抖和版本；规则编辑与逻辑切换事件同一业务事务提交；站内通知与 SMTP 邮件 outbox，重试使用相同逻辑幂等键。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2，并运行 `pnpm --dir ocms/ocms-web test`；Expected: PASS。
- [ ] **Step 5：提交。** `git commit -m "feat(alarm): add versioned rules, quality-aware debounce and notifications"`

**退出条件：** 规则变更不伪造恢复；告警与通知满足第 4 节状态语义。

### Task T11：工单、附件与业务指标

**Files:**
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/workorder/{WorkOrderService,WorkOrderStateMachine,WorkOrderAlarmLink}.java`
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/attachment/{AttachmentStore,AttachmentController}.java`
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/workorder/MetricsService.java`
- Create: `ocms/ocms-server/src/main/resources/db/migration/ocms/V4__work_orders.sql`
- Create: `ocms/ocms-web/src/views/workorder/{WorkOrderListView,WorkOrderDetailView}.vue`
- Test: `ocms/ocms-server/src/test/java/io/ocms/server/workorder/{WorkOrderStateMachineTest,WorkOrderIT}.java`

**Interfaces:**
- Consumes: T10 的 `AlarmOccurrence`；T04A 的会话与角色。
- Produces: `POST /api/v1/work-orders`、`POST /api/v1/work-orders/{id}/transitions`、`POST /api/v1/attachments`、`GET /api/v1/attachments/{id}`；`MetricsService.mtta(...)`、`mttrSignal(...)`、`closeDuration(...)`。

- [ ] **Step 1：写失败测试。**

```java
@Test
void verifyingCannotCloseWhileSignalUnknown() {
    var wo = workOrders.openFor(List.of(OCC_UNKNOWN));
    workOrders.transition(wo, ASSIGNED, IN_PROGRESS, VERIFYING);
    assertThatThrownBy(() -> workOrders.autoAccept(wo)).hasMessageContaining("signal UNKNOWN");
}

@Test
void attachmentPathTraversalIsRejected() {
    var res = upload("../../etc/passwd", BYTES, tenantAToken);
    assertThat(res.status()).isEqualTo(400);
}
```

  另写：`concurrentAssignmentHasOneWinner`、`illegalTransitionIsRejected`、`manualCloseRequiresReasonAndIsAudited`、`crossTenantAttachmentIsForbidden`、`ruleReplacementKeepsWorkOrderLink`、`truncatedCyclesAreExcludedFromSignalMttr`。
- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml -pl ocms-server -am verify -Dtest=WorkOrderStateMachineTest -Dit.test=WorkOrderIT`；Expected: FAIL。
- [ ] **Step 3：实现。** 状态机与角色、revision 校验；一个工单关联同租户多个告警；旧规则版本被替换不自动关闭工单或解除关联；附件路径由服务端生成，读取和下载重新授权；MTTA = 首次确认 − 首次发生；信号 MTTR = 有证据的恢复 − 发生；规则替换或停用且无恢复证据的周期单独统计为截断周期；工单关闭耗时另算。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2，并运行 `pnpm --dir ocms/ocms-web test`；Expected: PASS。
- [ ] **Step 5：提交。** `git commit -m "feat(workorder): add work order lifecycle, attachments and metrics"`

**退出条件：** 从故障到通知、派单、处理、验收和审计全程可追溯。

### Task T03B：迁移工具——冻结切换与反向同步（M3）

**Files:**
- Create: `ocms/ocms-server/src/main/java/io/ocms/server/migration/{FinalizeCommand,ReverseSyncCommand,VerifyCommand,RevocationGuard}.java`
- Test: `ocms/ocms-server/src/test/java/io/ocms/server/migration/CutoverAndRollbackIT.java`

**Interfaces:**
- Consumes: T03A 的映射表与 `MigrationManifest`；T06 的撤销记录。
- Produces: 子命令 `finalize`、`reverse`、`verify`；与 T03A 合计六个子命令。

- [ ] **Step 1：写失败测试。**

```java
@Test
void rollbackAfterWritesKeepsRevocations() {
    cutover.finalizeWithFreeze();
    ocms.revokeCredential(ASSET, 1);
    var result = cli.run("reverse", "--run-id", RUN_R);
    assertThat(result.status()).isEqualTo("OK");
    assertThat(legacyDb.isApiKeyActive(ASSET_SOURCE_ID, KEY_V1)).isFalse();
}

@Test
void nonRepresentableRecordFailsRollbackInsteadOfDroppingIt() {
    ocms.createTenantHierarchyDeeperThanLegacySupports();
    assertThat(cli.run("reverse", "--run-id", RUN_R).status()).isEqualTo("FAILED_STAY_IN_MAINTENANCE");
}
```

  另写：`lastChangeBeforeFreezeIsIncluded`、`verifyComparesCountsReferencesAndCredentialVersions`。
- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml -pl ocms-server -am verify -Dit.test=CutoverAndRollbackIT`；Expected: FAIL。
- [ ] **Step 3：实现。** 切换时冻结旧公共管理写入口与源权限修改，完成最终全量差异与数量、引用、凭据校验后再切换 Metadata；运行状态不纳入管理冻结。写入后回滚：冻结新管理写 → 抽取切换后的完整变更 → 转换为旧库可接受的结构 → 应用撤销清单 → 再校验；不能无损反向表达的记录使回滚失败并保持维护态。凭据撤销审计独立备份，恢复前与旧快照比对。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2；Expected: PASS。
- [ ] **Step 5：提交。** `git commit -m "feat(migration): add finalize, reverse sync and verify with revocation guard"`

**退出条件：** 冻结前最后一次变更与写入后回滚均可重跑验证。

### Task T12：试运行、切换与回滚演练

**Files:**
- Create: `deploy/ocms/{application-prod.yaml.tmpl,nginx-tls.conf.tmpl,backup-restore.md,cutover-runbook.md,rollback-runbook.md}`
- Create: `docs/ocms/acceptance-report-template.md`
- Test: `ocms/acceptance-tests/src/test/java/io/ocms/acceptance/{LoadIT,FaultInjectionIT,CutoverDrillIT}.java`

**Interfaces:**
- Consumes: 全部前序任务的制品；`acceptance-config.yaml`。
- Produces: 版本化发布包；按第 5 节填写的验收报告（含硬件、负载、版本和实际瓶颈）。

- [ ] **Step 1：写失败的验收测试。** `LoadIT` 读取 `acceptance-config.yaml` 的基准负载并断言第 5 节时延门限；`FaultInjectionIT` 覆盖第 5 节“事件故障”“写库恢复”“REST 过载”；`CutoverDrillIT` 按“管理写冻结 → 最终差异 → 备份 → Metadata 切换 → 接入与权限核验 → 管理放开 → 告警、通知、工单逐步开放”执行，并分别演练放开写入前与放开写入后的回滚。
- [ ] **Step 2：运行确认失败。** Run: `./mvnw -f ocms/pom.xml -pl acceptance-tests verify -Pacceptance`；Expected: FAIL（环境与发布包尚未就绪）。
- [ ] **Step 3：准备环境与制品。** 用 T03A/T03B 工具完成测试迁移和只读对照；准备配置模板、秘密注入、反向代理 TLS、备份恢复与告警面板；生产切换作为单独的受控操作，不在本任务执行。
- [ ] **Step 4：运行确认通过。** 重跑 Step 2；Expected: PASS；把结果写入验收报告。
- [ ] **Step 5：提交。** `git add deploy/ocms docs/ocms ocms/acceptance-tests && git commit -m "test(acceptance): add load, fault and cutover drills with runbooks"`

**退出条件：** 发布包、可重复的验收报告、迁移映射、权限复核、备份恢复和回滚证据齐全；业务负责人确认试点结果后再安排生产发布。

## 4. 确定性补充规则

### 4.1 事件写入与故障边界（T09A）

- 每个活动 Backend 一个有界 FIFO 队列和一个写入 worker；事件在资产锁内分配 `asset_sequence` 后入队，跨资产不要求全局有序。大配置事件只含引用和哈希，完整配置走独立快照写入。
- 测试默认双限额 10,000 条 / 32 MiB，先触及者为准；单条规范化事件不超过 16 KiB。超限拒绝入队，不阻塞采集，不丢弃已排队事件；拒绝结果计入 gap。
- 独立事件连接池默认 2 个连接；单批最多 200 条或等待 100 ms；获取连接与语句超时默认 2 秒。失败以相同 `event_id` 重试，退避 1、2、4、8、16、30 秒并加抖动，不无限增加在途批次。
- 运行摘要与对应事件同一事务写入，摘要只接受更新的代次或序号。提交结果未知时重试相同事件，不重新编号。
- 溢出时在固定大小的每集群 gap 累加器记录最早与最晚受影响时间，恢复后优先持久化 `RuntimeGap`；按集群扩大未知范围，不为每次丢失分配内存。
- 每 5 秒（测试默认）保存覆盖检查点；只有检查点前已接受的事件全部持久化且丢失区间已记录时才推进。异常启动时，从最后检查点到新启动完成建立保守缺口。
- 数据库失联期间没有持久化能力，内存 gap 也可能丢失；重启缺口从旧检查点推导，保证不误报完整。首期不增加磁盘 WAL，允许有明确标记的事件损失。

### 4.2 新鲜度与持续阈值（T07、T10）

- `ChannelContract.reportMode` 区分 `PERIODIC`、`CHANGE_ONLY`、`UNKNOWN`。`PERIODIC` 只有源采样时间或 Backend 实际收到该通道样本的时间可作为新鲜度证据（`TimeEvidence.SOURCE_TIMESTAMP` / `BACKEND_RECEIVED`）。
- 新鲜度默认上限为 `max(3 × 约定上报间隔, 10 秒)`，按 ADR-006 验证后写入 `channel-catalog.yaml`。重复的 B2B 缓存快照只更新 `receivedAt`，不更新源证据时间。
- `CHANGE_ONLY` 只有经过验证的采集质量与有效期，或读取到设备当前采样值的主动查询，才能维持 `GOOD`；普通缓存读取和连接心跳不算新证据。缺少证据为 `UNKNOWN`，不能用于持续阈值判定。
- 数值非法为 `INVALID`；已有可靠样本超过新鲜度上限为 `STALE`；证据不足为 `UNKNOWN`。只有 `GOOD` 可推进触发或恢复防抖。
- 阈值规则定义为离散有效样本下的持续超限：至少两个有序源观测，间隔不超过约定上限，覆盖配置的防抖时间；同一源样本的重复快照不推进窗口。该规则不证明样本之间不存在物理瞬态。
- `UNKNOWN`、`STALE`、`INVALID`、连接代次变化和 gap 均清空未完成窗口；已活动告警保留未恢复事实并把信号转为 `UNKNOWN`；重新获得 `GOOD` 后建立新的触发或恢复窗口。

### 4.3 规则变更与活动告警（T10、T11）

- `rule_id` 稳定；版本不可变，有效区间不重叠；唯一活动评估键为 `(tenant_id, asset_id, rule_id, rule_version, channel)`。
- 规则修改或禁用时停止旧版本评估，记录 `evaluation_end_reason = SUPERSEDED / DISABLED` 与结束时间，信号转 `UNKNOWN` 并保留 `last_known_signal`；不设置 `recovered_at`，不自动关闭处置状态或工单。
- 新版本重新建立防抖窗口，不继承旧版本累计时长；满足触发条件后创建新 occurrence，并以 `supersedes_occurrence_id` 关联旧周期；每个新版本周期只发送一次标注“规则变更后触发”的通知，旧周期不发送恢复通知。
- 旧周期可由授权人员以“规则替换/停用”结案，但这不算设备恢复。历史重放只在旧版本有效区间内评估；迟到证据可修正该区间的历史并记录修订，不延长旧规则有效区间。
- 计时排序优先使用可信的 `occurredAt`，否则用 `observedAt`；`asset_sequence` 用于资产内顺序。来源时间倒退或不可信时标记质量问题，不用异常时间计算 MTTA / MTTR。

## 5. 验收矩阵、通过阈值与发布门禁

### 5.1 测试默认配置

以下是 T01 写入 `acceptance-config.yaml` 的初始值，用于建立可执行门禁，不是生产容量承诺。确需调整时保留变更理由并在开发前冻结，不能在测试失败后直接降低门槛。

| 项目 | 初始配置 / 通过条件 |
| --- | --- |
| 基准负载 | 100 个模拟资产，每资产 50 通道，每 2 秒一个样本；20 个门户连接；连续 60 分钟 |
| 历史查询 | 5 个并发查询，每次 1 资产 / 10 通道 / 7 天 / 5 分钟聚合，输出点数受限 |
| 时延 | 源观测可用时门户端到端 p95 ≤ 5 秒；历史查询 p95 ≤ 5 秒；告警不含防抖的附加延迟 p95 ≤ 5 秒 |
| 元数据生效 | 健康环境下所有必需目标 p95 ≤ 10 秒；任一目标未确认不得为 `APPLIED` |
| 事件故障 | 运行负载下数据库失联 10 分钟并注入队列溢出；缓冲不超过配置的条数与字节上限；采集与 Edge 心跳继续 |
| 写库恢复 | 数据库恢复后 60 秒内恢复提交并显示缺口；固定 10,000 条积压 5 分钟内排空；无重复业务周期 |
| 瞬态故障 | 只对 Backend 实际收到并持久化的发生与恢复变化验收重放；两次 B2B 快照之间上游遗漏的变化不计入承诺 |
| REST 过载（修复制品可用） | 客户端有界超时；服务端等待有界；压力解除 60 秒内服务恢复、线程占用回落；无无限重试 |
| REST 过载（修复制品未通过） | 生产 `ocms.history.api-compare.enabled=false`；验收证明 OCMS 不向 B2B REST 发出历史查询，常规历史只走直查 |
| 通道可用性 | 按开局模板上线的测试 Edge，`channel-catalog.yaml` 中告警引用的通道在稳态下非 `null` 比例 100% |
| 恢复与回滚 | 测试环境从备份到可查询、可鉴权的恢复目标 30 分钟；已提交的凭据撤销不因恢复丢失 |

门户、数据库和日志中不得出现完整密码或密钥。平台监控至少包含：各级应用时延、队列占用与拒绝数、gap、事件积压、陈旧通道数、通知失败、数据库等待。

### 5.2 需求与验收归属

| 验收场景 | 责任任务 | 通过证据 |
| --- | --- | --- |
| 提交后退出、应用后确认前退出、快照并发写 | T04B / T05 | 事件不漏投，重复无副作用，版本不回退 |
| 网关未确认、现场未迁移、截止期与紧急撤销 | T06 | 操作状态、凭据版本握手、旧连接断开与重连拒绝 |
| 正常心跳但通道停更、重复快照、null 与乱序 | T07 / T10 | 源证据不被刷新；质量与防抖转换断言 |
| 告警所用通道在开局后非 null | T04B / T07 | 开局模板含 `persistencePriority`；通道可用性门禁通过 |
| 同名 Edge、数字标签冲突、夏令时与累计量重置 | T04B / T08 | 身份与存储不串用；固定历史样本对照 |
| 公共库与业务库租户隔离、连接池复用 | T02 / T04B / T11 | 负向 API、SQL、附件与 WebSocket 测试 |
| 长时间数据库不可用、满队列、强杀与未知提交 | T09A | 采集存活、缓冲有上限、重复去重、保守 gap |
| 停机期间先故障后恢复、同等级故障变化 | T09B / T10 | 历史周期完整；当前状态不被旧事件覆盖 |
| 规则修改、禁用、重放与通知结果未知 | T10 / T11 | 无伪恢复、无重复周期、工单保留、发送证据可审计 |
| 旧源撤权与删除、最终同步、写入后回滚 | T03A / T03B / T12 | 映射与差异报告、访问拒绝、撤销清单校验 |
| B2B REST 队列打满与压力解除（设计验收场景 15） | T08 / T12 | 按 ADR-004 的两条分支之一通过 |

设计中的控制请求 `UNKNOWN` 验收属于下一期；首期以“控制入口不可调用、没有控制服务凭据常驻使用”作为范围验收，不宣称该能力已经完成。

发布顺序：测试环境 → 只读试点 → 管理切换 → 告警与通知 → 工单。每个门禁须有测试结果与失败归因；未达标保留为未完成，“已编写测试”不等于“已通过”。

## 6. 修订记录

| 版本 | 变更 |
| --- | --- |
| 1.1 | 补齐事件背压、规则版本切换、新鲜度、现场密钥迁移、迁移与回滚工具、M0 契约与验收阈值 |
| 1.2 | 按 writing-plans 规范重排：标准文件头与全局约束（逐条注明设计出处）；新增文件结构与带类型的共享契约；每个任务补齐 Files、Interfaces、测试优先步骤、运行命令与预期结果、提交步骤；把 T03、T04、T09 各拆为两个任务；把原先推迟的决策改为 T01 输出的 ADR-001 至 ADR-006 并给出默认方案；补齐与设计 v2.2 的三处缺口：开局模板显式设置 `persistencePriority`、ADR-002 记录状态通道事件来源的阶段 0 选择、设计验收场景 15 在修复制品未通过时的门禁 |

完成本文只代表开发计划已补齐；代码、环境能力、性能和生产切换均须按对应任务另行实现与验证。
