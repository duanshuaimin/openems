/**
 * Dynatrace-Style Smartscape Full-Stack Interactive Topology Engine (v3.0 Production)
 * Core Capabilities:
 *   1. Generic Tree & Indexed Graph Model (O(1) Map lookups, 197 Nodes, 261 Edges including 16S cell chains)
 *   2. 6-Level Hierarchical Drill-Down (L0 Fleet -> L1 Cabinet -> L2 Rack -> L3 Module -> L4 160 Cells -> L5 Cell RC Micro-Twin)
 *   3. Bottom-Up Mathematical Roll-Up (∑Sum, μMean, Dynamic Max/Min Pinpointing, ΔSpread, True Worst-of-Children Status Propagation)
 *   4. Dynatrace Edge Roll-Up (Projects hidden child edges onto nearest visible ancestor container & merges parallel links)
 *   5. Real InfluxDB v2 + Edge REST Telemetry Pipeline with Multi-Station (?station=bms|0..4) & Per-Node 30s Sparkline History
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartscapeEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ----------------------------------------------------
  // Tier Definitions
  // ----------------------------------------------------
  const TIERS = [
    { id: 'fleet', name: 'Fleet Stations', cnName: '多站集群层', icon: '🌍', color: '#38bdf8', y: 420 },
    { id: 'app', name: 'Applications', cnName: '业务调度层', icon: '🌐', color: '#00d2ff', y: 90 },
    { id: 'ctrl', name: 'Control Plane', cnName: '控制中枢层', icon: '⚙️', color: '#a855f7', y: 240 },
    { id: 'sys', name: 'Systems & Cabinets', cnName: '系统储能柜层', icon: '🏢', color: '#10b981', y: 410 },
    { id: 'array', name: 'DC Arrays & Racks', cnName: '阵列与电池簇层', icon: '⚡', color: '#f59e0b', y: 600 },
    { id: 'mod', name: 'Battery Modules', cnName: '串联模组层', icon: '🧱', color: '#ec4899', y: 800 },
    { id: 'cell', name: 'Battery Cells', cnName: '单体电芯层', icon: '🔬', color: '#06b6d4', y: 1030 }
  ];

  const TIER_BY_ID = new Map(TIERS.map(t => [t.id, t]));

  const DEPTH_DESCRIPTIONS = {
    0: 'L0: 集团车队上卷态 (Fleet Roll-Up)',
    1: 'L1: 储能柜系统上卷态 (Cabinet Roll-Up)',
    2: 'L2: 高压电池簇上卷态 (Rack Roll-Up)',
    3: 'L3: 10模组聚合态 (Module Roll-Up)',
    4: 'L4: 160电芯全展开态 (Full 160-Cell Unroll)',
    5: 'L5: 电芯内部二阶RC微观下钻 (Cell Micro Twin)'
  };

  const SEVERITY_RANK = { normal: 0, warning: 1, critical: 2 };
  const RANK_TO_STATUS = ['normal', 'warning', 'critical'];

  function maxSeverityStatus(statuses) {
    let maxRank = 0;
    for (let i = 0; i < statuses.length; i++) {
      const r = SEVERITY_RANK[statuses[i]] || 0;
      if (r > maxRank) maxRank = r;
    }
    return RANK_TO_STATUS[maxRank];
  }

  function statusToBadgeText(status, contextLabel) {
    if (status === 'critical') return `🔴 严重越限告警 (${contextLabel})`;
    if (status === 'warning') return `🟡 含极值/均衡预警 (${contextLabel})`;
    return `🟢 全量正常 (${contextLabel})`;
  }

  // ----------------------------------------------------
  // Station Metadata Profiles (for multi-station switching)
  // ----------------------------------------------------
  const STATION_PROFILES = {
    'bms': { id: 'station-bms', name: 'BMS 虚拟高压站 (Pylontech M2)', icon: '⚡', capacityKwh: 100, ratedKw: 100, racks: 1, mods: 10, cells: 160 },
    '0':   { id: 'station-edge0', name: '园区光储充微电网 (edge0)', icon: '🏭', capacityKwh: 1000, ratedKw: 500, racks: 1, mods: 10, cells: 160 },
    '1':   { id: 'station-edge1', name: '重工业削峰填谷站 (edge1)', icon: '🏗️', capacityKwh: 2000, ratedKw: 1000, racks: 2, mods: 10, cells: 160 },
    '2':   { id: 'station-edge2', name: '电网侧独立调频站 (edge2)', icon: '🗼', capacityKwh: 4000, ratedKw: 2000, racks: 4, mods: 10, cells: 160 },
    '3':   { id: 'station-edge3', name: '商业综合体VPP站 (edge3)', icon: '🏬', capacityKwh: 400, ratedKw: 200, racks: 1, mods: 10, cells: 160 },
    '4':   { id: 'station-edge4', name: '海岛离网微电网 (edge4)', icon: '🏝️', capacityKwh: 250, ratedKw: 125, racks: 1, mods: 10, cells: 160 }
  };

  // ----------------------------------------------------
  // Global State
  // ----------------------------------------------------
  const state = {
    mode: 'smartscape',       // 'smartscape' | 'powerflow' | 'controlcomm' | 'bess'
    rollupDepth: 3,           // 0: Fleet, 1: Cabinet, 2: Rack, 3: Module (default), 4: All 160 Cells, 5: Cell RC Micro-Twin
    expandedContainers: new Set(['station-bms', 'sys-cabinet', 'arr-rack', 'mod-01']),
    savedL3Modules: ['mod-01'], // Preserves user's expanded modules across L3 <-> L4 switches
    focusedMicroCellId: null,
    activeTier: null,
    selectedNode: null,
    hoveredNode: null,
    searchQuery: '',
    station: 'bms',
    scale: 0.82,
    panX: 90,
    panY: 20,
    targetScale: null,
    targetPanX: null,
    targetPanY: null,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    animTime: 0,
    particlePhase: 0,
    isPolling: false,
    connHealthy: true,
    lastSyncTime: null,
    telemetry: {
      voltage: 528.0,
      current: 15.0,
      soc: 69.0,
      soh: 99,
      cycleCount: 185,
      powerKw: 7.9,
      dcPowerKw: 7.9,
      gridPowerKw: 95.0,
      pvPowerKw: 78.0,
      loadPowerKw: 80.5,
      maxCellV: 3317,
      minCellV: 3287,
      maxCellNo: 14,
      minCellNo: 3,
      maxCellT: 25.6,
      minCellT: 22.4,
      maxTempNo: 95,
      minTempNo: 1,
      deltaV: 30,
      deltaT: 3.2,
      insulation: 10000,
      hvacStatus: 1,
      ambientT: 23.5,
      rteEfficiency: 92.5,
      chargeMaxA: 120,
      dischargeMaxA: 140,
      modulesV: Array(10).fill(52.8),
      modulesT: Array(10).fill(24.0),
      cellsV: Array(160).fill(3300),
      cellsT: Array(160).fill(24.0),
      fleetLive: {
        'bms': { powerKw: 7.9, soc: 69.0 },
        '0':   { powerKw: -0.1, soc: 94.0 },
        '1':   { powerKw: 175.3, soc: 15.0 },
        '2':   { powerKw: -708.1, soc: 49.0 },
        '3':   { powerKw: 40.0, soc: 95.0 },
        '4':   { powerKw: 18.4, soc: 10.0 }
      }
    },
    nodeHistory: new Map() // nodeId -> { label: string, unit: string, values: number[] }
  };

  // Initialize deterministic realistic fallback distribution prior to first InfluxDB poll
  for (let i = 0; i < 160; i++) {
    const cNo = i + 1;
    let offset = Math.round(Math.sin(cNo * 0.7) * 6 + Math.cos(cNo * 1.3) * 4);
    if (cNo === 14) offset = 17;
    if (cNo === 3) offset = -13;
    state.telemetry.cellsV[i] = 3300 + offset;

    const mIdx = Math.floor(i / 16);
    const modHeat = 0.8 * Math.sin((mIdx / 9.0) * Math.PI);
    let tOffset = modHeat + Math.sin(cNo * 0.5) * 0.4;
    if (cNo === 95) tOffset = 1.6;
    if (cNo === 1) tOffset = -1.6;
    state.telemetry.cellsT[i] = +(24.0 + tOffset).toFixed(1);
  }

  // ----------------------------------------------------
  // O(1) Indexed Graph & Tree Structures
  // ----------------------------------------------------
  const nodes = [];
  const edges = [];
  const microNodes = [];
  const microEdges = [];

  const nodeById = new Map();
  const childrenById = new Map();
  const inEdgesById = new Map();
  const outEdgesById = new Map();
  const adjById = new Map();
  const descendantCache = new Map();

  // Cached per-state sets (recomputed only when state changes, never per-frame)
  const visibleNodeIds = new Set();
  const lineageNodeIds = new Set();
  let effectiveEdges = [];

  function pushNodeHistory(nodeId, label, unit, val) {
    if (typeof val !== 'number' || Number.isNaN(val)) return;
    let entry = state.nodeHistory.get(nodeId);
    if (!entry) {
      entry = { label, unit, values: Array(29).fill(val) };
      state.nodeHistory.set(nodeId, entry);
    }
    entry.label = label;
    entry.unit = unit;
    entry.values.push(val);
    if (entry.values.length > 30) entry.values.shift();
  }

  function activeStationNodeId() {
    const prof = STATION_PROFILES[state.station] || STATION_PROFILES['bms'];
    return prof.id;
  }

  function buildGraphData() {
    nodes.length = 0;
    edges.length = 0;
    nodeById.clear();
    childrenById.clear();
    inEdgesById.clear();
    outEdgesById.clear();
    adjById.clear();
    descendantCache.clear();

    const activeStId = activeStationNodeId();
    const activeProf = STATION_PROFILES[state.station] || STATION_PROFILES['bms'];

    // --- Tier 0: Fleet Stations (6 Macro Nodes) ---
    const stationKeys = ['bms', '0', '1', '2', '3', '4'];
    stationKeys.forEach((sKey, idx) => {
      const p = STATION_PROFILES[sKey];
      const live = state.telemetry.fleetLive[sKey] || { powerKw: 0, soc: 50 };
      nodes.push({
        id: p.id,
        stationKey: sKey,
        name: p.name,
        tier: 'fleet',
        icon: p.icon,
        x: 240 + idx * 315,
        y: 420,
        type: 'fleet-station',
        status: 'normal',
        isExpandable: true,
        powerPath: true,
        capacityKwh: p.capacityKwh,
        ratedKw: p.ratedKw,
        powerKw: live.powerKw,
        soc: live.soc,
        metrics: `${live.powerKw >= 0 ? '+' : ''}${live.powerKw.toFixed(1)}kW | SOC ${live.soc.toFixed(0)}%`
      });
    });

    // --- Tier 1: Applications (5 Nodes) ---
    nodes.push(
      { id: 'app-vpp', name: 'VPP 虚拟电厂多能聚合', tier: 'app', icon: '☁️', x: 260, type: 'app', status: 'normal', metrics: '参与电力现货 12.5MW' },
      { id: 'app-peakshaving', name: '需量控制与削峰填谷', tier: 'app', icon: '📉', x: 600, type: 'app', status: 'normal', metrics: '目标阈值 750kW' },
      { id: 'app-balancing', name: '自发自用与防逆流平衡', tier: 'app', icon: '⚖️', x: 950, type: 'app', status: 'normal', metrics: '并网点残差 < 50W' },
      { id: 'app-evcs', name: '智能充电桩群控协同', tier: 'app', icon: '🚗', x: 1300, type: 'app', status: 'normal', metrics: '有序充电 60kW' },
      { id: 'app-spot', name: '日前预测与微网经济性', tier: 'app', icon: '📈', x: 1640, type: 'app', status: 'normal', metrics: '日前电价 1.25元/kWh' }
    );

    // --- Tier 2: Control Plane (5 Nodes) ---
    nodes.push(
      { id: 'ctrl-mpc', name: 'MPC 模型预测控制引擎', tier: 'ctrl', icon: '🔮', x: 240, type: 'service', status: 'normal', metrics: '滚动时域优化 24h' },
      { id: 'ctrl-edge', name: `OpenEMS Edge (${state.station})`, tier: 'ctrl', icon: '🧠', x: 620, type: 'service', status: 'normal', metrics: '周期 1000ms | 0死锁' },
      { id: 'ctrl-backend', name: 'OpenEMS Backend 路由网关', tier: 'ctrl', icon: '🌐', x: 1000, type: 'service', status: 'normal', metrics: 'WSS 8084 隧道穿透' },
      { id: 'ctrl-influx', name: 'InfluxDB v2 时序持久化', tier: 'ctrl', icon: '📊', x: 1360, type: 'service', status: 'normal', metrics: 'Flux 引擎 | 2s落库' },
      { id: 'ctrl-metadata', name: 'Odoo ERP 设备元数据', tier: 'ctrl', icon: '💼', x: 1700, type: 'service', status: 'normal', metrics: 'PostgreSQL HikariCP' }
    );

    // --- Tier 3: Systems & Cabinets (6 Nodes, Children of active Fleet Station) ---
    nodes.push(
      { id: 'sys-grid', name: '10kV 园区进线并网关口', tier: 'sys', icon: '🗼', x: 200, type: 'system', status: 'normal', parentId: activeStId, powerPath: true, metrics: '380V/50.01Hz | 95kW' },
      { id: 'sys-pv', name: '屋顶分布式光伏阵列', tier: 'sys', icon: '☀️', x: 500, type: 'system', status: 'normal', parentId: activeStId, powerPath: true, metrics: '日照 850W/m² | 78kW' },
      {
        id: 'sys-cabinet',
        name: `${activeProf.ratedKw}kW/${activeProf.capacityKwh}kWh 储能一体柜`,
        tier: 'sys',
        icon: '🏢',
        x: 880,
        type: 'cabinet-container',
        status: 'normal',
        parentId: activeStId,
        isExpandable: true,
        powerPath: true,
        metrics: '液冷恒温 23.5℃ | RTE 92.5%'
      },
      { id: 'sys-pcs', name: `${activeProf.ratedKw}kW PCS 双向储能变流器`, tier: 'sys', icon: '⚡', x: 1240, type: 'system', status: 'normal', parentId: activeStId, powerPath: true, metrics: '效率 98.2% | cosφ 0.99' },
      { id: 'sys-load-hvac', name: '工业暖通冷水机房电表', tier: 'sys', icon: '❄️', x: 1540, type: 'system', status: 'normal', parentId: activeStId, powerPath: true, metrics: '负荷 32.5 kW' },
      { id: 'sys-load-machinery', name: '车间主生产线动力电表', tier: 'sys', icon: '🏭', x: 1800, type: 'system', status: 'normal', parentId: activeStId, powerPath: true, metrics: '负荷 48.0 kW' }
    );

    // --- Tier 4: DC Arrays & Racks (4 Nodes, Children of sys-cabinet) ---
    nodes.push(
      { id: 'arr-hvbox', name: '高压继电器盒 (DC Breaker)', tier: 'array', icon: '🛡️', x: 380, type: 'array', status: 'normal', parentId: 'sys-cabinet', powerPath: true, metrics: 'KM+/KM- 闭合 | 10MΩ' },
      { id: 'arr-dcbus', name: '512V 直流汇流母线', tier: 'array', icon: '🔌', x: 680, type: 'array', status: 'normal', parentId: 'sys-cabinet', powerPath: true, metrics: '528V DC | 15.0A' },
      {
        id: 'arr-rack',
        name: '高压电池簇 (Rack 160S1P)',
        tier: 'array',
        icon: '🔋',
        x: 1020,
        type: 'rack-container',
        status: 'normal',
        parentId: 'sys-cabinet',
        isExpandable: true,
        powerPath: true,
        metrics: 'SOC 69.0% | 100kWh'
      },
      { id: 'arr-bmu', name: 'BMU 电池管理主控制器', tier: 'array', icon: '🖥️', x: 1380, type: 'array', status: 'normal', parentId: 'sys-cabinet', powerPath: false, metrics: '包络 Max: 120A/140A' }
    );

    // --- Tier 5: Modules (10 Nodes, Children of arr-rack) ---
    for (let m = 1; m <= 10; m++) {
      const mid = `mod-${m < 10 ? '0' + m : m}`;
      const mx = 160 + (m - 1) * 182;
      nodes.push({
        id: mid,
        name: `模组 #${m < 10 ? '0' + m : m} (16S)`,
        tier: 'mod',
        icon: '🧱',
        x: mx,
        type: 'module-container',
        status: 'normal',
        parentId: 'arr-rack',
        modIndex: m,
        isExpandable: true,
        powerPath: true,
        metrics: '52.8V | 24.0℃'
      });
    }

    // --- Tier 6: Cells (160 Nodes, 16 per Module) ---
    for (let c = 1; c <= 160; c++) {
      const cid = `cell-${c < 10 ? '00' + c : (c < 100 ? '0' + c : c)}`;
      const mIdx = Math.floor((c - 1) / 16);
      const mNo = mIdx + 1;
      const parentModId = `mod-${mNo < 10 ? '0' + mNo : mNo}`;
      const cInM = (c - 1) % 16;

      const baseX = 106 + mIdx * 182;
      const col = cInM % 4;
      const row = Math.floor(cInM / 4);
      const cx = baseX + col * 36;
      const cy = 980 + row * 38;

      nodes.push({
        id: cid,
        name: `电芯 #${c < 10 ? '00' + c : (c < 100 ? '0' + c : c)}`,
        tier: 'cell',
        icon: '🔬',
        x: cx,
        y: cy,
        type: 'cell-leaf',
        status: 'normal',
        parentId: parentModId,
        modIndex: mNo,
        cellIndex: c,
        isExpandable: true,
        powerPath: true,
        isMaxV: false,
        isMinV: false,
        isMaxT: false,
        isMinT: false,
        metrics: `${state.telemetry.cellsV[c - 1]}mV`
      });
    }

    // Balancing Bus Node
    nodes.push({
      id: 'cell-balancing-bus',
      name: '主动电荷转移均衡总线',
      tier: 'cell',
      icon: '⚡',
      x: 1940,
      y: 1035,
      type: 'cell-bus',
      parentId: 'arr-rack',
      powerPath: true,
      status: 'normal',
      metrics: '3路电荷转移中 (ΔV 30mV)'
    });

    // Populate O(1) Node & Tree Indexes
    nodes.forEach(n => {
      nodeById.set(n.id, n);
      childrenById.set(n.id, []);
      inEdgesById.set(n.id, []);
      outEdgesById.set(n.id, []);
      adjById.set(n.id, new Set());
    });
    nodes.forEach(n => {
      if (n.parentId && childrenById.has(n.parentId)) {
        childrenById.get(n.parentId).push(n);
      }
    });

    // ----------------------------------------------------
    // Build Edges (261 Total Edges)
    // ----------------------------------------------------
    stationKeys.forEach(sKey => {
      const stId = STATION_PROFILES[sKey].id;
      addEdge('ctrl-backend', stId, 'control', 'WSS 反向隧道汇聚');
      addEdge(stId, 'ctrl-influx', 'comm', '5级拓扑遥测上报');
      addEdge('app-vpp', stId, 'control', 'VPP 集群功率分配');
    });

    // Applications -> Control Plane
    addEdge('app-peakshaving', 'ctrl-edge', 'control', '有功设定点下发');
    addEdge('app-balancing', 'ctrl-edge', 'control', '微电网平衡闭环');
    addEdge('app-evcs', 'ctrl-edge', 'control', '充电桩动态功率限制');
    addEdge('app-spot', 'ctrl-mpc', 'control', '日前价格矩阵');
    addEdge('app-vpp', 'ctrl-backend', 'control', 'VPP聚合调度');

    // Control Plane Internal
    addEdge('ctrl-edge', 'ctrl-backend', 'control', 'WSS 8084 穿透长连接');
    addEdge('ctrl-edge', 'ctrl-influx', 'comm', '时序遥测推送');
    addEdge('ctrl-backend', 'ctrl-metadata', 'control', '多租户鉴权');
    addEdge('ctrl-mpc', 'ctrl-edge', 'control', 'MPC最优化指令');

    // Control Plane -> Systems
    addEdge('ctrl-edge', 'sys-pcs', 'control', 'Modbus TCP 功率指令');
    addEdge('ctrl-edge', 'sys-cabinet', 'control', '机柜温控与消防联锁');
    addEdge('ctrl-edge', 'sys-grid', 'comm', '关口电表高频采样');
    addEdge('ctrl-edge', 'sys-pv', 'comm', '光伏发电计量');
    addEdge('ctrl-edge', 'sys-load-hvac', 'comm', '空调冷冻水能耗');
    addEdge('ctrl-edge', 'sys-load-machinery', 'comm', '生产车间能耗');

    // Systems Peer Power Flows & Station Physical Links
    ['sys-grid', 'sys-pv', 'sys-cabinet', 'sys-pcs', 'sys-load-hvac', 'sys-load-machinery'].forEach(sysId => {
      addEdge(activeStId, sysId, 'physical', '场站物理辖属');
    });
    addEdge('sys-grid', 'sys-pcs', 'power', '交流侧电能双向互济');
    addEdge('sys-pv', 'sys-pcs', 'power', '光伏余电耦合');
    addEdge('sys-pcs', 'sys-cabinet', 'power', '高低压交直流能量交换');
    addEdge('sys-pcs', 'sys-load-hvac', 'power', '机房冷机供电');
    addEdge('sys-pcs', 'sys-load-machinery', 'power', '车间产线供电');
    addEdge('ctrl-influx', 'app-spot', 'comm', '历史负荷与电价回放');
    addEdge('ctrl-influx', 'app-vpp', 'comm', '集群基线容量核算');
    addEdge('ctrl-metadata', 'app-vpp', 'comm', '场站资产台账同步');
    addEdge('ctrl-metadata', 'app-evcs', 'comm', '有序充电桩群配额');
    addEdge('arr-bmu', 'arr-hvbox', 'control', '主正主负继电器分合闸控制');
    addEdge('arr-hvbox', 'arr-dcbus', 'power', '高压熔断与母线隔离');
    addEdge('arr-bmu', 'cell-balancing-bus', 'control', '主动均衡策略触发');

    // Systems -> DC Array
    addEdge('sys-pcs', 'arr-dcbus', 'power', 'PCS 双向 DC/AC 变流');
    addEdge('sys-cabinet', 'arr-rack', 'physical', '机柜物理容纳 (下钻)');
    addEdge('sys-cabinet', 'arr-hvbox', 'physical', '高压保护联锁');
    addEdge('sys-cabinet', 'arr-dcbus', 'physical', '柜内直流母排');
    addEdge('sys-cabinet', 'arr-bmu', 'physical', '柜内主控单元');

    // DC Array -> Racks & BMU
    addEdge('arr-dcbus', 'arr-rack', 'power', '512V 充放电主母线');
    addEdge('arr-rack', 'arr-bmu', 'control', 'BMU 主控动态包络');
    addEdge('arr-hvbox', 'arr-rack', 'power', '主正主负接触器');
    addEdge('ctrl-edge', 'arr-bmu', 'comm', 'Modbus 8503 寄存器轮询');

    // Rack -> 10 Modules & Inter-Module Series Busbars
    for (let m = 1; m <= 10; m++) {
      const mid = `mod-${m < 10 ? '0' + m : m}`;
      addEdge('arr-rack', mid, 'physical', '簇内串联拓扑 (16S)');
      addEdge('arr-bmu', mid, 'comm', 'CSC 从控采样总线');
      if (m < 10) {
        const nextMid = `mod-${m + 1 < 10 ? '0' + (m + 1) : m + 1}`;
        addEdge(mid, nextMid, 'power', '模组高压铜排串联');
      }
    }

    // Module -> Cells & 16S Intra-Module Series Chain (150 Series Edges + 20 Terminal Edges)
    for (let m = 1; m <= 10; m++) {
      const mid = `mod-${m < 10 ? '0' + m : m}`;
      const firstCell = (m - 1) * 16 + 1;
      const lastCell = m * 16;
      const fmtCell = (idx) => `cell-${idx < 10 ? '00' + idx : (idx < 100 ? '0' + idx : idx)}`;
      addEdge(mid, fmtCell(firstCell), 'physical', '模组正极首电芯');
      addEdge(mid, fmtCell(lastCell), 'physical', '模组负极末电芯');

      for (let c = firstCell; c < lastCell; c++) {
        addEdge(fmtCell(c), fmtCell(c + 1), 'power', '16S 单体串联铜排');
      }
    }

    addEdge('cell-balancing-bus', 'cell-014', 'power', '主动能量释放 (Max V)');
    addEdge('cell-balancing-bus', 'cell-003', 'power', '主动电荷补充 (Min V)');

    // Compute initial bottom-up roll-up aggregations & visibility cache
    computeRollUpAggregations();
    recomputeVisibilityCache();
  }

  function addEdge(source, target, type, label) {
    const edge = { id: `${source}->${target}`, source, target, type, label };
    edges.push(edge);
    if (outEdgesById.has(source)) outEdgesById.get(source).push(edge);
    if (inEdgesById.has(target)) inEdgesById.get(target).push(edge);
    if (adjById.has(source)) adjById.get(source).add(target);
    if (adjById.has(target)) adjById.get(target).add(source);
  }

  // ----------------------------------------------------
  // Dynamic Tree Descendant Counter (No Hardcoded Counts)
  // ----------------------------------------------------
  function getDescendantSummary(nodeId) {
    if (descendantCache.has(nodeId)) return descendantCache.get(nodeId);
    const counts = { total: 0, sys: 0, array: 0, mod: 0, cell: 0 };
    const stack = [...(childrenById.get(nodeId) || [])];
    while (stack.length > 0) {
      const ch = stack.pop();
      counts.total++;
      if (ch.tier === 'sys') counts.sys++;
      else if (ch.tier === 'array') counts.array++;
      else if (ch.tier === 'mod') counts.mod++;
      else if (ch.tier === 'cell' && ch.type === 'cell-leaf') counts.cell++;
      const sub = childrenById.get(ch.id);
      if (sub && sub.length > 0) stack.push(...sub);
    }
    descendantCache.set(nodeId, counts);
    return counts;
  }

  function formatContainerBadge(node) {
    if (!node.isExpandable || node.tier === 'cell') return '';
    const counts = getDescendantSummary(node.id);
    const isExpanded = state.expandedContainers.has(node.id);
    if (node.tier === 'fleet') {
      const prof = STATION_PROFILES[node.stationKey] || STATION_PROFILES['bms'];
      return state.rollupDepth === 0 ? `+${prof.racks}簇/${prof.mods}组/${prof.cells}芯 🔽` : '[-] 上卷 🔼';
    }
    if (node.id === 'sys-cabinet') {
      return isExpanded ? `[-${counts.total}] 上卷 🔼` : `+${counts.array}阵列/${counts.mod}组/${counts.cell}芯 🔽`;
    }
    if (node.id === 'arr-rack') {
      return isExpanded ? `[-${counts.mod}组] 上卷 🔼` : `+${counts.mod}模组/${counts.cell}芯 🔽`;
    }
    if (node.tier === 'mod') {
      return isExpanded ? `[-${counts.cell}] 收起 🔼` : `+${counts.cell}电芯 🔽`;
    }
    return '';
  }

  // ----------------------------------------------------
  // Bottom-Up Roll-Up Mathematical Engine (自底向上真实聚合计算)
  // ----------------------------------------------------
  function computeRollUpAggregations() {
    // First compute global cell voltage & temperature extremes dynamically from real arrays
    let globalMaxV = -Infinity, globalMinV = Infinity;
    let globalMaxVNo = 1, globalMinVNo = 1;
    let globalMaxT = -Infinity, globalMinT = Infinity;
    let globalMaxTNo = 1, globalMinTNo = 1;
    let totalCellsMv = 0;
    let totalCellsT = 0;

    for (let i = 0; i < 160; i++) {
      const cNo = i + 1;
      const v = state.telemetry.cellsV[i] || 3300;
      const t = state.telemetry.cellsT[i] || 24.0;
      totalCellsMv += v;
      totalCellsT += t;
      if (v > globalMaxV) { globalMaxV = v; globalMaxVNo = cNo; }
      if (v < globalMinV) { globalMinV = v; globalMinVNo = cNo; }
      if (t > globalMaxT) { globalMaxT = t; globalMaxTNo = cNo; }
      if (t < globalMinT) { globalMinT = t; globalMinTNo = cNo; }
    }

    const globalMeanCellMv = totalCellsMv / 160.0;
    const globalMeanCellT = +(totalCellsT / 160.0).toFixed(1);

    state.telemetry.maxCellV = globalMaxV;
    state.telemetry.minCellV = globalMinV;
    state.telemetry.maxCellNo = globalMaxVNo;
    state.telemetry.minCellNo = globalMinVNo;
    state.telemetry.maxCellT = +globalMaxT.toFixed(1);
    state.telemetry.minCellT = +globalMinT.toFixed(1);
    state.telemetry.maxTempNo = globalMaxTNo;
    state.telemetry.minTempNo = globalMinTNo;
    state.telemetry.deltaV = globalMaxV - globalMinV;
    state.telemetry.deltaT = +(globalMaxT - globalMinT).toFixed(1);

    // 1. Roll-up 16 Cells -> Each of the 10 Modules
    let rackSumV = 0;
    let rackMaxModV = -Infinity, rackMinModV = Infinity;
    let rackMaxModNo = 1, rackMinModNo = 1;
    let rackBalancingCells = 0;
    const moduleStatuses = [];

    for (let m = 1; m <= 10; m++) {
      const mid = `mod-${m < 10 ? '0' + m : m}`;
      const modNode = nodeById.get(mid);
      const startIdx = (m - 1) * 16;
      const endIdx = m * 16;

      let sumMv = 0;
      let maxV = -Infinity, minV = Infinity;
      let maxCNo = startIdx + 1, minCNo = startIdx + 1;
      let sumT = 0, maxT = -Infinity, minT = Infinity;
      let balCount = 0;
      const cellVs = [];
      const childStatuses = [];

      for (let i = startIdx; i < endIdx; i++) {
        const cNo = i + 1;
        const v = state.telemetry.cellsV[i] || 3300;
        const t = state.telemetry.cellsT[i] || 24.0;
        cellVs.push(v);
        sumMv += v;
        sumT += t;

        if (v > maxV) { maxV = v; maxCNo = cNo; }
        if (v < minV) { minV = v; minCNo = cNo; }
        if (t > maxT) maxT = t;
        if (t < minT) minT = t;

        const devFromMean = Math.abs(v - globalMeanCellMv);
        const isBalancing = devFromMean >= 12 || cNo === globalMaxVNo || cNo === globalMinVNo;
        if (isBalancing) balCount++;

        let cStatus = 'normal';
        if (v >= 3400 || v <= 3150 || t >= 35.0) {
          cStatus = 'critical';
        } else if (cNo === globalMaxVNo || devFromMean >= 15 || t >= 28.5) {
          cStatus = 'warning';
        }
        childStatuses.push(cStatus);

        const cid = `cell-${cNo < 10 ? '00' + cNo : (cNo < 100 ? '0' + cNo : cNo)}`;
        const cNode = nodeById.get(cid);
        if (cNode) {
          cNode.isMaxV = (cNo === globalMaxVNo);
          cNode.isMinV = (cNo === globalMinVNo);
          cNode.isMaxT = (cNo === globalMaxTNo);
          cNode.isMinT = (cNo === globalMinTNo);
          cNode.status = cStatus;
          cNode.metrics = `${v}mV | ${t.toFixed(1)}℃`;
          pushNodeHistory(cid, 'Cell Voltage', 'mV', v);
        }
      }

      const modV = +(sumMv / 1000.0).toFixed(2);
      const avgV = Math.round(sumMv / 16);
      const deltaV = maxV - minV;
      const avgT = +(sumT / 16.0).toFixed(1);
      const deltaT = +(maxT - minT).toFixed(1);

      // True bottom-up worst-of-children status propagation
      let modStatus = maxSeverityStatus(childStatuses);
      if (deltaV >= 35 && modStatus === 'normal') modStatus = 'warning';
      moduleStatuses.push(modStatus);

      state.telemetry.modulesV[m - 1] = modV;
      state.telemetry.modulesT[m - 1] = avgT;
      pushNodeHistory(mid, 'Module ∑V', 'V', modV);

      if (modNode) {
        modNode.status = modStatus;
        modNode.metrics = `∑=${modV.toFixed(1)}V | ΔV=${deltaV}mV | ${avgT}℃`;
        const dc = getDescendantSummary(mid);
        modNode.rollup = {
          formula: '16S LiFePO4 串联上卷 (Cell Roll-Up)',
          childCount: `${dc.cell} 颗电芯`,
          sumV: `${modV.toFixed(2)} V (∑16 Cells)`,
          avgV: `${avgV} mV | μT ${avgT} ℃`,
          maxVal: `${maxV} mV (#${maxCNo})`,
          minVal: `${minV} mV (#${minCNo})`,
          spread: `ΔV = ${deltaV} mV | ΔT = ${deltaT} ℃`,
          avgTemp: `${avgT} ℃ (Max ${maxT.toFixed(1)}℃)`,
          balancing: `${balCount} 颗均衡中`,
          worstStatus: statusToBadgeText(modStatus, `Max #${maxCNo}`),
          cellVoltages: cellVs
        };
      }

      rackSumV += modV;
      if (modV > rackMaxModV) { rackMaxModV = modV; rackMaxModNo = m; }
      if (modV < rackMinModV) { rackMinModV = modV; rackMinModNo = m; }
      rackBalancingCells += balCount;
    }

    rackSumV = +rackSumV.toFixed(1);
    // Keep pack voltage synchronized with bottom-up sum when within sensor tolerance
    if (!state.telemetry.voltage || Math.abs(state.telemetry.voltage - rackSumV) > 5) {
      state.telemetry.voltage = rackSumV;
    }

    // Update balancing bus dynamic edges & metrics
    const balBus = nodeById.get('cell-balancing-bus');
    if (balBus) {
      balBus.metrics = `${rackBalancingCells}路电荷转移 (ΔV ${state.telemetry.deltaV}mV: #${globalMaxVNo}→#${globalMinVNo})`;
    }

    // 2. Roll-up 10 Modules -> Battery Rack (arr-rack)
    const rackNode = nodeById.get('arr-rack');
    const rackStatus = maxSeverityStatus(moduleStatuses);
    const modSpreadV = +(rackMaxModV - rackMinModV).toFixed(2);
    if (rackNode) {
      rackNode.status = rackStatus;
      rackNode.metrics = `∑=${rackSumV.toFixed(1)}V | SOC ${state.telemetry.soc.toFixed(1)}% | ΔV ${state.telemetry.deltaV}mV`;
      const dc = getDescendantSummary('arr-rack');
      rackNode.rollup = {
        formula: '10 串联模组 / 160 电芯上卷 (Rack Roll-Up)',
        childCount: `${dc.mod} 模组 / ${dc.cell} 电芯`,
        sumV: `${rackSumV.toFixed(2)} V (∑10 Mods, 簇表 ${state.telemetry.voltage}V)`,
        avgV: `${(rackSumV / 10).toFixed(2)} V/Mod | μCell ${Math.round(globalMeanCellMv)} mV`,
        maxVal: `Mod #0${rackMaxModNo} (${rackMaxModV}V) | Cell #${globalMaxVNo} (${globalMaxV}mV)`,
        minVal: `Mod #0${rackMinModNo} (${rackMinModV}V) | Cell #${globalMinVNo} (${globalMinV}mV)`,
        spread: `模组极差 ${modSpreadV}V | 单体极差 ${state.telemetry.deltaV}mV`,
        avgTemp: `算术均温 ${globalMeanCellT} ℃ (ΔT ${state.telemetry.deltaT}℃, #${globalMaxTNo}/#${globalMinTNo})`,
        balancing: `全簇共 ${rackBalancingCells} 颗电芯主动均衡`,
        worstStatus: statusToBadgeText(rackStatus, `源自 Mod #0${Math.ceil(globalMaxVNo / 16)} / Cell #${globalMaxVNo}`)
      };
      pushNodeHistory('arr-rack', 'Rack ∑Voltage', 'V', rackSumV);
    }

    // Update sibling array nodes
    const dcbus = nodeById.get('arr-dcbus');
    if (dcbus) {
      dcbus.metrics = `${rackSumV.toFixed(1)}V DC | ${state.telemetry.current.toFixed(1)}A`;
      pushNodeHistory('arr-dcbus', 'DC Bus Current', 'A', state.telemetry.current);
    }
    const bmu = nodeById.get('arr-bmu');
    if (bmu) {
      bmu.metrics = `包络: +${state.telemetry.chargeMaxA}A / -${state.telemetry.dischargeMaxA}A`;
    }

    // 3. Roll-up Array & Rack -> BESS Cabinet (sys-cabinet)
    const cabNode = nodeById.get('sys-cabinet');
    const arrayChildren = childrenById.get('sys-cabinet') || [];
    const cabStatus = maxSeverityStatus(arrayChildren.map(c => c.status));
    if (cabNode) {
      cabNode.status = cabStatus;
      cabNode.metrics = `${state.telemetry.powerKw >= 0 ? '+' : ''}${state.telemetry.powerKw}kW | SOC ${state.telemetry.soc.toFixed(1)}% | ΔV ${state.telemetry.deltaV}mV`;
      const dc = getDescendantSummary('sys-cabinet');
      cabNode.rollup = {
        formula: '机柜全栈自底向上聚合 (Cabinet Full Roll-Up)',
        childCount: `${dc.array} 阵列 / ${dc.mod} 模组 / ${dc.cell} 电芯`,
        sumV: `AC 380V ⇄ DC ∑${rackSumV.toFixed(1)}V`,
        avgV: `有功功率 ${state.telemetry.powerKw} kW | 均温 ${globalMeanCellT} ℃`,
        maxVal: `穿透最高单体 #${globalMaxVNo}: ${globalMaxV} mV (热极值 #${globalMaxTNo}: ${globalMaxT.toFixed(1)}℃)`,
        minVal: `穿透最低单体 #${globalMinVNo}: ${globalMinV} mV (冷极值 #${globalMinTNo}: ${globalMinT.toFixed(1)}℃)`,
        spread: `全柜最大压差 ΔV = ${state.telemetry.deltaV} mV | 温差 ΔT = ${state.telemetry.deltaT} ℃`,
        avgTemp: `柜内环温 ${state.telemetry.ambientT}℃ | 电芯均温 ${globalMeanCellT}℃`,
        balancing: `绝缘阻抗 ${state.telemetry.insulation} kΩ | 空调${state.telemetry.hvacStatus ? '制冷中❄️' : '待机'}`,
        worstStatus: statusToBadgeText(cabStatus, `自底向上传染自 Cell #${globalMaxVNo}`)
      };
      pushNodeHistory('sys-cabinet', 'Cabinet Power', 'kW', state.telemetry.powerKw);
    }

    // Update PCS & Grid/PV metrics
    const pcsNode = nodeById.get('sys-pcs');
    if (pcsNode) {
      pcsNode.metrics = `AC ${state.telemetry.powerKw}kW | η ${state.telemetry.rteEfficiency}%`;
      pushNodeHistory('sys-pcs', 'PCS Active Power', 'kW', state.telemetry.powerKw);
    }

    // 4. Roll-up Systems -> Active Fleet Station & All Fleet Stations
    const activeStNode = nodeById.get(activeStationNodeId());
    const sysChildren = (activeStNode && childrenById.get(activeStNode.id)) || [];
    const stStatus = maxSeverityStatus(sysChildren.map(c => c.status));

    Object.keys(STATION_PROFILES).forEach(sKey => {
      const prof = STATION_PROFILES[sKey];
      const stNode = nodeById.get(prof.id);
      if (!stNode) return;
      const isCurrent = (sKey === state.station);
      const live = isCurrent
        ? { powerKw: state.telemetry.powerKw, soc: state.telemetry.soc }
        : (state.telemetry.fleetLive[sKey] || { powerKw: 0, soc: 50 });

      stNode.powerKw = live.powerKw;
      stNode.soc = live.soc;
      stNode.status = isCurrent ? stStatus : (live.soc <= 15 ? 'warning' : 'normal');
      stNode.metrics = `${live.powerKw >= 0 ? '+' : ''}${live.powerKw.toFixed(1)}kW | SOC ${live.soc.toFixed(1)}%`;

      const dc = getDescendantSummary(stNode.id);
      stNode.rollup = {
        formula: '场站级全量资产上卷 (Station Fleet Roll-Up)',
        childCount: isCurrent ? `${dc.sys} 系统 / ${dc.array} 阵列 / ${dc.mod} 模组 / ${dc.cell} 电芯` : `${prof.racks} 簇 / ${prof.mods} 模组 / ${prof.cells} 电芯`,
        sumV: `装机容量 ${prof.capacityKwh} kWh | 额定功率 ${prof.ratedKw} kW`,
        avgV: `当前功率 ${live.powerKw.toFixed(1)} kW | SOC ${live.soc.toFixed(1)}%`,
        maxVal: `穿透最高电芯 #${globalMaxVNo} (${globalMaxV}mV)`,
        minVal: `穿透最低电芯 #${globalMinVNo} (${globalMinV}mV)`,
        spread: `全站极值压差 ΔV = ${state.telemetry.deltaV} mV`,
        avgTemp: `环温 ${state.telemetry.ambientT}℃ | 电芯均温 ${globalMeanCellT}℃`,
        balancing: `${rackBalancingCells} 路均衡激活`,
        worstStatus: statusToBadgeText(stNode.status, isCurrent ? `Cell #${globalMaxVNo} 穿透上卷` : `SOC ${live.soc.toFixed(0)}%`)
      };
      pushNodeHistory(stNode.id, 'Station Power', 'kW', live.powerKw);
    });
  }

  // ----------------------------------------------------
  // Level 5 Cell Micro-Twin (Consistent 2nd-Order Thevenin RC Physics)
  // ----------------------------------------------------
  function buildCellMicroTwin(cellNode) {
    microNodes.length = 0;
    microEdges.length = 0;
    if (!cellNode) return;

    const cIdx = cellNode.cellIndex || state.telemetry.maxCellNo || 14;
    const vTermMv = state.telemetry.cellsV[cIdx - 1] || 3317;
    const tempC = state.telemetry.cellsT[cIdx - 1] || 25.6;
    const currentA = state.telemetry.current; // I > 0: Discharge, I < 0: Charge

    // Physical RC parameters (mOhm)
    const r0 = 0.48;
    const r1 = 0.32;
    const r2 = 0.65;

    // Voltage drops across R0, R1||C1, R2||C2 (signed with I: positive drop during discharge, negative during charge)
    const u0Mv = +(currentA * r0).toFixed(2);
    const u1Mv = +(currentA * r1).toFixed(2);
    const u2Mv = +(currentA * r2).toFixed(2);

    // Exact Thevenin KVL: V_term = V_ocv - U0 - U1 - U2  ===>  V_ocv = V_term + U0 + U1 + U2
    const vOcvMv = +(vTermMv + u0Mv + u1Mv + u2Mv).toFixed(2);
    const jouleW = +((currentA * currentA) * (r0 + r1 + r2) / 1000.0).toFixed(2);

    microNodes.push(
      { id: 'rc-ocv', name: '理想开路电压源 Vocv(SOC)', tier: 'cell', icon: '🔋', x: 340, y: 480, type: 'micro-rc', status: 'normal', metrics: `Vocv = ${vOcvMv.toFixed(1)} mV (SOC ${state.telemetry.soc.toFixed(1)}%)` },
      { id: 'rc-r0', name: '欧姆内阻 R0 (电解液/极耳)', tier: 'cell', icon: '〰️', x: 650, y: 480, type: 'micro-rc', status: 'normal', metrics: `R0 = ${r0} mΩ | ΔU0 = ${u0Mv >= 0 ? '+' : ''}${u0Mv} mV` },
      { id: 'rc-r1c1', name: '一阶电化学极化网络 (R1||C1)', tier: 'cell', icon: '⚡', x: 960, y: 370, type: 'micro-rc', status: 'normal', metrics: `R1 = ${r1} mΩ | C1 = 4200F | U1 = ${u1Mv >= 0 ? '+' : ''}${u1Mv} mV` },
      { id: 'rc-r2c2', name: '二阶浓差极化网络 (R2||C2)', tier: 'cell', icon: '🌊', x: 960, y: 590, type: 'micro-rc', status: 'normal', metrics: `R2 = ${r2} mΩ | C2 = 28kF | U2 = ${u2Mv >= 0 ? '+' : ''}${u2Mv} mV` },
      { id: 'rc-term', name: '电芯极柱端电压输出 Vterm', tier: 'cell', icon: '🔌', x: 1300, y: 480, type: 'micro-rc', status: cellNode.status || 'normal', metrics: `Vterm = ${vTermMv} mV | I = ${currentA.toFixed(1)} A` },
      { id: 'rc-mosfet', name: '主动均衡 MOSFET 旁路支路', tier: 'cell', icon: '🔀', x: 1300, y: 260, type: 'micro-rc', status: cellNode.isMaxV ? 'warning' : 'normal', metrics: cellNode.isMaxV ? '导通均衡中 (Ibal = 150mA)' : '关断待机 (Ibal = 0mA)' },
      { id: 'rc-thermal', name: '电芯焦耳热耦合核心 (Q=I²R)', tier: 'cell', icon: '🌡️', x: 800, y: 730, type: 'micro-rc', status: tempC >= 28.5 ? 'warning' : 'normal', metrics: `Tcore = ${tempC.toFixed(1)} ℃ | Q = ${jouleW} W` }
    );

    microEdges.push(
      { source: 'rc-ocv', target: 'rc-r0', type: 'power', label: `Vocv ${vOcvMv.toFixed(1)}mV` },
      { source: 'rc-r0', target: 'rc-r1c1', type: 'power', label: `扣除 ΔU0 (${u0Mv}mV)` },
      { source: 'rc-r0', target: 'rc-r2c2', type: 'power', label: '锂离子固相扩散' },
      { source: 'rc-r1c1', target: 'rc-term', type: 'power', label: `扣除 U1 (${u1Mv}mV)` },
      { source: 'rc-r2c2', target: 'rc-term', type: 'power', label: `扣除 U2 (${u2Mv}mV)` },
      { source: 'rc-term', target: 'rc-mosfet', type: 'control', label: 'CSC 差分采样与均衡回路' },
      { source: 'rc-r0', target: 'rc-thermal', type: 'comm', label: '欧姆焦耳热生成' },
      { source: 'rc-r1c1', target: 'rc-thermal', type: 'comm', label: '极化内阻产热' }
    );

    return { vTermMv, vOcvMv, u0Mv, u1Mv, u2Mv, currentA, tempC };
  }

  // ----------------------------------------------------
  // Visibility & Dynatrace Edge Roll-Up Engine
  // ----------------------------------------------------
  function areAllAncestorsExpanded(node) {
    let curr = node;
    while (curr && curr.parentId) {
      if (!state.expandedContainers.has(curr.parentId)) return false;
      curr = nodeById.get(curr.parentId);
    }
    return true;
  }

  function evaluateNodeVisibilityBase(node) {
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      return node.name.toLowerCase().includes(q) || node.id.toLowerCase().includes(q);
    }

    if (state.rollupDepth === 5) return false;

    // Level 0: Fleet Roll-Up
    if (state.rollupDepth === 0) {
      if (state.mode === 'powerflow') return node.tier === 'fleet';
      return node.tier === 'fleet' || ['app-vpp', 'app-spot', 'ctrl-backend', 'ctrl-influx', 'ctrl-metadata'].includes(node.id);
    }

    if (node.tier === 'fleet') return false;

    // Multimodal view filtering
    if (state.mode === 'powerflow' && !node.powerPath) return false;
    if (state.mode === 'bess' && ['app', 'ctrl'].includes(node.tier)) return false;
    if (state.mode === 'controlcomm' && node.tier === 'cell') return false;

    // Generic Tree Container Expansion Check
    if (!areAllAncestorsExpanded(node)) return false;

    // Balancing bus is visible only when at least one module is expanded to show cells
    if (node.id === 'cell-balancing-bus') {
      for (let m = 1; m <= 10; m++) {
        if (state.expandedContainers.has(`mod-${m < 10 ? '0' + m : m}`)) return true;
      }
      return false;
    }

    return true;
  }

  function findVisibleAncestor(nodeId) {
    let curr = nodeById.get(nodeId);
    while (curr) {
      if (visibleNodeIds.has(curr.id)) return curr;
      if (!curr.parentId) break;
      curr = nodeById.get(curr.parentId);
    }
    return null;
  }

  function recomputeVisibilityCache() {
    visibleNodeIds.clear();

    // Pass 1: Base visibility from tree expansion & mode
    nodes.forEach(n => {
      if (evaluateNodeVisibilityBase(n)) {
        visibleNodeIds.add(n.id);
      }
    });

    // Pass 2: If left-rail activeTier filter is set, keep activeTier nodes + their 1-hop neighbors
    if (state.activeTier && !state.searchQuery && state.rollupDepth < 5) {
      const keep = new Set();
      visibleNodeIds.forEach(id => {
        const n = nodeById.get(id);
        if (n && n.tier === state.activeTier) {
          keep.add(id);
          const neighbors = adjById.get(id);
          if (neighbors) {
            neighbors.forEach(nbId => {
              if (visibleNodeIds.has(nbId)) keep.add(nbId);
            });
          }
        }
      });
      visibleNodeIds.clear();
      keep.forEach(id => visibleNodeIds.add(id));
    }

    // Pass 3: Compute Dynatrace Edge Roll-Up (project hidden endpoints to nearest visible ancestor container)
    const edgeMap = new Map();
    edges.forEach(e => {
      if (state.mode === 'powerflow' && e.type !== 'power') return;
      if (state.mode === 'controlcomm' && e.type === 'power') return;

      const u = findVisibleAncestor(e.source);
      const v = findVisibleAncestor(e.target);
      if (!u || !v || u.id === v.id) return;

      const key = `${u.id}->${v.id}`;
      const isProjected = (u.id !== e.source || v.id !== e.target);
      let entry = edgeMap.get(key);
      if (!entry) {
        entry = {
          id: key,
          source: u.id,
          target: v.id,
          type: e.type,
          label: e.label,
          count: 1,
          isProjected
        };
        edgeMap.set(key, entry);
      } else {
        entry.count++;
        if (isProjected) entry.isProjected = true;
        // Prioritize power > control > comm > physical when merging mixed edges
        const rank = { power: 4, control: 3, comm: 2, physical: 1 };
        if ((rank[e.type] || 0) > (rank[entry.type] || 0)) {
          entry.type = e.type;
          entry.label = e.label;
        }
      }
    });

    effectiveEdges = Array.from(edgeMap.values());
    recomputeLineageHighlight();
  }

  function recomputeLineageHighlight() {
    lineageNodeIds.clear();
    const focal = state.hoveredNode || state.selectedNode;
    if (!focal || state.rollupDepth === 5) return;

    lineageNodeIds.add(focal.id);
    // Include ancestors & descendants in tree
    let p = focal.parentId ? nodeById.get(focal.parentId) : null;
    while (p) {
      lineageNodeIds.add(p.id);
      p = p.parentId ? nodeById.get(p.parentId) : null;
    }
    const chStack = [...(childrenById.get(focal.id) || [])];
    while (chStack.length > 0) {
      const c = chStack.pop();
      lineageNodeIds.add(c.id);
      const sub = childrenById.get(c.id);
      if (sub) chStack.push(...sub);
    }
    // Include 1-hop visible topological neighbors
    effectiveEdges.forEach(e => {
      if (e.source === focal.id) lineageNodeIds.add(e.target);
      if (e.target === focal.id) lineageNodeIds.add(e.source);
    });
  }

  function isNodeVisible(node) {
    return visibleNodeIds.has(node.id);
  }

  function getExpandedModuleIds() {
    const res = [];
    for (let m = 1; m <= 10; m++) {
      const mid = `mod-${m < 10 ? '0' + m : m}`;
      if (state.expandedContainers.has(mid)) res.push(mid);
    }
    return res;
  }

  // ----------------------------------------------------
  // Drill-Down & Roll-Up State Transitions
  // ----------------------------------------------------
  function syncExpandedContainersForDepth(depth) {
    const stId = activeStationNodeId();
    if (depth === 0) {
      state.expandedContainers.clear();
    } else if (depth === 1) {
      state.expandedContainers.clear();
      state.expandedContainers.add(stId);
    } else if (depth === 2) {
      state.expandedContainers.clear();
      state.expandedContainers.add(stId);
      state.expandedContainers.add('sys-cabinet');
    } else if (depth === 3) {
      state.expandedContainers.clear();
      state.expandedContainers.add(stId);
      state.expandedContainers.add('sys-cabinet');
      state.expandedContainers.add('arr-rack');
      const toRestore = state.savedL3Modules && state.savedL3Modules.length > 0 ? state.savedL3Modules : [];
      toRestore.forEach(mid => state.expandedContainers.add(mid));
    } else if (depth === 4) {
      // Save current L3 module selection before expanding all 10
      const currentMods = getExpandedModuleIds();
      if (currentMods.length < 10) {
        state.savedL3Modules = currentMods;
      }
      state.expandedContainers.clear();
      state.expandedContainers.add(stId);
      state.expandedContainers.add('sys-cabinet');
      state.expandedContainers.add('arr-rack');
      for (let m = 1; m <= 10; m++) {
        state.expandedContainers.add(`mod-${m < 10 ? '0' + m : m}`);
      }
    }
  }

  function setRollupDepth(depth, focusNode = null) {
    const prevDepth = state.rollupDepth;
    state.rollupDepth = Math.max(0, Math.min(5, depth));

    if (state.rollupDepth < 5) {
      if (prevDepth === 3 && state.rollupDepth === 4) {
        state.savedL3Modules = getExpandedModuleIds();
      }
      syncExpandedContainersForDepth(state.rollupDepth);
    }

    if (state.rollupDepth === 0) {
      animateCameraTo(100, 80, 0.85);
    } else if (state.rollupDepth === 1) {
      animateCameraTo(100, 90, 0.88);
    } else if (state.rollupDepth === 2) {
      animateCameraTo(100, 40, 0.85);
    } else if (state.rollupDepth === 3) {
      animateCameraTo(80, 15, 0.80);
    } else if (state.rollupDepth === 4) {
      animateCameraTo(60, -40, 0.76);
    } else if (state.rollupDepth === 5) {
      const targetCell = focusNode || (state.selectedNode && state.selectedNode.tier === 'cell' ? state.selectedNode : nodeById.get(`cell-${state.telemetry.maxCellNo < 10 ? '00' + state.telemetry.maxCellNo : (state.telemetry.maxCellNo < 100 ? '0' + state.telemetry.maxCellNo : state.telemetry.maxCellNo)}`)) || nodeById.get('cell-014');
      state.focusedMicroCellId = targetCell ? targetCell.id : 'cell-014';
      buildCellMicroTwin(targetCell);
      animateCameraTo(140, 40, 0.92);
    }

    recomputeVisibilityCache();
    updateDepthUI();
    updateBreadcrumb();
    updateLeftRail();
    if (state.selectedNode) {
      populateDrawer(state.selectedNode);
    }
  }

  function switchStation(stationKey) {
    if (!STATION_PROFILES[stationKey]) return;
    state.station = stationKey;
    const sel = typeof document !== 'undefined' ? document.getElementById('station-select') : null;
    if (sel && sel.value !== stationKey) sel.value = stationKey;

    buildGraphData();
    if (state.rollupDepth < 5) {
      syncExpandedContainersForDepth(state.rollupDepth);
    }
    recomputeVisibilityCache();
    updateLeftRail();
    updateBreadcrumb();
    updateDepthUI();
    pollLiveTelemetry();
  }

  function drillDownNode(node) {
    if (!node) return;

    if (node.tier === 'fleet') {
      if (node.stationKey && node.stationKey !== state.station) {
        switchStation(node.stationKey);
      }
      const cab = nodeById.get('sys-cabinet');
      setRollupDepth(1, cab);
      selectNode(cab);
      return;
    }

    if (node.id === 'sys-cabinet') {
      if (state.rollupDepth >= 2 && state.expandedContainers.has('sys-cabinet')) {
        // Toggle roll-up to L1
        setRollupDepth(1, node);
      } else {
        const rack = nodeById.get('arr-rack');
        setRollupDepth(2, rack);
        selectNode(rack);
      }
      return;
    }

    if (node.id === 'arr-rack') {
      if (state.rollupDepth >= 3 && state.expandedContainers.has('arr-rack')) {
        setRollupDepth(2, node);
      } else {
        setRollupDepth(3, node);
        selectNode(nodeById.get('mod-01'));
      }
      return;
    }

    if (node.tier === 'mod') {
      if (state.rollupDepth < 3) {
        state.rollupDepth = 3;
        syncExpandedContainersForDepth(3);
      }
      if (state.expandedContainers.has(node.id)) {
        state.expandedContainers.delete(node.id);
        if (state.rollupDepth === 4) state.rollupDepth = 3;
      } else {
        state.expandedContainers.add(node.id);
        if (getExpandedModuleIds().length === 10) state.rollupDepth = 4;
        if (typeof canvas !== 'undefined' && canvas && canvas.parentElement) {
          const canvasW = canvas.parentElement.clientWidth;
          const canvasH = canvas.parentElement.clientHeight;
          animateCameraTo(canvasW / 2 - node.x * 0.95, canvasH / 2 - 960 * 0.95, 0.95);
        }
      }
      state.savedL3Modules = getExpandedModuleIds();
      recomputeVisibilityCache();
      updateDepthUI();
      updateBreadcrumb();
      updateLeftRail();
      populateDrawer(node);
      return;
    }

    if (node.tier === 'cell' && node.type === 'cell-leaf') {
      state.focusedMicroCellId = node.id;
      setRollupDepth(5, node);
      selectNode(node);
      return;
    }
  }

  function rollUpOneLevel() {
    if (state.rollupDepth === 5) {
      const cellNode = nodeById.get(state.focusedMicroCellId) || nodeById.get('cell-014');
      const parentMod = cellNode ? nodeById.get(cellNode.parentId) : nodeById.get('mod-01');
      state.rollupDepth = 3;
      syncExpandedContainersForDepth(3);
      if (parentMod) state.expandedContainers.add(parentMod.id);
      recomputeVisibilityCache();
      updateDepthUI();
      updateBreadcrumb();
      updateLeftRail();
      if (parentMod) selectNode(parentMod);
      animateCameraTo(80, 15, 0.80);
      return;
    }

    if (state.rollupDepth === 4) {
      // If a cell is selected in L4, collapse its parent module in L3
      if (state.selectedNode && state.selectedNode.tier === 'cell' && state.selectedNode.parentId) {
        const pMod = nodeById.get(state.selectedNode.parentId);
        state.savedL3Modules = getExpandedModuleIds().filter(id => id !== state.selectedNode.parentId);
        setRollupDepth(3, pMod);
        if (pMod) selectNode(pMod);
        return;
      }
      state.savedL3Modules = [];
      setRollupDepth(3, nodeById.get('arr-rack'));
      return;
    }

    if (state.rollupDepth === 3) {
      if (state.selectedNode && state.selectedNode.tier === 'cell' && state.selectedNode.parentId) {
        const pMod = nodeById.get(state.selectedNode.parentId);
        if (pMod) {
          state.expandedContainers.delete(pMod.id);
          state.savedL3Modules = getExpandedModuleIds();
          recomputeVisibilityCache();
          selectNode(pMod);
          updateDepthUI();
          updateBreadcrumb();
          updateLeftRail();
          return;
        }
      }
      const expMods = getExpandedModuleIds();
      if (expMods.length > 0) {
        expMods.forEach(id => state.expandedContainers.delete(id));
        state.savedL3Modules = [];
        recomputeVisibilityCache();
        updateDepthUI();
        updateBreadcrumb();
        updateLeftRail();
        if (state.selectedNode) populateDrawer(state.selectedNode);
        return;
      }
      const rack = nodeById.get('arr-rack');
      setRollupDepth(2, rack);
      if (rack) selectNode(rack);
      return;
    }

    if (state.rollupDepth === 2) {
      const cab = nodeById.get('sys-cabinet');
      setRollupDepth(1, cab);
      if (cab) selectNode(cab);
      return;
    }

    if (state.rollupDepth === 1) {
      const st = nodeById.get(activeStationNodeId());
      setRollupDepth(0, st);
      if (st) selectNode(st);
      return;
    }
  }

  function drillDownOneLevel() {
    if (state.selectedNode && state.selectedNode.isExpandable) {
      drillDownNode(state.selectedNode);
      return;
    }
    if (state.rollupDepth < 4) {
      setRollupDepth(state.rollupDepth + 1);
    } else if (state.rollupDepth === 4) {
      const maxNo = state.telemetry.maxCellNo || 14;
      const cid = `cell-${maxNo < 10 ? '00' + maxNo : (maxNo < 100 ? '0' + maxNo : maxNo)}`;
      const cNode = nodeById.get(cid) || nodeById.get('cell-014');
      state.focusedMicroCellId = cNode.id;
      setRollupDepth(5, cNode);
      selectNode(cNode);
    }
  }

  function animateCameraTo(panX, panY, scale) {
    state.targetPanX = panX;
    state.targetPanY = panY;
    state.targetScale = scale;
  }

  // ----------------------------------------------------
  // Breadcrumb Trail Builder
  // ----------------------------------------------------
  function updateBreadcrumb() {
    if (typeof document === 'undefined') return;
    const trail = document.getElementById('breadcrumb-trail');
    if (!trail) return;
    trail.innerHTML = `<span class="breadcrumb-label">🧭 拓扑路径:</span>`;

    const prof = STATION_PROFILES[state.station] || STATION_PROFILES['bms'];
    const crumbs = [];

    crumbs.push({
      label: `🌍 集团集群 (${prof.name.split(' ')[0]})`,
      active: state.rollupDepth === 0,
      onClick: () => {
        const st = nodeById.get(activeStationNodeId());
        setRollupDepth(0, st);
        selectNode(st);
      }
    });

    if (state.rollupDepth >= 1) {
      crumbs.push({
        label: `🏢 储能一体柜 (${prof.capacityKwh}kWh)`,
        active: state.rollupDepth === 1,
        onClick: () => {
          const cab = nodeById.get('sys-cabinet');
          setRollupDepth(1, cab);
          selectNode(cab);
        }
      });
    }

    if (state.rollupDepth >= 2) {
      crumbs.push({
        label: '🔋 高压电池簇 (Rack 160S1P)',
        active: state.rollupDepth === 2,
        onClick: () => {
          const rack = nodeById.get('arr-rack');
          setRollupDepth(2, rack);
          selectNode(rack);
        }
      });
    }

    if (state.rollupDepth >= 3) {
      const expCount = getExpandedModuleIds().length;
      const modText = expCount === 10
        ? '🧱 10模组全展开 (160S)'
        : (expCount > 0 ? `🧱 10串联模组 (已下钻 ${expCount} 组)` : '🧱 10串联模组 (全部上卷)');
      crumbs.push({
        label: modText,
        active: state.rollupDepth === 3 || state.rollupDepth === 4,
        onClick: () => {
          const m1 = nodeById.get('mod-01');
          setRollupDepth(3, m1);
          selectNode(m1);
        }
      });
    }

    if (state.rollupDepth === 5) {
      const cNode = nodeById.get(state.focusedMicroCellId) || nodeById.get('cell-014');
      crumbs.push({
        label: `🔬 ${cNode ? cNode.name : '电芯 #014'} (二阶RC等效电路微观拓扑)`,
        active: true,
        onClick: () => {}
      });
    }

    crumbs.forEach((c, idx) => {
      if (idx > 0) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '▸';
        trail.appendChild(sep);
      }
      const el = document.createElement('span');
      el.className = 'crumb-item' + (c.active ? ' active' : '');
      el.textContent = c.label;
      el.onclick = c.onClick;
      trail.appendChild(el);
    });
  }

  function updateDepthUI() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.depth-pill').forEach(btn => {
      const d = parseInt(btn.dataset.depth, 10);
      btn.classList.toggle('active', d === state.rollupDepth);
    });

    const statusEl = document.getElementById('kpi-depth-status');
    if (statusEl) {
      statusEl.innerHTML = `<span class="status-dot"></span>${DEPTH_DESCRIPTIONS[state.rollupDepth] || 'L3'}`;
    }

    const visCount = state.rollupDepth === 5 ? microNodes.length : visibleNodeIds.size;
    const edgeCount = state.rollupDepth === 5 ? microEdges.length : effectiveEdges.length;
    const countEl = document.getElementById('kpi-node-count');
    if (countEl) {
      countEl.textContent = `${visCount}/${nodes.length} 实体 | ${edgeCount}/${edges.length} 边`;
    }
  }

  // ----------------------------------------------------
  // Canvas Initialization & Mouse / Touch / Keyboard Interaction
  // ----------------------------------------------------
  let canvas, ctx;

  function initCanvas() {
    canvas = document.getElementById('topology-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const wrapper = document.getElementById('canvas-wrapper');
    wrapper.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    wrapper.addEventListener('dblclick', onDoubleClick);
    wrapper.addEventListener('wheel', onWheel, { passive: false });

    // Touch support
    wrapper.addEventListener('touchstart', onTouchStart, { passive: false });
    wrapper.addEventListener('touchmove', onTouchMove, { passive: false });
    wrapper.addEventListener('touchend', onTouchEnd);

    // Keyboard accessibility support
    canvas.addEventListener('keydown', onKeyDown);

    requestAnimationFrame(renderLoop);
  }

  function resizeCanvas() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.parentElement.clientWidth * dpr;
    canvas.height = canvas.parentElement.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    state.targetPanX = null;
    state.targetPanY = null;
    state.targetScale = null;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const clickedNode = findNodeAt(mx, my);
    if (clickedNode) {
      selectNode(clickedNode);
      return;
    }

    state.isDragging = true;
    state.dragStartX = e.clientX - state.panX;
    state.dragStartY = e.clientY - state.panY;
  }

  function onDoubleClick(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const clickedNode = findNodeAt(mx, my);
    if (clickedNode) {
      if (clickedNode.type === 'micro-rc') {
        rollUpOneLevel();
      } else {
        drillDownNode(clickedNode);
      }
    }
  }

  function onMouseMove(e) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (state.isDragging) {
      state.panX = e.clientX - state.dragStartX;
      state.panY = e.clientY - state.dragStartY;
    } else {
      const hovered = findNodeAt(mx, my);
      if (hovered !== state.hoveredNode) {
        state.hoveredNode = hovered;
        recomputeLineageHighlight();
        updateTooltip(hovered, e.clientX, e.clientY);
      } else if (hovered) {
        updateTooltip(hovered, e.clientX, e.clientY);
      }
    }
  }

  function onMouseUp() {
    state.isDragging = false;
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const clicked = findNodeAt(t.clientX - rect.left, t.clientY - rect.top);
    if (clicked) {
      selectNode(clicked);
      return;
    }
    state.isDragging = true;
    state.dragStartX = t.clientX - state.panX;
    state.dragStartY = t.clientY - state.panY;
  }

  function onTouchMove(e) {
    if (!state.isDragging || e.touches.length !== 1) return;
    e.preventDefault();
    const t = e.touches[0];
    state.panX = t.clientX - state.dragStartX;
    state.panY = t.clientY - state.dragStartY;
  }

  function onTouchEnd() {
    state.isDragging = false;
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && state.selectedNode) {
      drillDownNode(state.selectedNode);
    } else if (e.key === 'Backspace' || e.key === 'Escape') {
      rollUpOneLevel();
    } else if (e.key === '+' || e.key === '=') {
      state.scale = Math.min(2.5, state.scale * 1.15);
    } else if (e.key === '-') {
      state.scale = Math.max(0.3, state.scale / 1.15);
    } else if (e.key === 'ArrowLeft') {
      state.panX += 40;
    } else if (e.key === 'ArrowRight') {
      state.panX -= 40;
    } else if (e.key === 'ArrowUp') {
      state.panY += 40;
    } else if (e.key === 'ArrowDown') {
      state.panY -= 40;
    }
  }

  function onWheel(e) {
    e.preventDefault();
    state.targetPanX = null;
    state.targetPanY = null;
    state.targetScale = null;

    const zoomFactor = e.deltaY < 0 ? 1.09 : 0.91;
    const newScale = Math.max(0.28, Math.min(2.6, state.scale * zoomFactor));

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    state.panX = mouseX - (mouseX - state.panX) * (newScale / state.scale);
    state.panY = mouseY - (mouseY - state.panY) * (newScale / state.scale);
    state.scale = newScale;
  }

  function screenToWorld(sx, sy) {
    return {
      x: (sx - state.panX) / state.scale,
      y: (sy - state.panY) / state.scale
    };
  }

  function findNodeAt(sx, sy) {
    const worldPos = screenToWorld(sx, sy);

    if (state.rollupDepth === 5) {
      for (let i = microNodes.length - 1; i >= 0; i--) {
        const mn = microNodes[i];
        const dx = worldPos.x - mn.x;
        const dy = worldPos.y - mn.y;
        if (dx * dx + dy * dy <= 42 * 42) return mn;
      }
      return null;
    }

    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (visibleNodeIds.has(n.id)) {
        const radius = n.tier === 'cell' && n.type === 'cell-leaf' ? 15 : 36;
        const dx = worldPos.x - n.x;
        const dy = worldPos.y - getNodeY(n);
        if (dx * dx + dy * dy <= radius * radius) {
          return n;
        }
      }
    }
    return null;
  }

  function getNodeY(node) {
    if (node.y !== undefined) return node.y;
    const tierObj = TIER_BY_ID.get(node.tier);
    return tierObj ? tierObj.y : 100;
  }

  // ----------------------------------------------------
  // Main 60FPS Render Loop (O(V + E_vis) per frame)
  // ----------------------------------------------------
  function renderLoop() {
    state.animTime += 0.025;

    // Power-proportional particle speed & direction
    const absKw = Math.max(2.0, Math.abs(state.telemetry.powerKw || 10.0));
    const speedFactor = Math.min(3.5, Math.max(0.35, Math.log10(absKw + 1) * 0.75));
    const dir = state.telemetry.current < 0 ? -1 : 1;
    state.particlePhase = (state.particlePhase + 0.012 * speedFactor * dir + 10.0) % 1.0;

    if (state.targetPanX !== null) {
      state.panX += (state.targetPanX - state.panX) * 0.14;
      state.panY += (state.targetPanY - state.panY) * 0.14;
      state.scale += (state.targetScale - state.scale) * 0.14;
      if (Math.abs(state.targetPanX - state.panX) < 0.5 && Math.abs(state.targetScale - state.scale) < 0.005) {
        state.targetPanX = null;
        state.targetPanY = null;
        state.targetScale = null;
      }
    }

    drawCanvas();
    requestAnimationFrame(renderLoop);
  }

  function drawCanvas() {
    if (!ctx) return;
    const width = canvas.parentElement.clientWidth;
    const height = canvas.parentElement.clientHeight;

    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(state.scale, state.scale);

    if (state.rollupDepth === 5) {
      drawCellMicroTwinScene();
    } else {
      drawTierBands();
      drawExpandedModuleBoxes();
      drawEdges();
      drawNodes();
    }

    ctx.restore();
  }

  function drawTierBands() {
    TIERS.forEach(tier => {
      if (state.rollupDepth === 0 && !['fleet', 'ctrl', 'app'].includes(tier.id)) return;
      if (state.rollupDepth > 0 && tier.id === 'fleet') return;
      if (state.mode === 'powerflow' && ['app', 'ctrl'].includes(tier.id)) return;
      if (state.mode === 'bess' && ['app', 'ctrl'].includes(tier.id)) return;
      if (state.rollupDepth === 1 && ['array', 'mod', 'cell'].includes(tier.id)) return;
      if (state.rollupDepth === 2 && ['mod', 'cell'].includes(tier.id)) return;
      if (state.rollupDepth === 3 && tier.id === 'cell' && getExpandedModuleIds().length === 0) return;

      const y = tier.y;
      const bandH = (tier.id === 'cell') ? 190 : 95;
      const topY = (tier.id === 'cell') ? y - 75 : y - 48;

      ctx.fillStyle = 'rgba(30, 41, 59, 0.18)';
      ctx.fillRect(-160, topY, 2260, bandH);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 8]);
      ctx.beginPath();
      ctx.moveTo(-160, topY);
      ctx.lineTo(2100, topY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = tier.color;
      ctx.font = 'bold 12px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${tier.icon} ${tier.name.toUpperCase()} (${tier.cnName})`, -140, topY + 20);
    });
  }

  function drawExpandedModuleBoxes() {
    if (state.rollupDepth < 3 || state.rollupDepth === 5) return;

    getExpandedModuleIds().forEach(modId => {
      const modNode = nodeById.get(modId);
      if (!modNode || !visibleNodeIds.has(modNode.id)) return;
      const mIdx = modNode.modIndex - 1;
      const boxX = 82 + mIdx * 182;
      const boxY = 948;
      const boxW = 158;
      const boxH = 175;

      ctx.save();
      ctx.fillStyle = 'rgba(6, 182, 212, 0.07)';
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#22d3ee';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`🔽 Mod #0${modNode.modIndex} 子拓扑 (16S 串联)`, boxX + boxW / 2, boxY + 13);
      ctx.restore();
    });
  }

  function drawEdges() {
    const hasHover = Boolean(state.hoveredNode);

    effectiveEdges.forEach(edge => {
      const src = nodeById.get(edge.source);
      const tgt = nodeById.get(edge.target);
      if (!src || !tgt) return;

      const sx = src.x;
      const sy = getNodeY(src);
      const tx = tgt.x;
      const ty = getNodeY(tgt);

      const isHovered = (state.hoveredNode && (state.hoveredNode.id === src.id || state.hoveredNode.id === tgt.id));
      const isSelected = (state.selectedNode && (state.selectedNode.id === src.id || state.selectedNode.id === tgt.id));
      const isDimmed = hasHover && !isHovered;

      ctx.save();
      if (isDimmed) ctx.globalAlpha = 0.22;

      ctx.beginPath();
      const cp1y = sy + (ty - sy) * 0.5;
      const cp2y = sy + (ty - sy) * 0.5;
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx, cp1y, tx, cp2y, tx, ty);

      if (edge.type === 'power') {
        ctx.strokeStyle = isHovered || isSelected ? '#fbbf24' : 'rgba(245, 158, 11, 0.52)';
        ctx.lineWidth = isHovered || isSelected ? 3.5 : (edge.count > 1 ? 2.6 : 1.8);
        ctx.stroke();

        // Power flow particle animation (speed & direction coupled to real kW)
        const pt = getBezierPoint(sx, sy, sx, cp1y, tx, cp2y, tx, ty, state.particlePhase);
        ctx.fillStyle = state.telemetry.current < 0 ? '#fbbf24' : '#38bdf8';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, src.tier === 'cell' ? 2.4 : 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (edge.type === 'control') {
        ctx.strokeStyle = isHovered || isSelected ? '#c084fc' : 'rgba(168, 85, 247, 0.38)';
        ctx.lineWidth = isHovered || isSelected ? 2.5 : 1.4;
        ctx.setLineDash([4, 6]);
        ctx.lineDashOffset = -state.animTime * 20;
        ctx.stroke();
      } else if (edge.type === 'comm') {
        ctx.strokeStyle = isHovered || isSelected ? '#38bdf8' : 'rgba(56, 189, 248, 0.34)';
        ctx.lineWidth = isHovered || isSelected ? 2.4 : 1.2;
        ctx.setLineDash([3, 5]);
        ctx.lineDashOffset = -state.animTime * 15;
        ctx.stroke();
      } else {
        ctx.strokeStyle = isHovered || isSelected ? '#cbd5e1' : 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = isHovered || isSelected ? 2.0 : 1.1;
        ctx.stroke();
      }

      // Draw Rolled-Up Edge Aggregation Badge when edge is projected or merges multiple child links
      if ((edge.isProjected || edge.count > 1) && (edge.count > 1 || isHovered || isSelected)) {
        const midPt = getBezierPoint(sx, sy, sx, cp1y, tx, cp2y, tx, ty, 0.5);
        const tag = edge.count > 1 ? `×${edge.count} 上卷链路` : `🔼 ${edge.label}`;
        ctx.setLineDash([]);
        ctx.font = 'bold 9px monospace';
        const tw = ctx.measureText(tag).width + 8;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(midPt.x - tw / 2, midPt.y - 7, tw, 14, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#e2e8f0';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tag, midPt.x, midPt.y);
      }

      ctx.restore();
    });
  }

  function getBezierPoint(x0, y0, x1, y1, x2, y2, x3, y3, t) {
    const cx = 3 * (x1 - x0);
    const bx = 3 * (x2 - x1) - cx;
    const ax = x3 - x0 - cx - bx;
    const cy = 3 * (y1 - y0);
    const by = 3 * (y2 - y1) - cy;
    const ay = y3 - y0 - cy - by;
    return {
      x: ax * (t * t * t) + bx * (t * t) + cx * t + x0,
      y: ay * (t * t * t) + by * (t * t) + cy * t + y0
    };
  }

  function drawNodes() {
    const hasHover = Boolean(state.hoveredNode);

    nodes.forEach(node => {
      if (!visibleNodeIds.has(node.id)) return;
      const ny = getNodeY(node);
      const isSelected = (state.selectedNode && state.selectedNode.id === node.id);
      const isHovered = (state.hoveredNode && state.hoveredNode.id === node.id);
      const isDimmed = hasHover && !lineageNodeIds.has(node.id);

      ctx.save();
      if (isDimmed) ctx.globalAlpha = 0.28;
      if (node.tier === 'cell' && node.type === 'cell-leaf') {
        drawCellNode(node, node.x, ny, isSelected, isHovered);
      } else {
        drawMacroNode(node, node.x, ny, isSelected, isHovered);
      }
      ctx.restore();
    });
  }

  function drawMacroNode(node, x, y, isSelected, isHovered) {
    const tierObj = TIER_BY_ID.get(node.tier);
    const tierColor = tierObj ? tierObj.color : '#3b82f6';
    const radius = node.tier === 'fleet' ? 36 : 28;

    const badgeText = formatContainerBadge(node);
    const isRolledUpContainer = node.isExpandable && node.tier !== 'cell' && !state.expandedContainers.has(node.id);

    if (isRolledUpContainer) {
      ctx.save();
      ctx.strokeStyle = node.status === 'warning' ? '#f59e0b' : (node.status === 'critical' ? '#ef4444' : tierColor);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -state.animTime * 8;
      ctx.beginPath();
      ctx.arc(x, y, radius + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (isSelected || isHovered) {
      ctx.shadowColor = tierColor;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    const grad = ctx.createRadialGradient(x - 5, y - 5, 2, x, y, radius);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = tierColor;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.font = `${node.tier === 'fleet' ? 22 : 18}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.icon, x, y);

    // Status Dot (reflects true worst-of-children propagated status)
    ctx.fillStyle = node.status === 'critical' ? '#ef4444' : (node.status === 'warning' ? '#f59e0b' : '#10b981');
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(x + radius * 0.7, y - radius * 0.7, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (badgeText) {
      ctx.font = 'bold 9px -apple-system, sans-serif';
      const bw = ctx.measureText(badgeText).width + 10;
      const bx = x - bw / 2;
      const by = y - radius - 22;

      ctx.fillStyle = isRolledUpContainer ? 'rgba(16, 185, 129, 0.92)' : 'rgba(245, 158, 11, 0.92)';
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, 15, 4);
      ctx.fill();

      ctx.fillStyle = '#051b14';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, x, by + 7.5);
    }

    // Module 16-Cell Mini Roll-Up Health Spectrum Bar
    if (node.tier === 'mod' && node.rollup && node.rollup.cellVoltages) {
      const barW = 96;
      const barH = 5;
      const startX = x - barW / 2;
      const barY = y + radius + 5;
      const segW = barW / 16;

      node.rollup.cellVoltages.forEach((cv, idx) => {
        ctx.fillStyle = cv >= 3312 ? '#f59e0b' : (cv <= 3288 ? '#3b82f6' : '#10b981');
        ctx.fillRect(startX + idx * segW, barY, segW - 1, barH);
      });
    }

    const labelOffsetY = (node.tier === 'mod') ? radius + 19 : radius + 14;
    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText(node.name, x, y + labelOffsetY);

    if (node.metrics) {
      ctx.font = '10px monospace';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(node.metrics, x, y + labelOffsetY + 13);
    }
  }

  function drawCellNode(node, x, y, isSelected, isHovered) {
    const size = 12;
    let cellColor = '#10b981';
    if (node.isMaxV) cellColor = '#f59e0b';
    else if (node.isMinV) cellColor = '#3b82f6';
    else if (node.isMaxT) cellColor = '#ef4444';
    else if (node.isMinT) cellColor = '#06b6d4';
    else if (node.status === 'warning') cellColor = '#eab308';

    if (isSelected || isHovered) {
      ctx.shadowColor = cellColor;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - size - 1, y - size - 1, size * 2 + 2, size * 2 + 2);
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = cellColor;
    ctx.beginPath();
    ctx.roundRect(x - size + 1, y - size + 1, size * 2 - 2, size * 2 - 2, 3);
    ctx.fill();

    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = '#06131f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.cellIndex || '', x, y);
  }

  // ----------------------------------------------------
  // Level 5: Cell Micro-Twin Equivalent Circuit Renderer
  // ----------------------------------------------------
  function drawCellMicroTwinScene() {
    const cNode = nodeById.get(state.focusedMicroCellId) || nodeById.get('cell-014');

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(220, 170, 1240, 650, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#22d3ee';
    ctx.font = 'bold 16px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`🔬 ${cNode ? cNode.name : '电芯 #014'} — 二阶 Thevenin RC 等效电路与焦耳热耦合微观数字孪生 (双击节点或点击上卷返回模组)`, 250, 210);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px monospace';
    ctx.fillText(`状态方程: V_term(t) = V_ocv(SOC) - I(t)·R0 - U_1(t) - U_2(t)   |   反推开路电压: V_ocv = V_term + I·R0 + U_1 + U_2`, 250, 234);
    ctx.restore();

    microEdges.forEach(e => {
      const s = microNodes.find(n => n.id === e.source);
      const t = microNodes.find(n => n.id === e.target);
      if (!s || !t) return;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = e.type === 'power' ? '#fbbf24' : '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      const px = s.x + (t.x - s.x) * state.particlePhase;
      const py = s.y + (t.y - s.y) * state.particlePhase;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(e.label, (s.x + t.x) / 2, (s.y + t.y) / 2 - 8);
      ctx.restore();
    });

    microNodes.forEach(mn => {
      const isHovered = state.hoveredNode && state.hoveredNode.id === mn.id;
      drawMacroNode(mn, mn.x, mn.y, false, isHovered);
    });
  }

  // ----------------------------------------------------
  // Selection & Non-Destructive Inspector Drawer
  // ----------------------------------------------------
  function selectNode(node) {
    if (!node) return;
    state.selectedNode = node;
    recomputeLineageHighlight();
    if (typeof document === 'undefined') return;
    const drawer = document.getElementById('inspector-drawer');
    if (drawer) drawer.classList.remove('collapsed');
    populateDrawer(node);
  }

  function populateDrawer(node) {
    if (typeof document === 'undefined' || !node) return;
    const tierObj = TIER_BY_ID.get(node.tier);
    const badge = document.getElementById('drawer-badge');
    if (badge) {
      badge.textContent = tierObj ? `${tierObj.name} (${tierObj.cnName})` : node.tier;
      badge.style.background = tierObj ? `${tierObj.color}25` : '#3b82f625';
      badge.style.color = tierObj ? tierObj.color : '#3b82f6';
      badge.style.border = `1px solid ${tierObj ? tierObj.color : '#3b82f6'}`;
    }

    document.getElementById('drawer-title').textContent = node.name;
    document.getElementById('drawer-subtitle').textContent = `ID: ${node.id} | Parent: ${node.parentId || 'ROOT'} | Status: ${(node.status || 'normal').toUpperCase()}`;

    const btnDrill = document.getElementById('btn-drawer-drilldown');
    const lblDrill = document.getElementById('lbl-drawer-drilldown');
    const btnRoll = document.getElementById('btn-drawer-rollup');
    const lblRoll = document.getElementById('lbl-drawer-rollup');

    if (node.isExpandable) {
      btnDrill.disabled = false;
      if (node.tier === 'mod') {
        const isExp = state.expandedContainers.has(node.id);
        lblDrill.textContent = isExp ? '收起16颗电芯 (Roll Up)' : '下钻16颗电芯 (Drill Down)';
      } else if (node.tier === 'cell') {
        lblDrill.textContent = '下钻电芯RC电路 (Micro Twin)';
      } else {
        lblDrill.textContent = '下钻展开子拓扑 (Drill Down)';
      }
      btnDrill.onclick = () => drillDownNode(node);
    } else {
      btnDrill.disabled = true;
      lblDrill.textContent = '已达叶节点';
    }

    if (node.parentId || state.rollupDepth > 0) {
      btnRoll.disabled = false;
      lblRoll.textContent = node.parentId ? `上卷至 ${node.parentId}` : '上卷至集群 (L0)';
      btnRoll.onclick = () => {
        if (node.parentId) {
          const pNode = nodeById.get(node.parentId);
          if (pNode) {
            if (node.tier === 'cell' && state.rollupDepth === 5) {
              setRollupDepth(3, pNode);
            } else if (node.tier === 'cell') {
              // Works cleanly in both L3 and L4!
              state.expandedContainers.delete(pNode.id);
              state.savedL3Modules = getExpandedModuleIds();
              if (state.rollupDepth === 4) state.rollupDepth = 3;
            } else if (node.tier === 'mod') {
              setRollupDepth(2, pNode);
            } else if (node.tier === 'array') {
              setRollupDepth(1, pNode);
            } else if (node.tier === 'sys') {
              setRollupDepth(0, pNode);
            }
            recomputeVisibilityCache();
            selectNode(pNode);
            updateBreadcrumb();
            updateDepthUI();
            updateLeftRail();
            return;
          }
        }
        rollUpOneLevel();
      };
    } else {
      btnRoll.disabled = true;
      lblRoll.textContent = '已达顶层集群';
    }

    // Build Child Entities & Dependency Lists once on selection/structure change
    populateChildEntitiesList(node);
    populateDependencies(node);

    // Update live numerical values & sparkline
    refreshDrawerLiveValues(node);
  }

  // Non-destructive live value updater (called every 1.5s without wiping interactive child/dep lists)
  function refreshDrawerLiveValues(node) {
    if (typeof document === 'undefined' || !node) return;

    document.getElementById('drawer-subtitle').textContent = `ID: ${node.id} | Parent: ${node.parentId || 'ROOT'} | Status: ${(node.status || 'normal').toUpperCase()}`;

    const rollupSec = document.getElementById('drawer-rollup-section');
    const rollupBox = document.getElementById('drawer-rollup-box');
    const rollupBadge = document.getElementById('drawer-rollup-badge');

    if (node.rollup) {
      rollupSec.style.display = 'block';
      rollupBadge.textContent = `${node.rollup.childCount}`;
      rollupBox.innerHTML = `
        <div class="rollup-formula-row">
          <span class="rollup-key"><span class="rollup-math-tag">∑ SUM</span> 子级累加电压/容量</span>
          <span class="rollup-val" style="color:#34d399;">${node.rollup.sumV}</span>
        </div>
        <div class="rollup-formula-row">
          <span class="rollup-key"><span class="rollup-math-tag">μ AVG</span> 子级算术均值</span>
          <span class="rollup-val">${node.rollup.avgV}</span>
        </div>
        <div class="rollup-formula-row">
          <span class="rollup-key"><span class="rollup-math-tag">MAX</span> 穿透最高极值定位</span>
          <span class="rollup-val" style="color:#fbbf24;">${node.rollup.maxVal}</span>
        </div>
        <div class="rollup-formula-row">
          <span class="rollup-key"><span class="rollup-math-tag">MIN</span> 穿透最低极值定位</span>
          <span class="rollup-val" style="color:#38bdf8;">${node.rollup.minVal}</span>
        </div>
        <div class="rollup-formula-row">
          <span class="rollup-key"><span class="rollup-math-tag">Δ SPREAD</span> 内部离散极差</span>
          <span class="rollup-val" style="color:#f43f5e;">${node.rollup.spread}</span>
        </div>
        <div class="rollup-formula-row">
          <span class="rollup-key"><span class="rollup-math-tag">STATUS</span> 状态最差传染上卷</span>
          <span class="rollup-val">${node.rollup.worstStatus}</span>
        </div>
      `;
    } else {
      rollupSec.style.display = 'none';
    }

    const metricsContainer = document.getElementById('drawer-metrics');
    metricsContainer.innerHTML = '';

    if (node.tier === 'cell' && node.cellIndex) {
      const v = state.telemetry.cellsV[node.cellIndex - 1] || 3300;
      const t = state.telemetry.cellsT[node.cellIndex - 1] || 24.0;
      addMetricCard(metricsContainer, '单体电压 (Cell V)', v, 'mV');
      addMetricCard(metricsContainer, '单体温度 (Cell T)', t.toFixed(1), '°C');
      addMetricCard(metricsContainer, '所属模组 (Parent)', `Mod #0${node.modIndex}`, '');
      addMetricCard(metricsContainer, '极值/均衡状态', node.isMaxV ? 'MAX V ⚡' : (node.isMinV ? 'MIN V 💧' : (node.isMaxT ? 'MAX T 🔥' : 'NORMAL')), '');
    } else if (node.tier === 'mod') {
      const mv = state.telemetry.modulesV[node.modIndex - 1] || 52.8;
      const mt = state.telemetry.modulesT[node.modIndex - 1] || 24.0;
      addMetricCard(metricsContainer, '模组上卷总压 (∑V)', mv.toFixed(2), 'V');
      addMetricCard(metricsContainer, '模组算术均温 (μT)', mt.toFixed(1), '°C');
      addMetricCard(metricsContainer, '下辖电芯状态', state.expandedContainers.has(node.id) ? '已展开 (16S)' : '已上卷聚合 (16S)', '');
      addMetricCard(metricsContainer, '传染健康状态', node.status.toUpperCase(), '');
    } else {
      addMetricCard(metricsContainer, '簇端电压 (Pack V)', state.telemetry.voltage, 'V');
      addMetricCard(metricsContainer, '充放电电流 (Current)', state.telemetry.current.toFixed(1), 'A');
      addMetricCard(metricsContainer, '荷电状态 (SOC)', state.telemetry.soc.toFixed(1), '%');
      addMetricCard(metricsContainer, '全簇最大压差 (ΔV)', state.telemetry.deltaV, 'mV');
    }

    // Update child metric tags in-place without rebuilding DOM elements
    const childList = document.getElementById('drawer-children-list');
    if (childList) {
      childList.querySelectorAll('[data-child-id]').forEach(el => {
        const ch = nodeById.get(el.getAttribute('data-child-id'));
        if (ch) el.textContent = ch.metrics || '下钻 🔽';
      });
    }

    drawSparkline(node);
  }

  function addMetricCard(container, label, val, unit) {
    const card = document.createElement('div');
    card.className = 'metric-card';
    card.innerHTML = `
      <div class="metric-card-label">${label}</div>
      <div class="metric-card-val">${val}<span class="metric-card-unit">${unit}</span></div>
    `;
    container.appendChild(card);
  }

  function populateChildEntitiesList(node) {
    const sec = document.getElementById('drawer-children-section');
    const list = document.getElementById('drawer-children-list');
    const countSpan = document.getElementById('drawer-children-count');
    list.innerHTML = '';

    const children = childrenById.get(node.id) || [];
    if (children.length === 0) {
      sec.style.display = 'none';
      return;
    }

    sec.style.display = 'block';
    countSpan.textContent = `共 ${children.length} 个子实体`;

    children.forEach(ch => {
      const item = document.createElement('div');
      item.className = 'dep-node-item';
      item.innerHTML = `
        <span>${ch.icon} <b>${ch.name}</b></span>
        <span class="dep-drill-tag" data-child-id="${ch.id}">${ch.metrics || '下钻 🔽'}</span>
      `;
      item.onclick = () => {
        state.expandedContainers.add(node.id);
        if (node.tier === 'mod' && state.rollupDepth < 3) state.rollupDepth = 3;
        else if (node.id === 'arr-rack' && state.rollupDepth < 3) state.rollupDepth = 3;
        else if (node.id === 'sys-cabinet' && state.rollupDepth < 2) state.rollupDepth = 2;
        else if (node.tier === 'fleet' && state.rollupDepth === 0) state.rollupDepth = 1;
        recomputeVisibilityCache();
        updateDepthUI();
        updateBreadcrumb();
        updateLeftRail();
        selectNode(ch);
      };
      list.appendChild(item);
    });
  }

  function populateDependencies(node) {
    const inContainer = document.getElementById('drawer-deps-in');
    const outContainer = document.getElementById('drawer-deps-out');
    inContainer.innerHTML = '';
    outContainer.innerHTML = '';

    if (node.parentId) {
      const pNode = nodeById.get(node.parentId);
      if (pNode) {
        const pItem = document.createElement('div');
        pItem.className = 'dep-node-item';
        pItem.style.borderColor = '#f59e0b';
        pItem.innerHTML = `<span>🔼 <b>父容器: ${pNode.icon} ${pNode.name}</b></span><span style="font-size:10px;color:#fbbf24;">点击上卷 (Roll Up)</span>`;
        pItem.onclick = () => document.getElementById('btn-drawer-rollup').click();
        inContainer.appendChild(pItem);
      }
    }

    const inEdges = inEdgesById.get(node.id) || [];
    const outEdges = outEdgesById.get(node.id) || [];

    inEdges.forEach(e => {
      const srcNode = nodeById.get(e.source);
      if (srcNode) {
        const item = document.createElement('div');
        item.className = 'dep-node-item';
        item.innerHTML = `<span>${srcNode.icon} ${srcNode.name}</span><span style="font-size:10px;color:#94a3b8;">${e.label}</span>`;
        item.onclick = () => selectNode(srcNode);
        inContainer.appendChild(item);
      }
    });

    if (outEdges.length === 0) {
      outContainer.innerHTML = '<div style="font-size:11px;color:#64748b;">(无横向输出边，双击节点可下钻或上卷)</div>';
    } else {
      outEdges.forEach(e => {
        const tgtNode = nodeById.get(e.target);
        if (tgtNode) {
          const item = document.createElement('div');
          item.className = 'dep-node-item';
          item.innerHTML = `<span>${tgtNode.icon} ${tgtNode.name}</span><span style="font-size:10px;color:#94a3b8;">${e.label}</span>`;
          item.onclick = () => selectNode(tgtNode);
          outContainer.appendChild(item);
        }
      });
    }
  }

  function drawSparkline(node) {
    const cvs = document.getElementById('sparkline-canvas');
    if (!cvs) return;
    const sctx = cvs.getContext('2d');
    const w = cvs.clientWidth || 340;
    const h = cvs.clientHeight || 64;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = w * dpr;
    cvs.height = h * dpr;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, w, h);

    const entry = (node && state.nodeHistory.get(node.id)) || state.nodeHistory.get('arr-rack') || { label: 'Pack V', unit: 'V', values: Array(30).fill(528) };
    const lblEl = document.getElementById('sparkline-metric-label');
    if (lblEl) {
      const latest = entry.values[entry.values.length - 1];
      lblEl.textContent = `${entry.label}: ${latest} ${entry.unit}`;
    }

    const data = entry.values;
    const min = Math.min(...data) - 0.5;
    const max = Math.max(...data) + 0.5;

    sctx.strokeStyle = '#38bdf8';
    sctx.lineWidth = 2;
    sctx.beginPath();
    data.forEach((val, i) => {
      const x = (i / Math.max(1, data.length - 1)) * w;
      const y = h - ((val - min) / Math.max(0.001, max - min)) * (h - 12) - 6;
      if (i === 0) sctx.moveTo(x, y);
      else sctx.lineTo(x, y);
    });
    sctx.stroke();

    sctx.lineTo(w, h);
    sctx.lineTo(0, h);
    sctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    sctx.fill();
  }

  function updateTooltip(node, mouseX, mouseY) {
    const tip = document.getElementById('smartscape-tooltip');
    if (!tip) return;
    if (!node) {
      tip.style.display = 'none';
      return;
    }
    tip.style.display = 'block';
    tip.style.left = `${mouseX}px`;
    tip.style.top = `${mouseY}px`;

    const tierObj = TIER_BY_ID.get(node.tier);
    let rollupInfo = '';
    if (node.rollup) {
      rollupInfo = `
        <div class="tooltip-row"><span>📦 已聚合子实体:</span><span class="tooltip-val" style="color:#fbbf24;">${node.rollup.childCount}</span></div>
        <div class="tooltip-row"><span>∑ 上卷累加值:</span><span class="tooltip-val" style="color:#34d399;">${node.rollup.sumV}</span></div>
        <div class="tooltip-row"><span>Δ 内部极差:</span><span class="tooltip-val" style="color:#f43f5e;">${node.rollup.spread}</span></div>
        <div class="tooltip-row"><span>🛡️ 传染状态:</span><span class="tooltip-val">${node.rollup.worstStatus}</span></div>
      `;
    }

    const actionHint = node.isExpandable
      ? (state.expandedContainers.has(node.id) ? '💡 双击节点：收起子实体向上卷曲 (Roll-Up)' : '💡 双击节点：向下钻取展开子拓扑 (Drill-Down)')
      : '💡 单击查看实体详情与上游父容器';

    tip.innerHTML = `
      <div class="tooltip-title">${node.icon} ${node.name}</div>
      <div class="tooltip-row"><span>所属层级:</span><span class="tooltip-val">${tierObj ? tierObj.cnName : node.tier}</span></div>
      <div class="tooltip-row"><span>实时遥测:</span><span class="tooltip-val" style="color:#38bdf8;">${node.metrics || 'NORMAL'}</span></div>
      ${rollupInfo}
      <div class="tooltip-hint">${actionHint}</div>
    `;
  }

  // ----------------------------------------------------
  // Live Telemetry Polling (Real InfluxDB 160-Cell + Fleet Pipeline)
  // ----------------------------------------------------
  function parseInfluxCsv(csvText) {
    const result = {};
    const lines = csvText.split(/\r?\n/);
    let valueIdx = -1;
    let fieldIdx = -1;
    let edgeIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;
      const cols = line.split(',');
      if (cols[1] === 'result' || cols.includes('_field')) {
        valueIdx = cols.indexOf('_value');
        fieldIdx = cols.indexOf('_field');
        edgeIdx = cols.indexOf('edge');
        continue;
      }
      if (valueIdx >= 0 && fieldIdx >= 0 && cols.length > Math.max(valueIdx, fieldIdx)) {
        const field = cols[fieldIdx];
        const val = parseFloat(cols[valueIdx]);
        const edge = edgeIdx >= 0 ? cols[edgeIdx] : state.station;
        if (!Number.isNaN(val)) {
          if (edgeIdx >= 0) {
            if (!result[edge]) result[edge] = {};
            result[edge][field] = val;
          } else {
            result[field] = val;
          }
        }
      }
    }
    return result;
  }

  async function pollLiveTelemetry() {
    if (state.isPolling || typeof fetch === 'undefined') return;
    state.isPolling = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);

    try {
      const stationQuery = `from(bucket: "openems")
  |> range(start: -5m)
  |> filter(fn: (r) => r.edge == "${state.station}" and r._measurement == "data")
  |> last()
  |> keep(columns: ["_field", "_value"])`;

      const fleetQuery = `from(bucket: "openems")
  |> range(start: -5m)
  |> filter(fn: (r) => r._measurement == "data" and (r._field == "cabinet0/ActivePower" or r._field == "battery0/Soc"))
  |> last()
  |> keep(columns: ["edge", "_field", "_value"])`;

      const [resStation, resFleet] = await Promise.all([
        fetch('/openems-influx', { method: 'POST', body: stationQuery, signal: ctrl.signal }),
        fetch('/openems-influx', { method: 'POST', body: fleetQuery, signal: ctrl.signal })
      ]);

      if (!resStation.ok) throw new Error(`Influx HTTP ${resStation.status}`);

      const csvText = await resStation.text();
      const data = parseInfluxCsv(csvText);

      if (resFleet.ok) {
        const fleetCsv = await resFleet.text();
        const fleetData = parseInfluxCsv(fleetCsv);
        Object.keys(fleetData).forEach(eKey => {
          if (!state.telemetry.fleetLive[eKey]) state.telemetry.fleetLive[eKey] = { powerKw: 0, soc: 50 };
          if (fleetData[eKey]['cabinet0/ActivePower'] !== undefined) {
            state.telemetry.fleetLive[eKey].powerKw = +(fleetData[eKey]['cabinet0/ActivePower'] / 1000.0).toFixed(1);
          }
          if (fleetData[eKey]['battery0/Soc'] !== undefined) {
            state.telemetry.fleetLive[eKey].soc = fleetData[eKey]['battery0/Soc'];
          }
        });
      }

      // Populate real pack & cabinet metrics
      if (data['battery0/Voltage'] !== undefined) state.telemetry.voltage = data['battery0/Voltage'];
      if (data['battery0/Current'] !== undefined) state.telemetry.current = data['battery0/Current'];
      if (data['battery0/Soc'] !== undefined) state.telemetry.soc = data['battery0/Soc'];
      if (data['battery0/Soh'] !== undefined) state.telemetry.soh = data['battery0/Soh'];
      if (data['battery0/CycleCount'] !== undefined) state.telemetry.cycleCount = data['battery0/CycleCount'];
      if (data['battery0/InsulationResistance'] !== undefined) state.telemetry.insulation = data['battery0/InsulationResistance'];
      if (data['battery0/ChargeMaxCurrent'] !== undefined) state.telemetry.chargeMaxA = data['battery0/ChargeMaxCurrent'];
      if (data['battery0/DischargeMaxCurrent'] !== undefined) state.telemetry.dischargeMaxA = data['battery0/DischargeMaxCurrent'];

      if (data['cabinet0/ActivePower'] !== undefined) {
        state.telemetry.powerKw = +(data['cabinet0/ActivePower'] / 1000.0).toFixed(1);
      } else {
        state.telemetry.powerKw = +(state.telemetry.voltage * state.telemetry.current / 1000.0).toFixed(1);
      }
      if (data['cabinet0/AmbientTemp'] !== undefined) state.telemetry.ambientT = +(data['cabinet0/AmbientTemp'] / 10.0).toFixed(1);
      if (data['cabinet0/HvacStatus'] !== undefined) state.telemetry.hvacStatus = data['cabinet0/HvacStatus'];
      if (data['cabinet0/RteEfficiency'] !== undefined) state.telemetry.rteEfficiency = +(data['cabinet0/RteEfficiency'] / 10.0).toFixed(1);

      // Populate real 160 cells voltage & temperature from InfluxDB
      for (let c = 1; c <= 160; c++) {
        const keyV = `battery0/Cell_${c < 10 ? '00' + c : (c < 100 ? '0' + c : c)}_V`;
        const keyT = `battery0/Cell_${c < 10 ? '00' + c : (c < 100 ? '0' + c : c)}_T`;
        if (data[keyV] !== undefined) {
          state.telemetry.cellsV[c - 1] = Math.round(data[keyV]);
        }
        if (data[keyT] !== undefined) {
          state.telemetry.cellsT[c - 1] = +(data[keyT] / 10.0).toFixed(1);
        } else {
          // Fallback to parent module temperature if Cell_xxx_T not yet present
          const mNo = Math.floor((c - 1) / 16) + 1;
          const mTempKey = `battery0/Module_${mNo < 10 ? '0' + mNo : mNo}_Temp`;
          if (data[mTempKey] !== undefined) {
            state.telemetry.cellsT[c - 1] = +(data[mTempKey] / 10.0).toFixed(1);
          }
        }
      }

      state.connHealthy = true;
      state.lastSyncTime = new Date();

      computeRollUpAggregations();
      if (state.rollupDepth === 5) {
        const cNode = nodeById.get(state.focusedMicroCellId);
        if (cNode) buildCellMicroTwin(cNode);
      }
      updateTopBanner();

      if (state.selectedNode) {
        refreshDrawerLiveValues(state.selectedNode);
      }
    } catch (err) {
      state.connHealthy = false;
      updateTopBanner();
    } finally {
      clearTimeout(timer);
      state.isPolling = false;
    }
  }

  function updateTopBanner() {
    if (typeof document === 'undefined') return;
    const connEl = document.getElementById('kpi-conn-status');
    if (connEl) {
      if (state.connHealthy) {
        connEl.textContent = `🟢 实时同步 (${state.station})`;
        connEl.style.color = '#10b981';
      } else {
        connEl.textContent = '🟠 遥测重连中 (缓存态)';
        connEl.style.color = '#f59e0b';
      }
    }

    const kpiEl = document.getElementById('kpi-power');
    if (kpiEl) {
      const p = state.telemetry.powerKw;
      kpiEl.textContent = `${p > 0 ? '+' : ''}${p} kW (${p < 0 ? '填谷充电' : (p > 0 ? '削峰放电' : '待机')})`;
      kpiEl.style.color = p < 0 ? '#fbbf24' : '#38bdf8';
    }
    const socEl = document.getElementById('kpi-soc');
    if (socEl) socEl.textContent = `${state.telemetry.voltage}V | ${state.telemetry.soc.toFixed(1)}%`;
    const deltaEl = document.getElementById('kpi-delta-v');
    if (deltaEl) deltaEl.textContent = `${state.telemetry.deltaV} mV (#${state.telemetry.maxCellNo}/#${state.telemetry.minCellNo})`;
  }

  // ----------------------------------------------------
  // Left Vertical Smartscape Rail & UI Controls
  // ----------------------------------------------------
  function updateLeftRail() {
    if (typeof document === 'undefined') return;
    const rail = document.getElementById('smartscape-rail');
    if (!rail) return;
    rail.innerHTML = '';

    TIERS.forEach(tier => {
      if (tier.id === 'fleet' && state.rollupDepth > 0) return;
      const tierNodes = nodes.filter(n => n.tier === tier.id);
      const visTierNodes = tierNodes.filter(n => visibleNodeIds.has(n.id));
      const isRolledUp = visTierNodes.length === 0 && tier.id !== 'fleet';

      const btn = document.createElement('div');
      btn.className = 'rail-tier-btn' + (state.activeTier === tier.id ? ' active' : '') + (isRolledUp ? ' rolled-up' : '');
      btn.innerHTML = `
        <span class="tier-icon">${tier.icon}</span>
        <span class="tier-label">${tier.cnName.replace('层', '')}</span>
        <span class="tier-badge">${visTierNodes.length}/${tierNodes.length}</span>
        ${isRolledUp ? '<span class="tier-state-tag">已上卷</span>' : ''}
      `;
      btn.onclick = () => {
        if (isRolledUp) {
          const reqDepth = tier.id === 'sys' ? 1 : (tier.id === 'array' ? 2 : (tier.id === 'mod' ? 3 : 4));
          setRollupDepth(reqDepth);
          return;
        }
        if (state.activeTier === tier.id) {
          state.activeTier = null;
        } else {
          state.activeTier = tier.id;
          if (canvas && canvas.parentElement) {
            const canvasH = canvas.parentElement.clientHeight;
            animateCameraTo(state.panX, canvasH / 2 - tier.y * state.scale, state.scale);
          }
        }
        recomputeVisibilityCache();
        updateLeftRail();
        updateDepthUI();
      };
      rail.appendChild(btn);
    });
  }

  function initUI() {
    // Parse ?station= or ?edge= URL query parameter for Grafana variable linkage
    if (typeof window !== 'undefined' && window.location) {
      const params = new URLSearchParams(window.location.search);
      const urlStation = params.get('station') || params.get('edge');
      if (urlStation && STATION_PROFILES[urlStation]) {
        state.station = urlStation;
        const sel = document.getElementById('station-select');
        if (sel) sel.value = urlStation;
      }
    }

    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.mode = tab.dataset.mode;
        recomputeVisibilityCache();
        updateLeftRail();
        updateDepthUI();
      });
    });

    document.querySelectorAll('.depth-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = parseInt(btn.dataset.depth, 10);
        setRollupDepth(d);
      });
    });

    document.getElementById('btn-top-drilldown').onclick = () => drillDownOneLevel();
    document.getElementById('btn-top-rollup').onclick = () => rollUpOneLevel();

    document.getElementById('btn-expand-all-mods').onclick = () => setRollupDepth(4);
    document.getElementById('btn-collapse-all-mods').onclick = () => {
      state.savedL3Modules = [];
      setRollupDepth(3);
    };

    document.getElementById('drawer-close').onclick = () => {
      document.getElementById('inspector-drawer').classList.add('collapsed');
      state.selectedNode = null;
      recomputeLineageHighlight();
    };

    document.getElementById('btn-zoom-in').onclick = () => { state.scale = Math.min(2.5, state.scale * 1.2); };
    document.getElementById('btn-zoom-out').onclick = () => { state.scale = Math.max(0.3, state.scale / 1.2); };
    document.getElementById('btn-fit').onclick = () => {
      state.activeTier = null;
      setRollupDepth(3);
    };

    document.getElementById('search-box').addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim();
      recomputeVisibilityCache();
      updateDepthUI();
      updateLeftRail();
    });

    document.getElementById('station-select').addEventListener('change', (e) => {
      switchStation(e.target.value);
    });

    updateLeftRail();
    updateBreadcrumb();
    updateDepthUI();

    const initialNode = nodeById.get('mod-01');
    if (initialNode) {
      selectNode(initialNode);
    }
  }

  // Browser bootstrap
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      buildGraphData();
      initCanvas();
      initUI();
      updateTopBanner();

      setInterval(pollLiveTelemetry, 1500);
      pollLiveTelemetry();
    });
  }

  // Export public API for automated Node.js unit testing
  return {
    state,
    nodes,
    edges,
    nodeById,
    childrenById,
    visibleNodeIds,
     getEffectiveEdges: () => effectiveEdges,
    buildGraphData,
    computeRollUpAggregations,
    buildCellMicroTwin,
    setRollupDepth,
    drillDownNode,
    rollUpOneLevel,
    recomputeVisibilityCache,
    getDescendantSummary,
    maxSeverityStatus
  };
});
