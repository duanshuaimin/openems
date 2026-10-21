/**
 * Dynatrace-Style Smartscape Full-Stack Interactive Topology Engine
 * Core Capabilities:
 *   1. Multi-Tier Vertical & Horizontal Lineage Visualization
 *   2. Hierarchical Drill-Down (逐级下钻: Fleet -> Cabinet -> Rack -> Module -> 16 Cells -> Cell RC Micro-Twin)
 *   3. Bottom-Up Mathematical Roll-Up (自底向上聚合: ∑Sum, Mean, Max/Min Pinpointing, ΔSpread, Worst-Status Propagation)
 *   4. Interactive Breadcrumb Trail, Double-Click Expand/Collapse, and Drawer Roll-Up Analytics
 */

(function () {
  'use strict';

  // ----------------------------------------------------
  // Tier Definitions
  // ----------------------------------------------------
  const TIERS = [
    { id: 'fleet', name: 'Fleet Stations', cnName: '多站集群层', icon: '🌍', color: '#38bdf8', y: 90, minDepth: 0, maxDepth: 0 },
    { id: 'app', name: 'Applications', cnName: '业务调度层', icon: '🌐', color: '#00d2ff', y: 90, minDepth: 1, maxDepth: 4 },
    { id: 'ctrl', name: 'Control Plane', cnName: '控制中枢层', icon: '⚙️', color: '#a855f7', y: 240, minDepth: 0, maxDepth: 4 },
    { id: 'sys', name: 'Systems & Cabinets', cnName: '系统储能柜层', icon: '🏢', color: '#10b981', y: 410, minDepth: 1, maxDepth: 4 },
    { id: 'array', name: 'DC Arrays & Racks', cnName: '阵列与电池簇层', icon: '⚡', color: '#f59e0b', y: 600, minDepth: 2, maxDepth: 4 },
    { id: 'mod', name: 'Battery Modules', cnName: '串联模组层', icon: '🧱', color: '#ec4899', y: 800, minDepth: 3, maxDepth: 4 },
    { id: 'cell', name: 'Battery Cells', cnName: '单体电芯层', icon: '🔬', color: '#06b6d4', y: 1030, minDepth: 3, maxDepth: 5 }
  ];

  const DEPTH_DESCRIPTIONS = {
    0: 'L0: 集团车队上卷态 (Fleet Roll-Up)',
    1: 'L1: 储能柜系统上卷态 (Cabinet Roll-Up)',
    2: 'L2: 高压电池簇上卷态 (Rack Roll-Up)',
    3: 'L3: 10模组聚合态 (Module Roll-Up)',
    4: 'L4: 160电芯全展开态 (Full 160-Cell Unroll)',
    5: 'L5: 电芯内部二阶RC微观下钻 (Cell Micro Twin)'
  };

  // ----------------------------------------------------
  // Global State
  // ----------------------------------------------------
  const state = {
    mode: 'smartscape',       // 'smartscape' | 'powerflow' | 'controlcomm' | 'bess'
    rollupDepth: 3,           // 0: Fleet, 1: Cabinet, 2: Rack, 3: Module (default), 4: All 160 Cells, 5: Cell RC Micro-Twin
    expandedModules: new Set(['mod-01']), // In Depth 3, Mod #01 is expanded by default to demonstrate selective drill-down!
    focusedMicroCellId: null, // When rollupDepth === 5, which cell (e.g. 'cell-014') is drilled into
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
    telemetry: {
      voltage: 528.0,
      current: -24.5,
      soc: 68.5,
      soh: 99,
      cycleCount: 185,
      powerKw: -12.9,
      maxCellV: 3314,
      minCellV: 3287,
      maxCellNo: 14,
      minCellNo: 3,
      maxCellT: 26.4,
      minCellT: 24.1,
      maxTempNo: 8,
      minTempNo: 1,
      deltaV: 27,
      deltaT: 2.3,
      insulation: 10000,
      hvacStatus: 1,
      ambientT: 23.5,
      modulesV: Array(10).fill(52.8),
      modulesT: Array(10).fill(24.8),
      cellsV: Array(160).fill(3300),
      cellsT: Array(160).fill(24.5)
    },
    sparklineHistory: Array(30).fill(528.0)
  };

  // Initialize deterministic realistic cell distributions
  for (let i = 0; i < 160; i++) {
    const cNo = i + 1;
    let offset = Math.round(Math.sin(cNo * 0.7) * 6 + Math.cos(cNo * 1.3) * 4);
    if (cNo === 14) offset = 14;
    if (cNo === 3) offset = -13;
    state.telemetry.cellsV[i] = 3300 + offset;

    const mIdx = Math.floor(i / 16);
    const modHeat = 0.8 * Math.sin((mIdx / 9.0) * Math.PI);
    let tOffset = modHeat + Math.sin(cNo * 0.5) * 0.4;
    if (cNo === 8) tOffset = 1.9;
    if (cNo === 1) tOffset = -0.4;
    state.telemetry.cellsT[i] = +(24.5 + tOffset).toFixed(1);
  }

  // ----------------------------------------------------
  // Graph Data Storage
  // ----------------------------------------------------
  const nodes = [];
  const edges = [];
  const microNodes = [];
  const microEdges = [];

  function buildGraphData() {
    nodes.length = 0;
    edges.length = 0;

    // --- Tier 0: Fleet Stations (Visible at Depth 0: Fleet Roll-Up) ---
    const fleetStations = [
      { id: 'station-bms', stationKey: 'bms', name: 'BMS 虚拟高压站 (Pylontech M2)', tier: 'fleet', icon: '⚡', x: 240, y: 420, type: 'fleet-station', capacityKwh: 100, powerKw: -12.9, soc: 68.5, childSummary: '+1柜 / 1簇 / 10模组 / 160电芯' },
      { id: 'station-edge0', stationKey: '0', name: '园区光储充微电网 (edge0)', tier: 'fleet', icon: '🏭', x: 560, y: 420, type: 'fleet-station', capacityKwh: 1000, powerKw: 145.0, soc: 74.0, childSummary: '+2柜 / 4簇 / 40模组 / 640电芯' },
      { id: 'station-edge1', stationKey: '1', name: '重工业削峰填谷站 (edge1)', tier: 'fleet', icon: '🏗️', x: 880, y: 420, type: 'fleet-station', capacityKwh: 2000, powerKw: 380.0, soc: 62.0, childSummary: '+4柜 / 8簇 / 80模组 / 1280电芯' },
      { id: 'station-edge2', stationKey: '2', name: '电网侧独立调频站 (edge2)', tier: 'fleet', icon: '🗼', x: 1200, y: 420, type: 'fleet-station', capacityKwh: 4000, powerKw: -520.0, soc: 51.5, childSummary: '+8柜 / 16簇 / 160模组 / 2560电芯' },
      { id: 'station-edge3', stationKey: '3', name: '商业综合体VPP站 (edge3)', tier: 'fleet', icon: '🏬', x: 1520, y: 420, type: 'fleet-station', capacityKwh: 400, powerKw: 65.0, soc: 81.0, childSummary: '+1柜 / 2簇 / 20模组 / 320电芯' },
      { id: 'station-edge4', stationKey: '4', name: '海岛离网微电网 (edge4)', tier: 'fleet', icon: '🏝️', x: 1820, y: 420, type: 'fleet-station', capacityKwh: 250, powerKw: 28.5, soc: 88.0, childSummary: '+1柜 / 1簇 / 10模组 / 160电芯' }
    ];
    nodes.push(...fleetStations);

    // --- Tier 1: Applications (5 Nodes) ---
    const apps = [
      { id: 'app-vpp', name: 'VPP 虚拟电厂多能聚合', tier: 'app', icon: '☁️', x: 260, type: 'app', status: 'normal', metrics: '参与电力现货 12.5MW' },
      { id: 'app-peakshaving', name: '需量控制与削峰填谷', tier: 'app', icon: '📉', x: 600, type: 'app', status: 'normal', metrics: '目标阈值 750kW' },
      { id: 'app-balancing', name: '自发自用与防逆流平衡', tier: 'app', icon: '⚖️', x: 950, type: 'app', status: 'normal', metrics: '并网点残差 < 50W' },
      { id: 'app-evcs', name: '智能充电桩群控协同', tier: 'app', icon: '🚗', x: 1300, type: 'app', status: 'normal', metrics: '有序充电 60kW' },
      { id: 'app-spot', name: '日前预测与微网经济性', tier: 'app', icon: '📈', x: 1640, type: 'app', status: 'normal', metrics: '日前电价 1.25元/kWh' }
    ];
    nodes.push(...apps);

    // --- Tier 2: Control Plane (5 Nodes) ---
    const ctrls = [
      { id: 'ctrl-mpc', name: 'MPC 模型预测控制引擎', tier: 'ctrl', icon: '🔮', x: 240, type: 'service', status: 'normal', metrics: '滚动时域优化 24h' },
      { id: 'ctrl-edge', name: 'OpenEMS Edge 软PLC内核', tier: 'ctrl', icon: '🧠', x: 620, type: 'service', status: 'normal', metrics: '周期 1000ms | 0死锁' },
      { id: 'ctrl-backend', name: 'OpenEMS Backend 路由网关', tier: 'ctrl', icon: '🌐', x: 1000, type: 'service', status: 'normal', metrics: 'WSS 8084 隧道穿透' },
      { id: 'ctrl-influx', name: 'InfluxDB v2 时序持久化', tier: 'ctrl', icon: '📊', x: 1360, type: 'service', status: 'normal', metrics: 'Flux 引擎 | 2s落库' },
      { id: 'ctrl-metadata', name: 'Odoo ERP 设备元数据', tier: 'ctrl', icon: '💼', x: 1700, type: 'service', status: 'normal', metrics: 'PostgreSQL HikariCP' }
    ];
    nodes.push(...ctrls);

    // --- Tier 3: Systems & Cabinets (6 Nodes) ---
    const systems = [
      { id: 'sys-grid', name: '10kV 园区进线并网关口', tier: 'sys', icon: '🗼', x: 200, type: 'system', status: 'normal', parentId: 'station-bms', metrics: '380V/50.01Hz | 95kW' },
      { id: 'sys-pv', name: '120kW 屋顶分布式光伏', tier: 'sys', icon: '☀️', x: 500, type: 'system', status: 'normal', parentId: 'station-bms', metrics: '日照 850W/m² | 78kW' },
      {
        id: 'sys-cabinet',
        name: '100kW/100kWh 储能一体柜',
        tier: 'sys',
        icon: '🏢',
        x: 880,
        type: 'cabinet-container',
        status: 'normal',
        parentId: 'station-bms',
        isExpandable: true,
        drillTargetDepth: 2,
        rollupTargetDepth: 0,
        metrics: '液冷恒温 23.5℃ | RTE 92.5%'
      },
      { id: 'sys-pcs', name: '100kW PCS 双向储能变流器', tier: 'sys', icon: '⚡', x: 1240, type: 'system', status: 'normal', parentId: 'station-bms', metrics: '效率 98.2% | cosφ 0.99' },
      { id: 'sys-load-hvac', name: '工业暖通冷水机房电表', tier: 'sys', icon: '❄️', x: 1540, type: 'system', status: 'normal', parentId: 'station-bms', metrics: '负荷 32.5 kW' },
      { id: 'sys-load-machinery', name: '车间主生产线动力电表', tier: 'sys', icon: '🏭', x: 1800, type: 'system', status: 'normal', parentId: 'station-bms', metrics: '负荷 48.0 kW' }
    ];
    nodes.push(...systems);

    // --- Tier 4: DC Arrays & Racks (4 Nodes, Children of sys-cabinet) ---
    const arrays = [
      { id: 'arr-hvbox', name: '高压继电器盒 (DC Breaker)', tier: 'array', icon: '🛡️', x: 380, type: 'array', status: 'normal', parentId: 'sys-cabinet', metrics: 'KM+/KM- 闭合 | 10MΩ' },
      { id: 'arr-dcbus', name: '512V 直流汇流母线', tier: 'array', icon: '🔌', x: 680, type: 'array', status: 'normal', parentId: 'sys-cabinet', metrics: '528V DC | -24.5A' },
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
        drillTargetDepth: 3,
        rollupTargetDepth: 1,
        metrics: 'SOC 68.5% | 100kWh'
      },
      { id: 'arr-bmu', name: 'BMU 电池管理主控制器', tier: 'array', icon: '🖥️', x: 1380, type: 'array', status: 'normal', parentId: 'sys-cabinet', metrics: '包络 Max: 120A/140A' }
    ];
    nodes.push(...arrays);

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
        metrics: `52.8V | 24.5℃`
      });
    }

    // --- Tier 6: Cells (160 Nodes, 16 per Module) ---
    for (let c = 1; c <= 160; c++) {
      const cid = `cell-${c < 10 ? '00' + c : (c < 100 ? '0' + c : c)}`;
      const mIdx = Math.floor((c - 1) / 16); // 0..9
      const mNo = mIdx + 1;
      const parentModId = `mod-${mNo < 10 ? '0' + mNo : mNo}`;
      const cInM = (c - 1) % 16;             // 0..15

      const baseX = 106 + mIdx * 182;
      const col = cInM % 4;
      const row = Math.floor(cInM / 4);
      const cx = baseX + col * 36;
      const cy = 980 + row * 38;

      const isMax = (c === 14);
      const isMin = (c === 3);
      const isMaxT = (c === 8);
      const isMinT = (c === 1);

      nodes.push({
        id: cid,
        name: `电芯 #${c < 10 ? '00' + c : (c < 100 ? '0' + c : c)}`,
        tier: 'cell',
        icon: '🔬',
        x: cx,
        y: cy,
        type: 'cell-leaf',
        status: isMax ? 'warning' : 'normal',
        parentId: parentModId,
        modIndex: mNo,
        cellIndex: c,
        isExpandable: true, // Can drill down to Level 5 (Cell RC Equivalent Circuit)
        isMaxV: isMax,
        isMinV: isMin,
        isMaxT: isMaxT,
        isMinT: isMinT,
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
      status: 'normal',
      metrics: '3路电荷转移中 (ΔV 27mV)'
    });

    // ----------------------------------------------------
    // Build Edges
    // ----------------------------------------------------
    // Fleet Level Edges (visible when Depth === 0)
    fleetStations.forEach(st => {
      addEdge('ctrl-backend', st.id, 'control', 'WSS 反向隧道汇聚');
      addEdge(st.id, 'ctrl-influx', 'comm', '5级拓扑遥测上报');
      addEdge('app-vpp', st.id, 'control', 'VPP 集群功率分配');
    });

    // Applications -> Control Plane
    addEdge('app-peakshaving', 'ctrl-edge', 'control', '有功设定点下发');
    addEdge('app-balancing', 'ctrl-edge', 'control', '微电网平衡闭环');
    addEdge('app-evcs', 'ctrl-edge', 'control', '充电桩动态功率限制');
    addEdge('app-spot', 'ctrl-mpc', 'control', '日前价格矩阵');
    addEdge('app-vpp', 'ctrl-backend', 'control', 'VPP聚合调度');

    // Control Plane Internal
    addEdge('ctrl-edge', 'ctrl-backend', 'control', 'WSS 8084 穿透长连接');
    addEdge('ctrl-edge', 'ctrl-influx', 'control', '时序遥测推送');
    addEdge('ctrl-backend', 'ctrl-metadata', 'control', '多租户鉴权');
    addEdge('ctrl-mpc', 'ctrl-edge', 'control', 'MPC最优化指令');

    // Control Plane -> Systems
    addEdge('ctrl-edge', 'sys-pcs', 'control', 'Modbus TCP 功率指令');
    addEdge('ctrl-edge', 'sys-cabinet', 'control', '机柜温控与消防联锁');
    addEdge('ctrl-edge', 'sys-grid', 'comm', '关口电表高频采样');
    addEdge('ctrl-edge', 'sys-pv', 'comm', '光伏发电计量');
    addEdge('ctrl-edge', 'sys-load-hvac', 'comm', '空调冷冻水能耗');
    addEdge('ctrl-edge', 'sys-load-machinery', 'comm', '生产车间能耗');

    // Systems Peer Power Flows
    addEdge('sys-grid', 'sys-pcs', 'power', '交流侧电能双向互济');
    addEdge('sys-pv', 'sys-pcs', 'power', '光伏余电耦合');
    addEdge('sys-pcs', 'sys-cabinet', 'power', '高低压交直流能量交换');

    // Systems -> DC Array (Visible when Depth >= 2)
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

    // Rack -> 10 Modules (Visible when Depth >= 3)
    for (let m = 1; m <= 10; m++) {
      const mid = `mod-${m < 10 ? '0' + m : m}`;
      addEdge('arr-rack', mid, 'physical', '簇内串联拓扑 (16S)');
      addEdge('arr-bmu', mid, 'comm', 'CSC 从控采样总线');
      if (m < 10) {
        const nextMid = `mod-${m + 1 < 10 ? '0' + (m + 1) : m + 1}`;
        addEdge(mid, nextMid, 'power', '模组高压铜排串联');
      }
    }

    // Module -> Cells (Visible when module is expanded or Depth === 4)
    for (let m = 1; m <= 10; m++) {
      const mid = `mod-${m < 10 ? '0' + m : m}`;
      const firstCell = (m - 1) * 16 + 1;
      const lastCell = m * 16;
      const c1 = `cell-${firstCell < 10 ? '00' + firstCell : (firstCell < 100 ? '0' + firstCell : firstCell)}`;
      const c2 = `cell-${lastCell < 10 ? '00' + lastCell : (lastCell < 100 ? '0' + lastCell : lastCell)}`;
      addEdge(mid, c1, 'physical', '模组正极首电芯');
      addEdge(mid, c2, 'physical', '模组负极末电芯');
    }

    addEdge('cell-balancing-bus', 'cell-014', 'power', '主动能量释放 (#14 Max)');
    addEdge('cell-balancing-bus', 'cell-003', 'power', '主动电荷补充 (#03 Min)');

    // Compute initial bottom-up roll-up aggregations
    computeRollUpAggregations();
  }

  function addEdge(source, target, type, label) {
    edges.push({ id: `${source}->${target}`, source, target, type, label });
  }

  // ----------------------------------------------------
  // Bottom-Up Roll-Up Mathematical Engine (自底向上聚合计算)
  // ----------------------------------------------------
  function computeRollUpAggregations() {
    // 1. Roll-up 16 Cells -> Each of the 10 Modules
    let rackSumV = 0;
    let rackMaxModV = -Infinity, rackMinModV = Infinity;
    let rackMaxModNo = 1, rackMinModNo = 1;
    let rackMaxCellV = -Infinity, rackMinCellV = Infinity;
    let rackMaxCellNo = 1, rackMinCellNo = 1;
    let rackMaxTemp = -Infinity, rackMinTemp = Infinity;
    let rackBalancingCells = 0;

    for (let m = 1; m <= 10; m++) {
      const mid = `mod-${m < 10 ? '0' + m : m}`;
      const modNode = nodes.find(n => n.id === mid);
      const startIdx = (m - 1) * 16;
      const endIdx = m * 16;

      let sumMv = 0;
      let maxV = -Infinity, minV = Infinity;
      let maxCNo = startIdx + 1, minCNo = startIdx + 1;
      let sumT = 0, maxT = -Infinity, minT = Infinity;
      let balCount = 0;
      const cellVs = [];

      for (let i = startIdx; i < endIdx; i++) {
        const cNo = i + 1;
        const v = state.telemetry.cellsV[i] || 3300;
        const t = state.telemetry.cellsT[i] || 24.5;
        cellVs.push(v);
        sumMv += v;
        sumT += t;

        if (v > maxV) { maxV = v; maxCNo = cNo; }
        if (v < minV) { minV = v; minCNo = cNo; }
        if (t > maxT) maxT = t;
        if (t < minT) minT = t;
        if (Math.abs(v - 3300) > 11) balCount++;

        // Update individual cell node metrics
        const cid = `cell-${cNo < 10 ? '00' + cNo : (cNo < 100 ? '0' + cNo : cNo)}`;
        const cNode = nodes.find(n => n.id === cid);
        if (cNode) {
          cNode.metrics = `${v}mV | ${t.toFixed(1)}℃`;
          cNode.status = (cNo === state.telemetry.maxCellNo || v > 3312) ? 'warning' : 'normal';
        }
      }

      const modV = +(sumMv / 1000.0).toFixed(2);
      const avgV = Math.round(sumMv / 16);
      const deltaV = maxV - minV;
      const avgT = +(sumT / 16.0).toFixed(1);
      const deltaT = +(maxT - minT).toFixed(1);
      const worstStatus = (deltaV >= 24 || m === 1) ? 'warning' : 'normal';

      state.telemetry.modulesV[m - 1] = modV;
      state.telemetry.modulesT[m - 1] = avgT;

      if (modNode) {
        modNode.status = worstStatus;
        modNode.metrics = `∑=${modV.toFixed(1)}V | ΔV=${deltaV}mV | ${avgT}℃`;
        modNode.rollup = {
          formula: '16S LiFePO4 串联上卷 (Cell Roll-Up)',
          childCount: 16,
          sumV: `${modV.toFixed(2)} V`,
          avgV: `${avgV} mV`,
          maxVal: `${maxV} mV (#${maxCNo})`,
          minVal: `${minV} mV (#${minCNo})`,
          spread: `ΔV = ${deltaV} mV | ΔT = ${deltaT} ℃`,
          avgTemp: `${avgT} ℃ (Max ${maxT.toFixed(1)}℃)`,
          balancing: `${balCount} 颗均衡中`,
          worstStatus: worstStatus === 'warning' ? '🟡 含极值均衡单体 (Propagated)' : '🟢 16颗电芯全部正常',
          cellVoltages: cellVs
        };
      }

      rackSumV += modV;
      if (modV > rackMaxModV) { rackMaxModV = modV; rackMaxModNo = m; }
      if (modV < rackMinModV) { rackMinModV = modV; rackMinModNo = m; }
      if (maxV > rackMaxCellV) { rackMaxCellV = maxV; rackMaxCellNo = maxCNo; }
      if (minV < rackMinCellV) { rackMinCellV = minV; rackMinCellNo = minCNo; }
      if (maxT > rackMaxTemp) rackMaxTemp = maxT;
      if (minT < rackMinTemp) rackMinTemp = minT;
      rackBalancingCells += balCount;
    }

    // 2. Roll-up 10 Modules -> Battery Rack (arr-rack)
    const rackNode = nodes.find(n => n.id === 'arr-rack');
    const rackDeltaV = rackMaxCellV - rackMinCellV;
    const modSpreadV = +(rackMaxModV - rackMinModV).toFixed(2);
    if (rackNode) {
      rackNode.metrics = `∑=${state.telemetry.voltage}V | SOC ${state.telemetry.soc.toFixed(1)}% | ΔV ${rackDeltaV}mV`;
      rackNode.rollup = {
        formula: '10 串联模组 / 160 电芯上卷 (Rack Roll-Up)',
        childCount: '10 模组 (160 电芯)',
        sumV: `${state.telemetry.voltage} V (∑10 Mods)`,
        avgV: `${(state.telemetry.voltage / 10).toFixed(2)} V/Mod`,
        maxVal: `Mod #0${rackMaxModNo} (${rackMaxModV}V) | Cell #${rackMaxCellNo} (${rackMaxCellV}mV)`,
        minVal: `Mod #0${rackMinModNo} (${rackMinModV}V) | Cell #${rackMinCellNo} (${rackMinCellV}mV)`,
        spread: `模组极差 ${modSpreadV}V | 单体极差 ${rackDeltaV}mV`,
        avgTemp: `${((rackMaxTemp + rackMinTemp) / 2).toFixed(1)} ℃ (ΔT ${(rackMaxTemp - rackMinTemp).toFixed(1)}℃)`,
        balancing: `全簇共 ${rackBalancingCells} 颗电芯主动均衡`,
        worstStatus: '🟢 簇包络正常 (Mod #01 均衡上卷提示)'
      };
    }

    // 3. Roll-up Array & Rack -> BESS Cabinet (sys-cabinet)
    const cabNode = nodes.find(n => n.id === 'sys-cabinet');
    if (cabNode) {
      cabNode.metrics = `${state.telemetry.powerKw}kW | SOC ${state.telemetry.soc.toFixed(1)}% | MaxΔV ${rackDeltaV}mV`;
      cabNode.rollup = {
        formula: '机柜全栈自底向上聚合 (Cabinet Full Roll-Up)',
        childCount: '4 阵列组件 / 10 模组 / 160 电芯',
        sumV: `AC 380V ⇄ DC ${state.telemetry.voltage}V`,
        avgV: `有功功率 ${state.telemetry.powerKw} kW (RTE 92.5%)`,
        maxVal: `最高单体 #${rackMaxCellNo}: ${rackMaxCellV} mV`,
        minVal: `最低单体 #${rackMinCellNo}: ${rackMinCellV} mV`,
        spread: `全柜最大压差 ΔV = ${rackDeltaV} mV`,
        avgTemp: `柜内环温 ${state.telemetry.ambientT}℃ | 最高电芯 ${rackMaxTemp.toFixed(1)}℃`,
        balancing: `绝缘阻抗 ${state.telemetry.insulation} kΩ | 消防常备`,
        worstStatus: '🟢 储能柜全链路正常'
      };
    }

    // 4. Roll-up Cabinet -> Fleet Station (station-bms)
    const stBms = nodes.find(n => n.id === 'station-bms');
    if (stBms) {
      stBms.powerKw = state.telemetry.powerKw;
      stBms.soc = state.telemetry.soc;
      stBms.metrics = `${state.telemetry.powerKw}kW | SOC ${state.telemetry.soc.toFixed(1)}% | ΔV ${rackDeltaV}mV`;
      stBms.rollup = {
        formula: '场站级全量资产上卷 (Station Fleet Roll-Up)',
        childCount: '6 系统设备 / 4 阵列 / 10 模组 / 160 电芯',
        sumV: `装机容量 100 kWh | 额定功率 100 kW`,
        avgV: `当前功率 ${state.telemetry.powerKw} kW | SOC ${state.telemetry.soc.toFixed(1)}%`,
        maxVal: `穿透最高电芯 #${rackMaxCellNo} (${rackMaxCellV}mV)`,
        minVal: `穿透最低电芯 #${rackMinCellNo} (${rackMinCellV}mV)`,
        spread: `全站极值压差 ${rackDeltaV} mV`,
        avgTemp: `环温 ${state.telemetry.ambientT}℃`,
        balancing: `${rackBalancingCells} 路均衡激活`,
        worstStatus: '🟢 场站在线受控 (WSS 8084 Connected)'
      };
    }
  }

  // ----------------------------------------------------
  // Build Level 5 Cell Micro-Twin (电芯内部二阶RC等效电路下钻拓扑)
  // ----------------------------------------------------
  function buildCellMicroTwin(cellNode) {
    microNodes.length = 0;
    microEdges.length = 0;
    if (!cellNode) return;

    const cIdx = cellNode.cellIndex || 14;
    const vMv = state.telemetry.cellsV[cIdx - 1] || 3314;
    const tempC = state.telemetry.cellsT[cIdx - 1] || 26.4;
    const ocvMv = vMv - Math.round(state.telemetry.current * 0.45);

    microNodes.push(
      { id: 'rc-ocv', name: `理想开路电压源 Vocv`, tier: 'cell', icon: '🔋', x: 350, y: 480, type: 'micro-rc', status: 'normal', metrics: `OCV = ${ocvMv} mV (SOC ${state.telemetry.soc.toFixed(1)}%)` },
      { id: 'rc-r0', name: `欧姆内阻 R0 (电解液/极耳)`, tier: 'cell', icon: '〰️', x: 650, y: 480, type: 'micro-rc', status: 'normal', metrics: `R0 = 0.48 mΩ | ΔU0 = ${(Math.abs(state.telemetry.current) * 0.48).toFixed(1)} mV` },
      { id: 'rc-r1c1', name: `一阶电化学极化网络 (R1||C1)`, tier: 'cell', icon: '⚡', x: 960, y: 380, type: 'micro-rc', status: 'normal', metrics: `R1 = 0.32 mΩ | C1 = 4200 F | τ1 = 1.3s` },
      { id: 'rc-r2c2', name: `二阶浓差极化网络 (R2||C2)`, tier: 'cell', icon: '🌊', x: 960, y: 580, type: 'micro-rc', status: 'normal', metrics: `R2 = 0.65 mΩ | C2 = 28000 F | τ2 = 18.2s` },
      { id: 'rc-term', name: `电芯极柱端电压输出 Vterm`, tier: 'cell', icon: '🔌', x: 1300, y: 480, type: 'micro-rc', status: cellNode.isMaxV ? 'warning' : 'normal', metrics: `Vterm = ${vMv} mV | I = ${state.telemetry.current.toFixed(1)} A` },
      { id: 'rc-mosfet', name: `主动均衡 MOSFET 旁路支路`, tier: 'cell', icon: '🔀', x: 1300, y: 260, type: 'micro-rc', status: cellNode.isMaxV ? 'warning' : 'normal', metrics: cellNode.isMaxV ? '导通均衡中 (Ibal = 150mA)' : '关断待机 (Ibal = 0mA)' },
      { id: 'rc-thermal', name: `电芯焦耳热耦合核心 (Q=I²R)`, tier: 'cell', icon: '🌡️', x: 800, y: 730, type: 'micro-rc', status: 'normal', metrics: `Tcore = ${tempC} ℃ | 液冷导热系数 4.5W/K` }
    );

    microEdges.push(
      { source: 'rc-ocv', target: 'rc-r0', type: 'power', label: '电化学势能输出' },
      { source: 'rc-r0', target: 'rc-r1c1', type: 'power', label: '电荷转移极化' },
      { source: 'rc-r0', target: 'rc-r2c2', type: 'power', label: '锂离子固相扩散' },
      { source: 'rc-r1c1', target: 'rc-term', type: 'power', label: '极化电压叠加' },
      { source: 'rc-r2c2', target: 'rc-term', type: 'power', label: '浓差电压叠加' },
      { source: 'rc-term', target: 'rc-mosfet', type: 'control', label: 'CSC 差分采样与均衡回路' },
      { source: 'rc-r0', target: 'rc-thermal', type: 'comm', label: '欧姆焦耳热生成' },
      { source: 'rc-r1c1', target: 'rc-thermal', type: 'comm', label: '极化内阻产热' }
    );
  }

  // ----------------------------------------------------
  // Visibility & Roll-Up Filtering Rules
  // ----------------------------------------------------
  function isNodeVisible(node) {
    // Search filter override
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      return node.name.toLowerCase().includes(q) || node.id.toLowerCase().includes(q);
    }

    // Level 5: Cell Micro-Twin Mode
    if (state.rollupDepth === 5) {
      return false; // Main graph nodes hidden; microNodes are rendered instead
    }

    // Level 0: Fleet Roll-Up Mode
    if (state.rollupDepth === 0) {
      return node.tier === 'fleet' || ['app-vpp', 'app-spot', 'ctrl-backend', 'ctrl-influx', 'ctrl-metadata'].includes(node.id);
    }

    // Hide fleet station macro nodes when Depth >= 1
    if (node.tier === 'fleet') return false;

    // Mode filter
    if (state.mode === 'bess' && ['app', 'ctrl'].includes(node.tier)) return false;
    if (state.mode === 'controlcomm' && ['mod', 'cell'].includes(node.tier)) return false;

    // Depth-based Roll-Up visibility:
    // Depth 1 (Cabinet Roll-Up): Hide array, mod, cell
    if (state.rollupDepth === 1 && ['array', 'mod', 'cell'].includes(node.tier)) return false;

    // Depth 2 (Rack Roll-Up): Hide mod, cell
    if (state.rollupDepth === 2 && ['mod', 'cell'].includes(node.tier)) return false;

    // Depth 3 (Module Roll-Up): Show modules, but ONLY show cells belonging to expandedModules!
    if (state.rollupDepth === 3 && node.tier === 'cell') {
      if (node.id === 'cell-balancing-bus') return state.expandedModules.size > 0;
      return state.expandedModules.has(node.parentId);
    }

    // Active tier filter on left rail
    if (state.activeTier && node.tier !== state.activeTier) {
      return isConnectedToActiveTier(node);
    }

    return true;
  }

  function isConnectedToActiveTier(node) {
    return edges.some(e => {
      const s = nodes.find(n => n.id === e.source);
      const t = nodes.find(n => n.id === e.target);
      return (s && s.tier === state.activeTier && (e.target === node.id || e.source === node.id)) ||
             (t && t.tier === state.activeTier && (e.target === node.id || e.source === node.id));
    });
  }

  // ----------------------------------------------------
  // Drill-Down & Roll-Up State Transitions
  // ----------------------------------------------------
  function setRollupDepth(depth, focusNode = null) {
    state.rollupDepth = Math.max(0, Math.min(5, depth));

    if (state.rollupDepth === 4) {
      // Expand all 10 modules
      for (let m = 1; m <= 10; m++) {
        state.expandedModules.add(`mod-${m < 10 ? '0' + m : m}`);
      }
    } else if (state.rollupDepth === 3 && state.expandedModules.size === 10) {
      // Keep only Mod #01 expanded when switching back to L3 from L4
      state.expandedModules.clear();
      state.expandedModules.add('mod-01');
    }

    // Smooth camera focus based on depth
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
      buildCellMicroTwin(focusNode || state.selectedNode || nodes.find(n => n.id === 'cell-014'));
      animateCameraTo(140, 40, 0.92);
    }

    updateDepthUI();
    updateBreadcrumb();
    updateLeftRail();
    if (state.selectedNode) {
      populateDrawer(state.selectedNode);
    }
  }

  function drillDownNode(node) {
    if (!node) return;

    if (node.tier === 'fleet') {
      state.station = node.stationKey || 'bms';
      document.getElementById('station-select').value = state.station;
      const cab = nodes.find(n => n.id === 'sys-cabinet');
      setRollupDepth(1, cab);
      selectNode(cab);
      return;
    }

    if (node.id === 'sys-cabinet') {
      const rack = nodes.find(n => n.id === 'arr-rack');
      setRollupDepth(2, rack);
      selectNode(rack);
      return;
    }

    if (node.id === 'arr-rack') {
      setRollupDepth(3, node);
      selectNode(nodes.find(n => n.id === 'mod-01'));
      return;
    }

    if (node.tier === 'mod') {
      if (state.rollupDepth < 3) state.rollupDepth = 3;
      if (state.expandedModules.has(node.id)) {
        // Already expanded -> Roll up this module's cells!
        state.expandedModules.delete(node.id);
        if (state.rollupDepth === 4) state.rollupDepth = 3;
      } else {
        // Drill down into this module's 16 cells!
        state.expandedModules.add(node.id);
        // Pan camera slightly toward this module's expanded cell matrix
        const canvasW = canvas.parentElement.clientWidth;
        const canvasH = canvas.parentElement.clientHeight;
        animateCameraTo(canvasW / 2 - node.x * 0.95, canvasH / 2 - 960 * 0.95, 0.95);
      }
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
      const cellNode = nodes.find(n => n.id === state.focusedMicroCellId) || nodes.find(n => n.id === 'cell-014');
      const parentMod = cellNode ? nodes.find(n => n.id === cellNode.parentId) : nodes.find(n => n.id === 'mod-01');
      setRollupDepth(3, parentMod);
      if (parentMod) selectNode(parentMod);
      return;
    }

    if (state.rollupDepth === 4) {
      state.expandedModules.clear();
      setRollupDepth(3, nodes.find(n => n.id === 'arr-rack'));
      return;
    }

    if (state.rollupDepth === 3) {
      if (state.selectedNode && state.selectedNode.tier === 'cell') {
        const pMod = nodes.find(n => n.id === state.selectedNode.parentId);
        if (pMod) {
          state.expandedModules.delete(pMod.id);
          selectNode(pMod);
          updateBreadcrumb();
          return;
        }
      }
      if (state.expandedModules.size > 0) {
        state.expandedModules.clear();
        updateDepthUI();
        updateBreadcrumb();
        updateLeftRail();
        if (state.selectedNode) populateDrawer(state.selectedNode);
        return;
      }
      const rack = nodes.find(n => n.id === 'arr-rack');
      setRollupDepth(2, rack);
      if (rack) selectNode(rack);
      return;
    }

    if (state.rollupDepth === 2) {
      const cab = nodes.find(n => n.id === 'sys-cabinet');
      setRollupDepth(1, cab);
      if (cab) selectNode(cab);
      return;
    }

    if (state.rollupDepth === 1) {
      const st = nodes.find(n => n.id === 'station-bms');
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
      const c14 = nodes.find(n => n.id === 'cell-014');
      state.focusedMicroCellId = 'cell-014';
      setRollupDepth(5, c14);
      selectNode(c14);
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
    const trail = document.getElementById('breadcrumb-trail');
    if (!trail) return;
    trail.innerHTML = `<span class="breadcrumb-label">🧭 拓扑路径:</span>`;

    const crumbs = [];

    // Crumb 0: Fleet
    crumbs.push({
      label: '🌍 集团多站集群 (Fleet)',
      active: state.rollupDepth === 0,
      onClick: () => {
        const st = nodes.find(n => n.id === 'station-bms');
        setRollupDepth(0, st);
        selectNode(st);
      }
    });

    if (state.rollupDepth >= 1) {
      crumbs.push({
        label: '🏢 储能一体柜 (Cabinet 100kWh)',
        active: state.rollupDepth === 1,
        onClick: () => {
          const cab = nodes.find(n => n.id === 'sys-cabinet');
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
          const rack = nodes.find(n => n.id === 'arr-rack');
          setRollupDepth(2, rack);
          selectNode(rack);
        }
      });
    }

    if (state.rollupDepth >= 3) {
      const expCount = state.expandedModules.size;
      const modText = expCount === 10
        ? '🧱 10模组全展开 (160S)'
        : (expCount > 0 ? `🧱 10串联模组 (已下钻 ${expCount} 组)` : '🧱 10串联模组 (全部上卷)');
      crumbs.push({
        label: modText,
        active: state.rollupDepth === 3 || state.rollupDepth === 4,
        onClick: () => {
          const m1 = nodes.find(n => n.id === 'mod-01');
          setRollupDepth(3, m1);
          selectNode(m1);
        }
      });
    }

    if (state.rollupDepth === 5) {
      const cNode = nodes.find(n => n.id === state.focusedMicroCellId) || nodes.find(n => n.id === 'cell-014');
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
    document.querySelectorAll('.depth-pill').forEach(btn => {
      const d = parseInt(btn.dataset.depth, 10);
      btn.classList.toggle('active', d === state.rollupDepth);
    });

    const statusEl = document.getElementById('kpi-depth-status');
    if (statusEl) {
      statusEl.innerHTML = `<span class="status-dot"></span>${DEPTH_DESCRIPTIONS[state.rollupDepth] || 'L3'}`;
    }

    const visCount = state.rollupDepth === 5 ? microNodes.length : nodes.filter(isNodeVisible).length;
    const countEl = document.getElementById('kpi-node-count');
    if (countEl) {
      countEl.textContent = `${visCount} / ${nodes.length} Nodes`;
    }
  }

  // ----------------------------------------------------
  // Canvas Initialization & Mouse Interaction
  // ----------------------------------------------------
  let canvas, ctx;

  function initCanvas() {
    canvas = document.getElementById('topology-canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const wrapper = document.getElementById('canvas-wrapper');
    wrapper.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    wrapper.addEventListener('dblclick', onDoubleClick);
    wrapper.addEventListener('wheel', onWheel, { passive: false });

    requestAnimationFrame(renderLoop);
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = canvas.parentElement.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.parentElement.clientHeight * window.devicePixelRatio;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    // Cancel camera auto-animation on manual interaction
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
        updateTooltip(hovered, e.clientX, e.clientY);
      } else if (hovered) {
        updateTooltip(hovered, e.clientX, e.clientY);
      }
    }
  }

  function onMouseUp() {
    state.isDragging = false;
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
      if (isNodeVisible(n)) {
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
    const tierObj = TIERS.find(t => t.id === node.tier);
    return tierObj ? tierObj.y : 100;
  }

  // ----------------------------------------------------
  // Main 60FPS Render Loop
  // ----------------------------------------------------
  function renderLoop() {
    state.animTime += 0.025;

    // Smooth camera interpolation
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
      if (state.rollupDepth === 1 && ['array', 'mod', 'cell'].includes(tier.id)) return;
      if (state.rollupDepth === 2 && ['mod', 'cell'].includes(tier.id)) return;
      if (state.rollupDepth === 3 && tier.id === 'cell' && state.expandedModules.size === 0) return;

      const y = tier.id === 'fleet' ? 420 : tier.y;
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

  // Draw glowing sub-topology container frames around expanded modules' 16 cells
  function drawExpandedModuleBoxes() {
    if (state.rollupDepth < 3 || state.rollupDepth === 5) return;

    state.expandedModules.forEach(modId => {
      const modNode = nodes.find(n => n.id === modId);
      if (!modNode || !isNodeVisible(modNode)) return;
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

      // Header label inside sub-topology box
      ctx.fillStyle = '#22d3ee';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`🔽 Mod #0${modNode.modIndex} 子拓扑 (16S)`, boxX + boxW / 2, boxY + 13);
      ctx.restore();
    });
  }

  function drawEdges() {
    edges.forEach(edge => {
      const src = nodes.find(n => n.id === edge.source);
      const tgt = nodes.find(n => n.id === edge.target);
      if (!src || !tgt) return;
      if (!isNodeVisible(src) || !isNodeVisible(tgt)) return;

      const sx = src.x;
      const sy = getNodeY(src);
      const tx = tgt.x;
      const ty = getNodeY(tgt);

      const isHovered = (state.hoveredNode && (state.hoveredNode.id === src.id || state.hoveredNode.id === tgt.id));
      const isSelected = (state.selectedNode && (state.selectedNode.id === src.id || state.selectedNode.id === tgt.id));

      ctx.save();
      ctx.beginPath();

      const cp1y = sy + (ty - sy) * 0.5;
      const cp2y = sy + (ty - sy) * 0.5;
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx, cp1y, tx, cp2y, tx, ty);

      if (edge.type === 'power') {
        ctx.strokeStyle = isHovered || isSelected ? '#fbbf24' : 'rgba(245, 158, 11, 0.48)';
        ctx.lineWidth = isHovered || isSelected ? 3.5 : 2.0;
        ctx.stroke();

        const t = (state.animTime * 1.4) % 1.0;
        const pt = getBezierPoint(sx, sy, sx, cp1y, tx, cp2y, tx, ty, t);
        ctx.fillStyle = state.telemetry.current < 0 ? '#fbbf24' : '#38bdf8';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (edge.type === 'control') {
        ctx.strokeStyle = isHovered || isSelected ? '#c084fc' : 'rgba(168, 85, 247, 0.36)';
        ctx.lineWidth = isHovered || isSelected ? 2.5 : 1.4;
        ctx.setLineDash([4, 6]);
        ctx.lineDashOffset = -state.animTime * 20;
        ctx.stroke();
      } else if (edge.type === 'comm') {
        ctx.strokeStyle = isHovered || isSelected ? '#38bdf8' : 'rgba(56, 189, 248, 0.32)';
        ctx.lineWidth = isHovered || isSelected ? 2.4 : 1.2;
        ctx.setLineDash([3, 5]);
        ctx.lineDashOffset = -state.animTime * 15;
        ctx.stroke();
      } else {
        ctx.strokeStyle = isHovered || isSelected ? '#cbd5e1' : 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = isHovered || isSelected ? 2.0 : 1.1;
        ctx.stroke();
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
    nodes.forEach(node => {
      if (!isNodeVisible(node)) return;
      const ny = getNodeY(node);
      const isSelected = (state.selectedNode && state.selectedNode.id === node.id);
      const isHovered = (state.hoveredNode && state.hoveredNode.id === node.id);

      ctx.save();
      if (node.tier === 'cell' && node.type === 'cell-leaf') {
        drawCellNode(node, node.x, ny, isSelected, isHovered);
      } else {
        drawMacroNode(node, node.x, ny, isSelected, isHovered);
      }
      ctx.restore();
    });
  }

  function drawMacroNode(node, x, y, isSelected, isHovered) {
    const tierObj = TIERS.find(t => t.id === node.tier);
    const tierColor = tierObj ? tierObj.color : '#3b82f6';
    const radius = node.tier === 'fleet' ? 36 : 28;

    // Check if this node is currently acting as a Rolled-Up Container
    let isRolledUpContainer = false;
    let badgeText = '';
    if (node.tier === 'fleet' && state.rollupDepth === 0) {
      isRolledUpContainer = true;
      badgeText = '+191 下钻 🔽';
    } else if (node.id === 'sys-cabinet') {
      isRolledUpContainer = (state.rollupDepth === 1);
      badgeText = isRolledUpContainer ? '+174 下钻 🔽' : '[-] 上卷 🔼';
    } else if (node.id === 'arr-rack') {
      isRolledUpContainer = (state.rollupDepth === 2);
      badgeText = isRolledUpContainer ? '+10模组/160芯 🔽' : '[-] 上卷 🔼';
    } else if (node.tier === 'mod') {
      isRolledUpContainer = !state.expandedModules.has(node.id);
      badgeText = isRolledUpContainer ? '+16电芯 🔽' : '[-16] 收起 🔼';
    }

    // Outer Dashed Roll-Up Halo Ring for Rolled-Up Containers
    if (isRolledUpContainer) {
      ctx.save();
      ctx.strokeStyle = tierColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -state.animTime * 8;
      ctx.beginPath();
      ctx.arc(x, y, radius + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Selection / Hover Glow
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

    // Node Circle Body
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

    // Icon
    ctx.font = `${node.tier === 'fleet' ? 22 : 18}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.icon, x, y);

    // Status Dot (Top Right, reflects worst-of-children roll-up status)
    ctx.fillStyle = node.status === 'warning' ? '#f59e0b' : '#10b981';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(x + radius * 0.7, y - radius * 0.7, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Expand / Roll-Up Badge Pill (Top Left / Bottom Right)
    if (badgeText) {
      ctx.font = 'bold 9px -apple-system, sans-serif';
      const bw = ctx.measureText(badgeText).width + 10;
      const bx = x - bw / 2;
      const by = y - radius - 22;

      ctx.fillStyle = isRolledUpContainer ? 'rgba(16, 185, 129, 0.9)' : 'rgba(245, 158, 11, 0.9)';
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
        ctx.fillStyle = cv > 3310 ? '#f59e0b' : (cv < 3290 ? '#3b82f6' : '#10b981');
        ctx.fillRect(startX + idx * segW, barY, segW - 1, barH);
      });
    }

    // Label Under Node
    const labelOffsetY = (node.tier === 'mod') ? radius + 19 : radius + 14;
    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText(node.name, x, y + labelOffsetY);

    // Rolled-up Metric Pill Under Label
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
    if (node.isMinV) cellColor = '#3b82f6';
    if (node.isMaxT) cellColor = '#ef4444';
    if (node.isMinT) cellColor = '#06b6d4';

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
    const cNode = nodes.find(n => n.id === state.focusedMicroCellId) || nodes.find(n => n.id === 'cell-014');

    // Outer schematic container frame
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
    ctx.fillText(`状态方程: V_term(t) = V_ocv(SOC) - I(t)·R0 - U_1(t) - U_2(t)   |   热平衡方程: C_th·(dT/dt) = I²·(R0 + R1 + R2) - h·A·(T - T_coolant)`, 250, 234);
    ctx.restore();

    // Draw Micro Edges
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

      const prog = (state.animTime * 1.2) % 1.0;
      const px = s.x + (t.x - s.x) * prog;
      const py = s.y + (t.y - s.y) * prog;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // Edge label
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(e.label, (s.x + t.x) / 2, (s.y + t.y) / 2 - 8);
      ctx.restore();
    });

    // Draw Micro Nodes
    microNodes.forEach(mn => {
      const isHovered = state.hoveredNode && state.hoveredNode.id === mn.id;
      drawMacroNode(mn, mn.x, mn.y, false, isHovered);
    });
  }

  // ----------------------------------------------------
  // Selection & Inspector Drawer Population
  // ----------------------------------------------------
  function selectNode(node) {
    if (!node) return;
    state.selectedNode = node;
    const drawer = document.getElementById('inspector-drawer');
    drawer.classList.remove('collapsed');
    populateDrawer(node);
  }

  function populateDrawer(node) {
    const tierObj = TIERS.find(t => t.id === node.tier);
    const badge = document.getElementById('drawer-badge');
    badge.textContent = tierObj ? `${tierObj.name} (${tierObj.cnName})` : node.tier;
    badge.style.background = tierObj ? `${tierObj.color}25` : '#3b82f625';
    badge.style.color = tierObj ? tierObj.color : '#3b82f6';
    badge.style.border = `1px solid ${tierObj ? tierObj.color : '#3b82f6'}`;

    document.getElementById('drawer-title').textContent = node.name;
    document.getElementById('drawer-subtitle').textContent = `ID: ${node.id} | Parent: ${node.parentId || 'ROOT'}`;

    // Configure Drawer Drill-Down & Roll-Up Action Buttons
    const btnDrill = document.getElementById('btn-drawer-drilldown');
    const lblDrill = document.getElementById('lbl-drawer-drilldown');
    const btnRoll = document.getElementById('btn-drawer-rollup');
    const lblRoll = document.getElementById('lbl-drawer-rollup');

    if (node.isExpandable) {
      btnDrill.disabled = false;
      if (node.tier === 'mod') {
        const isExp = state.expandedModules.has(node.id);
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
          const pNode = nodes.find(n => n.id === node.parentId);
          if (pNode) {
            if (node.tier === 'cell' && state.rollupDepth === 5) {
              setRollupDepth(3, pNode);
            } else if (node.tier === 'cell') {
              state.expandedModules.delete(pNode.id);
            } else if (node.tier === 'mod') {
              setRollupDepth(2, pNode);
            } else if (node.tier === 'array') {
              setRollupDepth(1, pNode);
            } else if (node.tier === 'sys') {
              setRollupDepth(0, pNode);
            }
            selectNode(pNode);
            updateBreadcrumb();
            updateDepthUI();
            return;
          }
        }
        rollUpOneLevel();
      };
    } else {
      btnRoll.disabled = true;
      lblRoll.textContent = '已达顶层集群';
    }

    // Populate Bottom-Up Roll-Up Mathematical Summary Section
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

    // Populate Real-Time KPI Cards
    const metricsContainer = document.getElementById('drawer-metrics');
    metricsContainer.innerHTML = '';

    if (node.tier === 'cell' && node.cellIndex) {
      const v = state.telemetry.cellsV[node.cellIndex - 1] || 3300;
      const t = state.telemetry.cellsT[node.cellIndex - 1] || 24.5;
      addMetricCard(metricsContainer, '单体电压 (Cell V)', v, 'mV');
      addMetricCard(metricsContainer, '单体温度 (Cell T)', t.toFixed(1), '°C');
      addMetricCard(metricsContainer, '所属模组 (Parent)', `Mod #0${node.modIndex}`, '');
      addMetricCard(metricsContainer, '主动均衡状态', node.isMaxV ? 'ACTIVE ⚡' : 'IDLE', '');
    } else if (node.tier === 'mod') {
      const mv = state.telemetry.modulesV[node.modIndex - 1] || 52.8;
      const mt = state.telemetry.modulesT[node.modIndex - 1] || 24.8;
      addMetricCard(metricsContainer, '模组上卷总压 (∑V)', mv.toFixed(2), 'V');
      addMetricCard(metricsContainer, '模组平均温度 (μT)', mt.toFixed(1), '°C');
      addMetricCard(metricsContainer, '下辖电芯状态', state.expandedModules.has(node.id) ? '已展开 (16S)' : '已上卷聚合 (16S)', '');
      addMetricCard(metricsContainer, 'CSC 从控通信', 'CRC OK 🟢', '');
    } else {
      addMetricCard(metricsContainer, '簇端电压 (Pack V)', state.telemetry.voltage, 'V');
      addMetricCard(metricsContainer, '充放电电流 (Current)', state.telemetry.current.toFixed(1), 'A');
      addMetricCard(metricsContainer, '荷电状态 (SOC)', state.telemetry.soc.toFixed(1), '%');
      addMetricCard(metricsContainer, '全簇最大压差 (ΔV)', state.telemetry.deltaV, 'mV');
    }

    // Populate Child Entities List for Direct Drill-Down
    populateChildEntitiesList(node);

    // Populate Inbound/Outbound Dependencies
    populateDependencies(node);

    // Draw Rolling Sparkline
    drawSparkline();
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

    const children = nodes.filter(n => n.parentId === node.id);
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
        <span class="dep-drill-tag">${ch.metrics || '下钻 🔽'}</span>
      `;
      item.onclick = () => {
        if (node.tier === 'mod') {
          state.expandedModules.add(node.id);
          if (state.rollupDepth < 3) state.rollupDepth = 3;
        } else if (node.id === 'arr-rack' && state.rollupDepth < 3) {
          setRollupDepth(3, ch);
        } else if (node.id === 'sys-cabinet' && state.rollupDepth < 2) {
          setRollupDepth(2, ch);
        } else if (node.tier === 'fleet' && state.rollupDepth === 0) {
          setRollupDepth(1, ch);
        }
        updateDepthUI();
        updateBreadcrumb();
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

    // Parent container link at top of Inbound
    if (node.parentId) {
      const pNode = nodes.find(n => n.id === node.parentId);
      if (pNode) {
        const pItem = document.createElement('div');
        pItem.className = 'dep-node-item';
        pItem.style.borderColor = '#f59e0b';
        pItem.innerHTML = `<span>🔼 <b>父容器: ${pNode.icon} ${pNode.name}</b></span><span style="font-size:10px;color:#fbbf24;">点击上卷 (Roll Up)</span>`;
        pItem.onclick = () => {
          document.getElementById('btn-drawer-rollup').click();
        };
        inContainer.appendChild(pItem);
      }
    }

    const inEdges = edges.filter(e => e.target === node.id);
    const outEdges = edges.filter(e => e.source === node.id);

    inEdges.forEach(e => {
      const srcNode = nodes.find(n => n.id === e.source);
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
        const tgtNode = nodes.find(n => n.id === e.target);
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

  function drawSparkline() {
    const cvs = document.getElementById('sparkline-canvas');
    if (!cvs) return;
    const sctx = cvs.getContext('2d');
    const w = cvs.clientWidth || 340;
    const h = cvs.clientHeight || 64;
    cvs.width = w * window.devicePixelRatio;
    cvs.height = h * window.devicePixelRatio;
    sctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

    sctx.clearRect(0, 0, w, h);

    const data = state.sparklineHistory;
    const min = Math.min(...data) - 4;
    const max = Math.max(...data) + 4;

    sctx.strokeStyle = '#38bdf8';
    sctx.lineWidth = 2;
    sctx.beginPath();
    data.forEach((val, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((val - min) / (max - min)) * (h - 12) - 6;
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
    if (!node) {
      tip.style.display = 'none';
      return;
    }
    tip.style.display = 'block';
    tip.style.left = `${mouseX}px`;
    tip.style.top = `${mouseY}px`;

    const tierObj = TIERS.find(t => t.id === node.tier);
    let rollupInfo = '';
    if (node.rollup) {
      rollupInfo = `
        <div class="tooltip-row"><span>📦 已聚合子实体:</span><span class="tooltip-val" style="color:#fbbf24;">${node.rollup.childCount}</span></div>
        <div class="tooltip-row"><span>∑ 上卷累加值:</span><span class="tooltip-val" style="color:#34d399;">${node.rollup.sumV}</span></div>
        <div class="tooltip-row"><span>Δ 内部极差:</span><span class="tooltip-val" style="color:#f43f5e;">${node.rollup.spread}</span></div>
      `;
    }

    const actionHint = node.isExpandable
      ? (node.tier === 'mod' && state.expandedModules.has(node.id) ? '💡 双击节点：收起16颗电芯上卷至模组' : '💡 双击节点：向下钻取展开子拓扑 (Drill-Down)')
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
  // Live Telemetry Polling (Edge REST API)
  // ----------------------------------------------------
  async function pollLiveTelemetry() {
    try {
      const [resSoc, resV, resI, resMaxC, resMinC] = await Promise.all([
        fetch('/openems-rest/channel/battery0/Soc'),
        fetch('/openems-rest/channel/battery0/Voltage'),
        fetch('/openems-rest/channel/battery0/Current'),
        fetch('/openems-rest/channel/battery0/MaxCellVoltage'),
        fetch('/openems-rest/channel/battery0/MinCellVoltage')
      ]);

      if (resSoc.ok) {
        const j = await resSoc.json();
        if (j.value !== undefined) state.telemetry.soc = j.value;
      }
      if (resV.ok) {
        const j = await resV.json();
        if (j.value !== undefined) {
          state.telemetry.voltage = j.value;
          state.sparklineHistory.push(j.value);
          if (state.sparklineHistory.length > 30) state.sparklineHistory.shift();
        }
      }
      if (resI.ok) {
        const j = await resI.json();
        if (j.value !== undefined) {
          state.telemetry.current = j.value;
          state.telemetry.powerKw = +(state.telemetry.voltage * state.telemetry.current / 1000.0).toFixed(1);
        }
      }
      if (resMaxC.ok) {
        const j = await resMaxC.json();
        if (j.value !== undefined) state.telemetry.maxCellV = j.value;
      }
      if (resMinC.ok) {
        const j = await resMinC.json();
        if (j.value !== undefined) state.telemetry.minCellV = j.value;
      }

      state.telemetry.deltaV = state.telemetry.maxCellV - state.telemetry.minCellV;

      // Update cell voltages around current mean pack voltage
      const meanCellMv = Math.round((state.telemetry.voltage * 1000) / 160.0);
      for (let i = 0; i < 160; i++) {
        const cNo = i + 1;
        if (cNo === 14) state.telemetry.cellsV[i] = state.telemetry.maxCellV;
        else if (cNo === 3) state.telemetry.cellsV[i] = state.telemetry.minCellV;
        else {
          const baseOffset = Math.round(Math.sin(cNo * 0.7) * 5 + Math.cos(cNo * 1.3) * 3);
          state.telemetry.cellsV[i] = meanCellMv + baseOffset;
        }
      }

      computeRollUpAggregations();
      updateTopBanner();

      if (state.selectedNode) {
        populateDrawer(state.selectedNode);
      }
    } catch (e) {
      // Fallback gracefully
    }
  }

  function updateTopBanner() {
    const kpiEl = document.getElementById('kpi-power');
    if (kpiEl) {
      const p = state.telemetry.powerKw;
      kpiEl.textContent = `${p > 0 ? '+' : ''}${p} kW (${state.telemetry.current < 0 ? '填谷充电' : '削峰放电'})`;
      kpiEl.style.color = state.telemetry.current < 0 ? '#fbbf24' : '#38bdf8';
    }
    const socEl = document.getElementById('kpi-soc');
    if (socEl) socEl.textContent = `${state.telemetry.voltage}V | ${state.telemetry.soc.toFixed(1)}%`;
    const deltaEl = document.getElementById('kpi-delta-v');
    if (deltaEl) deltaEl.textContent = `${state.telemetry.deltaV} mV (#14/#03)`;
  }

  // ----------------------------------------------------
  // Left Vertical Smartscape Rail & UI Controls
  // ----------------------------------------------------
  function updateLeftRail() {
    const rail = document.getElementById('smartscape-rail');
    if (!rail) return;
    rail.innerHTML = '';

    TIERS.forEach(tier => {
      if (tier.id === 'fleet' && state.rollupDepth > 0) return;
      const tierNodes = nodes.filter(n => n.tier === tier.id);
      const visTierNodes = tierNodes.filter(isNodeVisible);
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
          // Clicking a rolled-up tier on the left rail automatically drills down to reveal that tier!
          const reqDepth = tier.id === 'array' ? 2 : (tier.id === 'mod' ? 3 : 4);
          setRollupDepth(reqDepth);
          return;
        }
        if (state.activeTier === tier.id) {
          state.activeTier = null;
        } else {
          state.activeTier = tier.id;
          const canvasH = canvas.parentElement.clientHeight;
          animateCameraTo(state.panX, canvasH / 2 - tier.y * state.scale, state.scale);
        }
        updateLeftRail();
      };
      rail.appendChild(btn);
    });
  }

  function initUI() {
    // Mode Switcher Tabs
    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.mode = tab.dataset.mode;
        updateLeftRail();
        updateDepthUI();
      });
    });

    // Granularity Depth Pills (L0..L4)
    document.querySelectorAll('.depth-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = parseInt(btn.dataset.depth, 10);
        setRollupDepth(d);
      });
    });

    // Top Drill-Down & Roll-Up Step Buttons
    document.getElementById('btn-top-drilldown').onclick = () => drillDownOneLevel();
    document.getElementById('btn-top-rollup').onclick = () => rollUpOneLevel();

    // Bottom Toolbar Expand/Collapse All Modules
    document.getElementById('btn-expand-all-mods').onclick = () => setRollupDepth(4);
    document.getElementById('btn-collapse-all-mods').onclick = () => {
      state.expandedModules.clear();
      setRollupDepth(3);
    };

    // Drawer Close
    document.getElementById('drawer-close').onclick = () => {
      document.getElementById('inspector-drawer').classList.add('collapsed');
      state.selectedNode = null;
    };

    // Zoom & Fit
    document.getElementById('btn-zoom-in').onclick = () => { state.scale = Math.min(2.5, state.scale * 1.2); };
    document.getElementById('btn-zoom-out').onclick = () => { state.scale = Math.max(0.3, state.scale / 1.2); };
    document.getElementById('btn-fit').onclick = () => {
      state.activeTier = null;
      setRollupDepth(3);
    };

    // Search Box
    document.getElementById('search-box').addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim();
      updateDepthUI();
      updateLeftRail();
    });

    // Station Selector
    document.getElementById('station-select').addEventListener('change', (e) => {
      state.station = e.target.value;
      pollLiveTelemetry();
    });

    updateLeftRail();
    updateBreadcrumb();
    updateDepthUI();

    // Select Rack or Mod #01 initially to showcase the Roll-Up Inspector Drawer immediately!
    const initialNode = nodes.find(n => n.id === 'mod-01');
    if (initialNode) {
      selectNode(initialNode);
    }
  }

  // ----------------------------------------------------
  // Lifecycle Bootstrap
  // ----------------------------------------------------
  window.addEventListener('DOMContentLoaded', () => {
    buildGraphData();
    initCanvas();
    initUI();
    updateTopBanner();

    setInterval(pollLiveTelemetry, 1500);
    pollLiveTelemetry();
  });

})();
