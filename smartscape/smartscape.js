/**
 * Dynatrace-Style Smartscape Full-Stack Interactive Topology Engine
 * System: OpenEMS Microgrid & Energy Storage Digital Twin
 */

(function () {
  'use strict';

  // ----------------------------------------------------
  // Configuration & Constants
  // ----------------------------------------------------
  const TIERS = [
    { id: 'app', name: 'Applications', icon: '🌐', color: '#00d2ff', y: 100, desc: '虚拟电厂与商业调度策略层' },
    { id: 'ctrl', name: 'Control Plane', icon: '⚙️', color: '#a855f7', y: 260, desc: 'OpenEMS 边缘软PLC与云端中枢层' },
    { id: 'sys', name: 'Systems & Cabinets', icon: '🏢', color: '#10b981', y: 440, desc: '储能集装箱柜、PCS逆变器与关口计量' },
    { id: 'array', name: 'DC Arrays & Racks', icon: '⚡', color: '#f59e0b', y: 640, desc: '直流母线汇流、高压电池簇与BMU主控' },
    { id: 'mod', name: 'Battery Modules', icon: '🧱', color: '#ec4899', y: 840, desc: '10个串联电池模组与CSC从控采样板' },
    { id: 'cell', name: 'Battery Cells', icon: '🔬', color: '#06b6d4', y: 1060, desc: '160颗串联LiFePO4单体电芯与主动均衡' }
  ];

  // Global State
  const state = {
    mode: 'smartscape', // 'smartscape' | 'powerflow' | 'controlcomm' | 'bess'
    activeTier: null,
    selectedNode: null,
    hoveredNode: null,
    searchQuery: '',
    station: 'bms',
    scale: 0.85,
    panX: 80,
    panY: 30,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    animTime: 0,
    telemetry: {
      voltage: 528,
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
      modules: Array(10).fill(52.8),
      cells: Array(160).fill(3300)
    },
    sparklineHistory: Array(30).fill(528)
  };

  // ----------------------------------------------------
  // Graph Data Definition (Nodes & Edges)
  // ----------------------------------------------------
  const nodes = [];
  const edges = [];

  function buildGraphData() {
    nodes.length = 0;
    edges.length = 0;

    // --- Tier 1: Applications (5 Nodes) ---
    const apps = [
      { id: 'app-vpp', name: 'VPP 虚拟电厂多能聚合', tier: 'app', icon: '☁️', x: 250, type: 'app', status: 'normal', metrics: '参与电力现货 12.5MW' },
      { id: 'app-peakshaving', name: '需量控制与削峰填谷', tier: 'app', icon: '📉', x: 550, type: 'app', status: 'normal', metrics: '峰时放电 -25kW' },
      { id: 'app-balancing', name: '自发自用与防逆流平衡', tier: 'app', icon: '⚖️', x: 850, type: 'app', status: 'normal', metrics: '并网点残差 < 50W' },
      { id: 'app-evcs', name: '智能充电桩群控协同', tier: 'app', icon: '🚗', x: 1150, type: 'app', status: 'normal', metrics: '有序充电 60kW' },
      { id: 'app-spot', name: '日前预测与微网经济性', tier: 'app', icon: '📈', x: 1450, type: 'app', status: 'normal', metrics: '日前电价 1.25元/kWh' }
    ];
    nodes.push(...apps);

    // --- Tier 2: Control Plane (5 Nodes) ---
    const ctrls = [
      { id: 'ctrl-edge', name: 'OpenEMS Edge 软PLC内核', tier: 'ctrl', icon: '🧠', x: 450, type: 'service', status: 'normal', metrics: '周期 1000ms | 0死锁' },
      { id: 'ctrl-backend', name: 'OpenEMS Backend 路由网关', tier: 'ctrl', icon: '🌐', x: 850, type: 'service', status: 'normal', metrics: 'WSS 8084 隧道穿透' },
      { id: 'ctrl-influx', name: 'InfluxDB v2 时序持久化', tier: 'ctrl', icon: '📊', x: 1250, type: 'service', status: 'normal', metrics: 'Flux 引擎 | 5s落库' },
      { id: 'ctrl-metadata', name: 'Odoo ERP 设备元数据', tier: 'ctrl', icon: '💼', x: 1550, type: 'service', status: 'normal', metrics: 'PostgreSQL HikariCP' },
      { id: 'ctrl-mpc', name: 'MPC 模型预测控制引擎', tier: 'ctrl', icon: '🔮', x: 200, type: 'service', status: 'normal', metrics: '滚动时域优化 24h' }
    ];
    nodes.push(...ctrls);

    // --- Tier 3: Systems & Cabinets (6 Nodes) ---
    const systems = [
      { id: 'sys-grid', name: '10kV 园区进线并网关口', tier: 'sys', icon: '🗼', x: 200, type: 'system', status: 'normal', metrics: '380V/50.01Hz | 95kW' },
      { id: 'sys-pv', name: '120kW 屋顶分布式光伏', tier: 'sys', icon: '☀️', x: 500, type: 'system', status: 'normal', metrics: '日照 850W/m² | 78kW' },
      { id: 'sys-cabinet', name: '100kW/100kWh 储能一体柜', tier: 'sys', icon: '🏢', x: 850, type: 'system', status: 'normal', metrics: '液冷恒温 23.5℃ | RTE 92.5%' },
      { id: 'sys-pcs', name: '100kW PCS 双向储能变流器', tier: 'sys', icon: '⚡', x: 1200, type: 'system', status: 'normal', metrics: '效率 98.2% | cosφ 0.99' },
      { id: 'sys-load-hvac', name: '工业暖通冷水机房电表', tier: 'sys', icon: '❄️', x: 1500, type: 'system', status: 'normal', metrics: '负荷 32.5 kW' },
      { id: 'sys-load-machinery', name: '车间主生产线动力电表', tier: 'sys', icon: '🏭', x: 1750, type: 'system', status: 'normal', metrics: '负荷 48.0 kW' }
    ];
    nodes.push(...systems);

    // --- Tier 4: DC Arrays & Racks (4 Nodes) ---
    const arrays = [
      { id: 'arr-dcbus', name: '512V 直流汇流母线', tier: 'array', icon: '🔌', x: 600, type: 'array', status: 'normal', metrics: '528V DC | -24.5A' },
      { id: 'arr-rack', name: '高压电池簇 (Rack 160S1P)', tier: 'array', icon: '🔋', x: 950, type: 'array', status: 'normal', metrics: 'SOC 68.5% | 100kWh' },
      { id: 'arr-bmu', name: 'BMU 电池管理主控制器', tier: 'array', icon: '🖥️', x: 1300, type: 'array', status: 'normal', metrics: '包络 Max: 120A/140A' },
      { id: 'arr-hvbox', name: '高压继电器盒 (DC Breaker)', tier: 'array', icon: '🛡️', x: 350, type: 'array', status: 'normal', metrics: 'KM+/KM- 闭合 | 10MΩ' }
    ];
    nodes.push(...arrays);

    // --- Tier 5: Modules (10 Nodes) ---
    for (let m = 1; m <= 10; m++) {
      const mid = `mod-${m < 10 ? '0' + m : m}`;
      const mx = 180 + (m - 1) * 165;
      nodes.push({
        id: mid,
        name: `模组 #${m < 10 ? '0' + m : m} (16S 51.2V)`,
        tier: 'mod',
        icon: '🧱',
        x: mx,
        type: 'module',
        status: 'normal',
        modIndex: m,
        metrics: `52.8V | 24.5℃`
      });
    }

    // --- Tier 6: Cells (160 Nodes) ---
    // Organised in a neat 10-module grid, 16 cells per module
    for (let c = 1; c <= 160; c++) {
      const cid = `cell-${c < 10 ? '00' + c : (c < 100 ? '0' + c : c)}`;
      const mIdx = Math.floor((c - 1) / 16); // 0..9
      const cInM = (c - 1) % 16;             // 0..15
      
      const baseX = 120 + mIdx * 170;
      const col = cInM % 4;
      const row = Math.floor(cInM / 4);
      const cx = baseX + col * 36;
      const cy = 1000 + row * 40;

      let isMax = (c === 14);
      let isMin = (c === 3);
      let isMaxT = (c === 8);
      let isMinT = (c === 1);

      nodes.push({
        id: cid,
        name: `电芯 #${c}`,
        tier: 'cell',
        icon: '🔬',
        x: cx,
        y: cy,
        type: 'cell',
        status: isMax ? 'warning' : 'normal',
        cellIndex: c,
        isMaxV: isMax,
        isMinV: isMin,
        isMaxT: isMaxT,
        isMinT: isMinT,
        metrics: `${3300 + (isMax ? 14 : (isMin ? -12 : 2))}mV`
      });
    }

    // Balancing Bus Node
    nodes.push({
      id: 'cell-balancing-bus',
      name: '主动/被动电荷转移均衡硬件总线',
      tier: 'cell',
      icon: '⚡',
      x: 1820,
      y: 1060,
      type: 'cell',
      status: 'normal',
      metrics: '3路电荷转移中 (ΔV 27mV)'
    });

    // ----------------------------------------------------
    // Build Logical & Physical Dependencies (Edges)
    // ----------------------------------------------------
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
    addEdge('ctrl-edge', 'sys-cabinet', 'control', '机柜温控与消防保护');
    addEdge('ctrl-edge', 'sys-grid', 'comm', '关口电表高频采样');
    addEdge('ctrl-edge', 'sys-pv', 'comm', '光伏发电计量');
    addEdge('ctrl-edge', 'sys-load-hvac', 'comm', '空调冷冻水能耗');
    addEdge('ctrl-edge', 'sys-load-machinery', 'comm', '生产车间能耗');

    // Systems -> DC Array (Power Flow & Containment)
    addEdge('sys-grid', 'sys-pcs', 'power', '交流侧电能双向互济');
    addEdge('sys-pv', 'sys-pcs', 'power', '光伏余电注入直流母线');
    addEdge('sys-pcs', 'arr-dcbus', 'power', 'PCS 双向 DC/AC 逆变');
    addEdge('sys-cabinet', 'arr-rack', 'physical', '机柜物理容纳');
    addEdge('sys-cabinet', 'arr-hvbox', 'physical', '高压继电器盒控制');

    // DC Array -> Racks & BMU
    addEdge('arr-dcbus', 'arr-rack', 'power', '512V 充放电主母线');
    addEdge('arr-rack', 'arr-bmu', 'control', 'BMU 主控动态包络');
    addEdge('arr-hvbox', 'arr-rack', 'power', '主正主负接触器');
    addEdge('ctrl-edge', 'arr-bmu', 'comm', 'Modbus 8503 读取BMS');

    // Rack -> 10 Modules (Physical Containment & Series Connection)
    for (let m = 1; m <= 10; m++) {
      const mid = `mod-${m < 10 ? '0' + m : m}`;
      addEdge('arr-rack', mid, 'physical', '高压串联总线 512V');
      addEdge('arr-bmu', mid, 'comm', 'CSC/CMU 从控采样通信');
      if (m < 10) {
        const nextMid = `mod-${m + 1 < 10 ? '0' + (m + 1) : m + 1}`;
        addEdge(mid, nextMid, 'power', '模组间铜排硬连接');
      }
    }

    // Module -> Cells (Sample connections to keep canvas fast and clean)
    for (let m = 1; m <= 10; m++) {
      const mid = `mod-${m < 10 ? '0' + m : m}`;
      // Connect module to its representative cells
      const firstCell = (m - 1) * 16 + 1;
      const lastCell = m * 16;
      addEdge(mid, `cell-${firstCell < 10 ? '00' + firstCell : (firstCell < 100 ? '0' + firstCell : firstCell)}`, 'physical', 'CSC 采样支路');
      addEdge(mid, `cell-${lastCell < 10 ? '00' + lastCell : (lastCell < 100 ? '0' + lastCell : lastCell)}`, 'physical', 'CSC 采样支路');
    }

    // Connect cell balancing bus to outlier cells
    addEdge('cell-balancing-bus', 'cell-014', 'power', '主动能量释放 (#14 Max)');
    addEdge('cell-balancing-bus', 'cell-003', 'power', '主动电荷补充 (#03 Min)');
  }

  function addEdge(source, target, type, label) {
    edges.push({
      id: `${source}->${target}`,
      source,
      target,
      type, // 'power' | 'control' | 'comm' | 'physical'
      label
    });
  }

  // ----------------------------------------------------
  // Canvas Rendering Pipeline
  // ----------------------------------------------------
  let canvas, ctx;

  function initCanvas() {
    canvas = document.getElementById('topology-canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Mouse drag & zoom events
    const wrapper = document.getElementById('canvas-wrapper');
    wrapper.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    wrapper.addEventListener('wheel', onWheel, { passive: false });

    // Request animation frame loop
    requestAnimationFrame(renderLoop);
  }

  function resizeCanvas() {
    if (!canvas) return;
    canvas.width = canvas.parentElement.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.parentElement.clientHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check if clicked a node
    const clickedNode = findNodeAt(mx, my);
    if (clickedNode) {
      selectNode(clickedNode);
      return;
    }

    state.isDragging = true;
    state.dragStartX = e.clientX - state.panX;
    state.dragStartY = e.clientY - state.panY;
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
      }
    }
  }

  function onMouseUp() {
    state.isDragging = false;
  }

  function onWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    const newScale = Math.max(0.3, Math.min(2.5, state.scale * zoomFactor));

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

  function worldToScreen(wx, wy) {
    return {
      x: wx * state.scale + state.panX,
      y: wy * state.scale + state.panY
    };
  }

  function findNodeAt(sx, sy) {
    const worldPos = screenToWorld(sx, sy);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (isNodeVisible(n)) {
        const radius = n.tier === 'cell' ? 14 : 32;
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

  function isNodeVisible(node) {
    if (state.activeTier && node.tier !== state.activeTier) {
      // In active tier mode, also show directly connected nodes
      return isConnectedToActiveTier(node);
    }
    if (state.mode === 'bess') {
      return ['sys', 'array', 'mod', 'cell'].includes(node.tier);
    }
    if (state.mode === 'powerflow') {
      return ['sys', 'array', 'mod'].includes(node.tier) || node.id === 'app-peakshaving';
    }
    if (state.mode === 'controlcomm') {
      return ['app', 'ctrl', 'sys', 'array'].includes(node.tier);
    }
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      return node.name.toLowerCase().includes(q) || node.id.toLowerCase().includes(q);
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
  // Render Loop
  // ----------------------------------------------------
  function renderLoop() {
    state.animTime += 0.025;
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

    // 1. Draw Tier Background Bands & Watermarks
    drawTierBands();

    // 2. Draw Edges (Power Flow, Control, Physical)
    drawEdges();

    // 3. Draw Nodes
    drawNodes();

    ctx.restore();
  }

  function drawTierBands() {
    TIERS.forEach(tier => {
      if (state.activeTier && state.activeTier !== tier.id) return;
      const y = tier.y;
      
      // Tier Horizontal Band Glow
      ctx.fillStyle = `rgba(30, 41, 59, 0.15)`;
      ctx.fillRect(-200, y - 50, 2600, 100);

      ctx.strokeStyle = `rgba(255, 255, 255, 0.04)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(-200, y - 50);
      ctx.lineTo(2400, y - 50);
      ctx.stroke();
      ctx.setLineDash([]);

      // Tier Name Watermark on the Left
      ctx.fillStyle = tier.color;
      ctx.font = 'bold 13px -apple-system, sans-serif';
      ctx.fillText(`${tier.icon} ${tier.name.toUpperCase()} (TIER)`, -120, y);
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

      // Smooth Bezier Curve between Tiers
      const cp1y = sy + (ty - sy) * 0.5;
      const cp2y = sy + (ty - sy) * 0.5;
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx, cp1y, tx, cp2y, tx, ty);

      if (edge.type === 'power') {
        // High-Voltage Power Flow (Pulsing Amber/Blue)
        ctx.strokeStyle = isHovered || isSelected ? '#fbbf24' : 'rgba(245, 158, 11, 0.45)';
        ctx.lineWidth = isHovered || isSelected ? 3.5 : 2.0;
        ctx.stroke();

        // Flowing energy particle dots
        const t = (state.animTime * 1.5) % 1.0;
        const pt = getBezierPoint(sx, sy, sx, cp1y, tx, cp2y, tx, ty, t);
        ctx.fillStyle = '#fbbf24';
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

      } else if (edge.type === 'control') {
        // Control Signal (Pulsing Purple)
        ctx.strokeStyle = isHovered || isSelected ? '#c084fc' : 'rgba(168, 85, 247, 0.35)';
        ctx.lineWidth = isHovered || isSelected ? 2.5 : 1.5;
        ctx.setLineDash([4, 6]);
        ctx.lineDashOffset = -state.animTime * 20;
        ctx.stroke();

      } else if (edge.type === 'comm') {
        // Modbus / Telemetry (Pulsing Cyan)
        ctx.strokeStyle = isHovered || isSelected ? '#38bdf8' : 'rgba(56, 189, 248, 0.3)';
        ctx.lineWidth = isHovered || isSelected ? 2.5 : 1.2;
        ctx.setLineDash([3, 5]);
        ctx.lineDashOffset = -state.animTime * 15;
        ctx.stroke();

      } else {
        // Physical Containment
        ctx.strokeStyle = isHovered || isSelected ? '#94a3b8' : 'rgba(148, 163, 184, 0.2)';
        ctx.lineWidth = 1.0;
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
    const xt = ax * (t * t * t) + bx * (t * t) + cx * t + x0;
    const yt = ay * (t * t * t) + by * (t * t) + cy * t + y0;
    return { x: xt, y: yt };
  }

  function drawNodes() {
    nodes.forEach(node => {
      if (!isNodeVisible(node)) return;
      const ny = getNodeY(node);
      const isSelected = (state.selectedNode && state.selectedNode.id === node.id);
      const isHovered = (state.hoveredNode && state.hoveredNode.id === node.id);

      ctx.save();

      if (node.tier === 'cell') {
        // Compact Cell Rendering (160 Cells)
        drawCellNode(node, node.x, ny, isSelected, isHovered);
      } else {
        // Standard Smartscape Macro Node
        drawMacroNode(node, node.x, ny, isSelected, isHovered);
      }

      ctx.restore();
    });
  }

  function drawMacroNode(node, x, y, isSelected, isHovered) {
    const tierObj = TIERS.find(t => t.id === node.tier);
    const tierColor = tierObj ? tierObj.color : '#3b82f6';
    const radius = 28;

    // Glowing Ring
    if (isSelected || isHovered) {
      ctx.shadowColor = tierColor;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = tierColor;
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
    ctx.lineWidth = 2;
    ctx.stroke();

    // Icon Inside Node
    ctx.font = '18px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.icon, x, y);

    // Status Indicator Dot (Top Right)
    ctx.fillStyle = node.status === 'warning' ? '#f59e0b' : '#10b981';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(x + 18, y - 18, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Label Under Node
    ctx.font = 'bold 11px -apple-system, sans-serif';
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.fillText(node.name, x, y + radius + 14);

    // Metric Pill Under Label
    if (node.metrics) {
      ctx.font = '9px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(node.metrics, x, y + radius + 27);
    }
  }

  function drawCellNode(node, x, y, isSelected, isHovered) {
    const size = 11;
    let cellColor = '#10b981'; // normal LiFePO4 green
    if (node.isMaxV) cellColor = '#f59e0b'; // Max V amber
    if (node.isMinV) cellColor = '#3b82f6'; // Min V blue
    if (node.isMaxT) cellColor = '#ef4444'; // Max T red
    if (node.isMinT) cellColor = '#06b6d4'; // Min T cyan

    if (isSelected || isHovered) {
      ctx.shadowColor = cellColor;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - size, y - size, size * 2, size * 2);
      ctx.shadowBlur = 0;
    }

    ctx.fillStyle = cellColor;
    ctx.fillRect(x - size + 2, y - size + 2, size * 2 - 4, size * 2 - 4);

    // Cell number tiny text
    ctx.font = '8px monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.cellIndex || '', x, y);
  }

  // ----------------------------------------------------
  // Selection & Inspector Drawer
  // ----------------------------------------------------
  function selectNode(node) {
    state.selectedNode = node;
    const drawer = document.getElementById('inspector-drawer');
    drawer.classList.remove('collapsed');

    // Populate Drawer Header
    const tierObj = TIERS.find(t => t.id === node.tier);
    const badge = document.getElementById('drawer-badge');
    badge.textContent = tierObj ? tierObj.name : node.tier;
    badge.style.background = tierObj ? `${tierObj.color}25` : '#3b82f625';
    badge.style.color = tierObj ? tierObj.color : '#3b82f6';
    badge.style.border = `1px solid ${tierObj ? tierObj.color : '#3b82f6'}`;

    document.getElementById('drawer-title').textContent = node.name;
    document.getElementById('drawer-subtitle').textContent = `ID: ${node.id} | Component: ${node.type}`;

    // Populate Metrics Grid
    const metricsContainer = document.getElementById('drawer-metrics');
    metricsContainer.innerHTML = '';

    if (node.tier === 'cell') {
      const v = state.telemetry.cells[node.cellIndex - 1] || (3280 + (node.cellIndex * 37) % 50);
      addMetricCard(metricsContainer, '单体电压 (Cell Voltage)', v, 'mV');
      addMetricCard(metricsContainer, '单体温度 (Cell Temp)', (24.2 + (node.cellIndex % 10) * 0.2).toFixed(1), '°C');
      addMetricCard(metricsContainer, '电芯健康度 (SOH)', '99.5', '%');
      addMetricCard(metricsContainer, '均衡状态 (Balancing)', node.isMaxV ? 'ACTIVE ⚡' : 'IDLE', '');
    } else if (node.tier === 'mod') {
      const mv = state.telemetry.modules[node.modIndex - 1] || 52.8;
      addMetricCard(metricsContainer, '模组电压 (Voltage)', mv.toFixed(1), 'V');
      addMetricCard(metricsContainer, '模组温度 (Temp)', (24.5 + node.modIndex * 0.15).toFixed(1), '°C');
      addMetricCard(metricsContainer, '单体电芯数量', '16', 'Cells (16S)');
      addMetricCard(metricsContainer, 'CSC 从控状态', 'NORMAL 🟢', '');
    } else if (node.tier === 'array' || node.id === 'sys-cabinet') {
      addMetricCard(metricsContainer, 'Pack 端电压', state.telemetry.voltage, 'V');
      addMetricCard(metricsContainer, 'Pack 充放电电流', state.telemetry.current.toFixed(1), 'A');
      addMetricCard(metricsContainer, '荷电状态 (SOC)', state.telemetry.soc.toFixed(1), '%');
      addMetricCard(metricsContainer, '电芯最大压差 (ΔV)', state.telemetry.deltaV, 'mV');
      addMetricCard(metricsContainer, '绝缘电阻', state.telemetry.insulation, 'kΩ');
      addMetricCard(metricsContainer, '空调温控状态', state.telemetry.hvacStatus ? '制冷运行 ❄️' : '待机', '');
    } else {
      addMetricCard(metricsContainer, '运行工况', 'NORMAL 🟢', '');
      addMetricCard(metricsContainer, '系统心跳', '1000ms OK', '');
      addMetricCard(metricsContainer, '实时负载', node.metrics || '98.5%', '');
      addMetricCard(metricsContainer, '告警数', '0 Critical', '');
    }

    // Populate Inbound/Outbound Dependencies
    populateDependencies(node);

    // Draw Rolling Sparkline
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

  function populateDependencies(node) {
    const inContainer = document.getElementById('drawer-deps-in');
    const outContainer = document.getElementById('drawer-deps-out');
    inContainer.innerHTML = '';
    outContainer.innerHTML = '';

    const inEdges = edges.filter(e => e.target === node.id);
    const outEdges = edges.filter(e => e.source === node.id);

    if (inEdges.length === 0) {
      inContainer.innerHTML = '<div style="font-size:12px;color:#64748b;">(顶级根节点，无上游依赖)</div>';
    } else {
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
    }

    if (outEdges.length === 0) {
      outContainer.innerHTML = '<div style="font-size:12px;color:#64748b;">(末端叶节点，无下游依附)</div>';
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

  function drawSparkline(node) {
    const cvs = document.getElementById('sparkline-canvas');
    if (!cvs) return;
    const sctx = cvs.getContext('2d');
    const w = cvs.clientWidth;
    const h = cvs.clientHeight;
    cvs.width = w * window.devicePixelRatio;
    cvs.height = h * window.devicePixelRatio;
    sctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    sctx.clearRect(0, 0, w, h);

    const data = state.sparklineHistory;
    const min = Math.min(...data) - 5;
    const max = Math.max(...data) + 5;

    sctx.strokeStyle = '#38bdf8';
    sctx.lineWidth = 2;
    sctx.beginPath();
    data.forEach((val, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((val - min) / (max - min)) * (h - 10) - 5;
      if (i === 0) sctx.moveTo(x, y);
      else sctx.lineTo(x, y);
    });
    sctx.stroke();

    // Area fill
    sctx.lineTo(w, h);
    sctx.lineTo(0, h);
    sctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
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
    tip.innerHTML = `
      <div class="tooltip-title">${node.icon} ${node.name}</div>
      <div class="tooltip-row"><span>层级 (Tier):</span><span class="tooltip-val">${tierObj ? tierObj.name : ''}</span></div>
      <div class="tooltip-row"><span>实时指标:</span><span class="tooltip-val" style="color:#38bdf8;">${node.metrics || 'NORMAL'}</span></div>
      <div class="tooltip-row"><span>健康状态:</span><span class="tooltip-val" style="color:#10b981;">🟢 正常</span></div>
    `;
  }

  // ----------------------------------------------------
  // Live Telemetry Polling (Edge REST API & InfluxDB)
  // ----------------------------------------------------
  async function pollLiveTelemetry() {
    try {
      // 1. Fetch live channels from OpenEMS Edge via Nginx reverse proxy
      const res = await fetch('/openems-rest/channel/battery0/Soc');
      if (res.ok) {
        const json = await res.json();
        if (json.value !== undefined) {
          state.telemetry.soc = json.value;
        }
      }

      const resV = await fetch('/openems-rest/channel/battery0/Voltage');
      if (resV.ok) {
        const jsonV = await resV.json();
        if (jsonV.value !== undefined) {
          state.telemetry.voltage = jsonV.value;
          state.sparklineHistory.push(state.telemetry.voltage);
          if (state.sparklineHistory.length > 30) state.sparklineHistory.shift();
        }
      }

      const resI = await fetch('/openems-rest/channel/battery0/Current');
      if (resI.ok) {
        const jsonI = await resI.json();
        if (jsonI.value !== undefined) {
          state.telemetry.current = jsonI.value;
          state.telemetry.powerKw = (state.telemetry.voltage * state.telemetry.current / 1000.0).toFixed(1);
        }
      }

      const resMaxCell = await fetch('/openems-rest/channel/battery0/MaxCellVoltage');
      if (resMaxCell.ok) {
        const json = await resMaxCell.json();
        if (json.value !== undefined) state.telemetry.maxCellV = json.value;
      }

      const resMinCell = await fetch('/openems-rest/channel/battery0/MinCellVoltage');
      if (resMinCell.ok) {
        const json = await resMinCell.json();
        if (json.value !== undefined) state.telemetry.minCellV = json.value;
      }

      state.telemetry.deltaV = state.telemetry.maxCellV - state.telemetry.minCellV;

      // Update Top Status Banner
      updateTopBanner();

      // Refresh Drawer if open
      if (state.selectedNode) {
        selectNode(state.selectedNode);
      }

    } catch (e) {
      // Background poll failure fallback gracefully
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
    if (socEl) socEl.textContent = `${state.telemetry.soc.toFixed(1)}%`;
    const deltaEl = document.getElementById('kpi-delta-v');
    if (deltaEl) deltaEl.textContent = `${state.telemetry.deltaV} mV`;
  }

  // ----------------------------------------------------
  // UI Interaction Bindings
  // ----------------------------------------------------
  function initUI() {
    // Mode Tabs
    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.mode = tab.dataset.mode;
      });
    });

    // Left Rail Tier Buttons
    const rail = document.getElementById('smartscape-rail');
    TIERS.forEach(tier => {
      const count = nodes.filter(n => n.tier === tier.id).length;
      const btn = document.createElement('div');
      btn.className = 'rail-tier-btn';
      btn.dataset.tier = tier.id;
      btn.innerHTML = `
        <span class="tier-icon">${tier.icon}</span>
        <span class="tier-label">${tier.name.split(' ')[0]}</span>
        <span class="tier-badge">${count}</span>
      `;
      btn.onclick = () => {
        if (state.activeTier === tier.id) {
          state.activeTier = null;
          btn.classList.remove('active');
        } else {
          document.querySelectorAll('.rail-tier-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.activeTier = tier.id;
          focusOnTier(tier);
        }
      };
      rail.appendChild(btn);
    });

    // Drawer Close Button
    document.getElementById('drawer-close').onclick = () => {
      document.getElementById('inspector-drawer').classList.add('collapsed');
      state.selectedNode = null;
    };

    // Zoom and Fit Controls
    document.getElementById('btn-zoom-in').onclick = () => {
      state.scale = Math.min(2.5, state.scale * 1.2);
    };
    document.getElementById('btn-zoom-out').onclick = () => {
      state.scale = Math.max(0.3, state.scale / 1.2);
    };
    document.getElementById('btn-fit').onclick = () => {
      state.scale = 0.85;
      state.panX = 80;
      state.panY = 30;
      state.activeTier = null;
      document.querySelectorAll('.rail-tier-btn').forEach(b => b.classList.remove('active'));
    };

    // Search Input
    document.getElementById('search-box').addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim();
    });

    // Station Selector
    document.getElementById('station-select').addEventListener('change', (e) => {
      state.station = e.target.value;
      pollLiveTelemetry();
    });
  }

  function focusOnTier(tier) {
    const canvasH = canvas.parentElement.clientHeight;
    state.panY = canvasH / 2 - tier.y * state.scale;
  }

  // ----------------------------------------------------
  // Lifecycle Initialization
  // ----------------------------------------------------
  window.addEventListener('DOMContentLoaded', () => {
    buildGraphData();
    initCanvas();
    initUI();
    updateTopBanner();

    // Start background telemetry polling
    setInterval(pollLiveTelemetry, 1500);
    pollLiveTelemetry();
  });

})();
