#!/usr/bin/env node
/**
 * Automated Unit Test Suite for OpenEMS Smartscape Engine (v3.0)
 * Verifies:
 *   1. Graph & Tree Structure (197 Nodes, 261 Edges, O(1) Maps, Dynamic Descendant Counts)
 *   2. Dynamic Extremes & True Bottom-Up Status Propagation (Normal / Warning / Critical)
 *   3. L5 2nd-Order Thevenin RC Equivalent Circuit KVL & Sign Consistency
 *   4. Dynatrace Edge Roll-Up (Projecting hidden child edges onto visible ancestor containers)
 *   5. L3 <-> L4 Module Expansion State Preservation & PowerFlow Mode Filtering
 */

const assert = require('assert');
const path = require('path');
const engine = require(path.resolve(__dirname, '../smartscape/smartscape.js'));

console.log('=== OpenEMS Smartscape Engine v3.0 Unit Test Suite ===');

// 1. Build Graph & Verify Counts
engine.buildGraphData();
console.log(`[1] Graph built: ${engine.nodes.length} nodes, ${engine.edges.length} edges`);
assert.strictEqual(engine.nodes.length, 198, 'Expected 198 total nodes (including 7 fleet stations)');
assert.ok(engine.edges.length >= 260, `Expected >= 260 edges (including 16S chains), got ${engine.edges.length}`);

// Verify dynamic descendant counts
const cabDesc = engine.getDescendantSummary('sys-cabinet');
assert.strictEqual(cabDesc.array, 4, 'Cabinet should have 4 array children');
assert.strictEqual(cabDesc.mod, 10, 'Cabinet should have 10 module descendants');
assert.strictEqual(cabDesc.cell, 160, 'Cabinet should have 160 cell descendants');

const rackDesc = engine.getDescendantSummary('arr-rack');
assert.strictEqual(rackDesc.mod, 10, 'Rack should have 10 module children');
assert.strictEqual(rackDesc.cell, 160, 'Rack should have 160 cell descendants');
console.log('[1] PASS: Dynamic tree descendant counts verified.');

// 2. Verify Dynamic Extremes & True Bottom-Up Status Propagation (No hardcoded m === 1)
for (let i = 0; i < 160; i++) {
  engine.state.telemetry.cellsV[i] = 3300 + (i % 3); // deltaV = 2mV (healthy balanced pack)
  engine.state.telemetry.cellsT[i] = 24.0;
}
engine.computeRollUpAggregations();
assert.strictEqual(engine.nodeById.get('arr-rack').status, 'normal', 'Healthy balanced pack (deltaV=2mV) must have normal rack status');
assert.strictEqual(engine.nodeById.get('sys-cabinet').status, 'normal', 'Healthy balanced pack must have normal cabinet status');

// Now inject warning cell at #77 (in Mod #05) and min cell at #42 (in Mod #03)
for (let i = 0; i < 160; i++) {
  engine.state.telemetry.cellsV[i] = 3300;
  engine.state.telemetry.cellsT[i] = 24.0;
}
engine.state.telemetry.cellsV[76] = 3330; // Cell #77 (Mod #05)
engine.state.telemetry.cellsV[41] = 3285; // Cell #42 (Mod #03)
engine.state.telemetry.cellsT[119] = 27.2; // Cell #120 (Mod #08)
engine.computeRollUpAggregations();

const balOut = engine.edges.filter(e => e.source === 'cell-balancing-bus');
assert.ok(balOut.some(e => e.target === 'cell-077'), 'Balancing bus max edge must dynamically retarget cell-077');
assert.ok(balOut.some(e => e.target === 'cell-042'), 'Balancing bus min edge must dynamically retarget cell-042');

assert.strictEqual(engine.state.telemetry.maxCellNo, 77, 'Dynamic maxCellNo should be 77');
assert.strictEqual(engine.state.telemetry.minCellNo, 42, 'Dynamic minCellNo should be 42');
assert.strictEqual(engine.state.telemetry.maxTempNo, 120, 'Dynamic maxTempNo should be 120');
assert.strictEqual(engine.nodeById.get('mod-01').status, 'normal', 'Mod #01 must be normal when all its cells are 3300mV');
assert.strictEqual(engine.nodeById.get('mod-05').status, 'warning', 'Mod #05 must be warning due to Cell #77');
assert.strictEqual(engine.nodeById.get('arr-rack').status, 'warning', 'Rack must inherit warning from Mod #05');
assert.strictEqual(engine.nodeById.get('sys-cabinet').status, 'warning', 'Cabinet must inherit warning from Rack');
assert.strictEqual(engine.nodeById.get('station-bms').status, 'warning', 'Station must inherit warning from Cabinet');

// Test Critical propagation
engine.state.telemetry.cellsV[120] = 3410; // Cell #121 in Mod #08 -> critical (>= 3400mV)
engine.computeRollUpAggregations();
assert.strictEqual(engine.nodeById.get('mod-08').status, 'critical', 'Mod #08 must be critical');
assert.strictEqual(engine.nodeById.get('arr-rack').status, 'critical', 'Rack must inherit critical');
assert.strictEqual(engine.nodeById.get('sys-cabinet').status, 'critical', 'Cabinet must inherit critical');
assert.strictEqual(engine.nodeById.get('station-bms').status, 'critical', 'Station must inherit critical');
console.log('[2] PASS: Dynamic extremes & bottom-up status propagation (normal -> warning -> critical) verified.');

// 3. Verify L5 2nd-Order Thevenin RC Equivalent Circuit KVL & Sign Consistency
// Case A: Discharging (I = +30A > 0) -> Vocv must be GREATER than Vterm
engine.state.telemetry.current = 30.0;
const rcDis = engine.buildCellMicroTwin(engine.nodeById.get('cell-077'));
assert.ok(rcDis.vOcvMv > rcDis.vTermMv, `During discharge (I>0), Vocv (${rcDis.vOcvMv}) must be > Vterm (${rcDis.vTermMv})`);
assert.ok(Math.abs((rcDis.vOcvMv - rcDis.u0Mv - rcDis.u1Mv - rcDis.u2Mv) - rcDis.vTermMv) < 1e-4, 'KVL identity failed on discharge');

// Case B: Charging (I = -30A < 0) -> Vocv must be LESS than Vterm
engine.state.telemetry.current = -30.0;
const rcChg = engine.buildCellMicroTwin(engine.nodeById.get('cell-077'));
assert.ok(rcChg.vOcvMv < rcChg.vTermMv, `During charge (I<0), Vocv (${rcChg.vOcvMv}) must be < Vterm (${rcChg.vTermMv})`);
assert.ok(Math.abs((rcChg.vOcvMv - rcChg.u0Mv - rcChg.u1Mv - rcChg.u2Mv) - rcChg.vTermMv) < 1e-4, 'KVL identity failed on charge');
console.log('[3] PASS: L5 Thevenin RC equivalent circuit KVL & OCV sign verified.');

// 4. Verify Dynatrace Edge Roll-Up (L1 Cabinet Roll-Up projects child edges onto sys-cabinet)
engine.setRollupDepth(1);
const l1Edges = engine.getEffectiveEdges();
const edgeToCab = l1Edges.find(e => e.source === 'ctrl-edge' && e.target === 'sys-cabinet');
assert.ok(edgeToCab, 'ctrl-edge -> sys-cabinet rolled-up edge should exist in L1');
assert.ok(edgeToCab.count >= 2 && edgeToCab.isProjected, `Expected ctrl-edge -> sys-cabinet to aggregate child edges (ctrl-edge -> arr-bmu), got count=${edgeToCab.count}`);
console.log(`[4] PASS: Dynatrace Edge Roll-Up verified (ctrl-edge -> sys-cabinet aggregated ×${edgeToCab.count} links in L1).`);

// 5. Verify L3 <-> L4 Module Expansion Preservation & PowerFlow Mode
engine.setRollupDepth(3);
engine.state.expandedContainers.clear();
engine.state.expandedContainers.add('station-bms');
engine.state.expandedContainers.add('sys-cabinet');
engine.state.expandedContainers.add('arr-rack');
engine.state.expandedContainers.add('mod-03');
engine.state.expandedContainers.add('mod-07');
engine.recomputeVisibilityCache();

// Switch L3 -> L4 -> L3
engine.setRollupDepth(4);
assert.ok(engine.state.expandedContainers.has('mod-10'), 'L4 must expand all 10 modules');
engine.setRollupDepth(3);
assert.strictEqual(engine.state.expandedContainers.has('mod-03'), true, 'Returning to L3 must preserve mod-03');
assert.strictEqual(engine.state.expandedContainers.has('mod-07'), true, 'Returning to L3 must preserve mod-07');
assert.strictEqual(engine.state.expandedContainers.has('mod-01'), false, 'Returning to L3 must not force mod-01');

// Verify PowerFlow mode filters out non-power nodes & non-power edges
engine.state.mode = 'powerflow';
engine.recomputeVisibilityCache();
assert.strictEqual(engine.visibleNodeIds.has('ctrl-edge'), false, 'PowerFlow mode must hide ctrl-edge');
assert.strictEqual(engine.visibleNodeIds.has('arr-bmu'), false, 'PowerFlow mode must hide arr-bmu');
assert.strictEqual(engine.visibleNodeIds.has('sys-pcs'), true, 'PowerFlow mode must show sys-pcs');
assert.ok(engine.getEffectiveEdges().every(e => e.type === 'power'), 'PowerFlow mode must only render power edges');
engine.state.mode = 'smartscape';
engine.recomputeVisibilityCache();
console.log('[5] PASS: L3<->L4 state preservation & PowerFlow mode filtering verified.');

// 6. Verify Multi-Station Switching Rebinds selectedNode & Updates Station Profile
engine.selectNode(engine.nodeById.get('sys-cabinet'));
const oldCabRef = engine.state.selectedNode;
engine.switchStation('2');
const newCabRef = engine.nodeById.get('sys-cabinet');
assert.notStrictEqual(oldCabRef, newCabRef, 'buildGraphData must create fresh node instances');
assert.strictEqual(engine.state.selectedNode, newCabRef, 'switchStation must rebind state.selectedNode to the newly built node instance');
assert.ok(newCabRef.name.includes('2000kW/4000kWh'), `Station 2 cabinet name should reflect 2000kW/4000kWh, got ${newCabRef.name}`);
console.log('[6] PASS: Multi-station switching rebinds selectedNode & updates station profile.');

// 7. Live HTTP Integration Test against /openems-influx (bms, edge1, edge2)
(async () => {
  engine.switchStation('bms');
  await engine.pollLiveTelemetry();
  assert.strictEqual(engine.state.connHealthy, true, 'Live poll for station bms must succeed');
  assert.strictEqual(engine.state.telemetry.maxCellNo, 14, `Station bms maxCellNo should be 14, got ${engine.state.telemetry.maxCellNo}`);
  assert.strictEqual(engine.state.telemetry.minCellNo, 3, `Station bms minCellNo should be 3, got ${engine.state.telemetry.minCellNo}`);

  engine.switchStation('1');
  await engine.pollLiveTelemetry();
  assert.strictEqual(engine.state.connHealthy, true, 'Live poll for station 1 must succeed');
  assert.strictEqual(engine.state.telemetry.maxCellNo, 43, `Station 1 maxCellNo should be 43, got ${engine.state.telemetry.maxCellNo}`);
  assert.strictEqual(engine.state.telemetry.minCellNo, 22, `Station 1 minCellNo should be 22, got ${engine.state.telemetry.minCellNo}`);

  engine.switchStation('2');
  await engine.pollLiveTelemetry();
  assert.strictEqual(engine.state.connHealthy, true, 'Live poll for station 2 must succeed');
  assert.strictEqual(engine.state.telemetry.maxCellNo, 72, `Station 2 maxCellNo should be 72, got ${engine.state.telemetry.maxCellNo}`);
  assert.strictEqual(engine.state.telemetry.minCellNo, 41, `Station 2 minCellNo should be 41, got ${engine.state.telemetry.minCellNo}`);

  engine.switchStation('pcs');
  await engine.pollLiveTelemetry();
  assert.strictEqual(engine.state.connHealthy, true, 'Live poll for station pcs must succeed');
  assert.ok(engine.state.telemetry.pcs.gridVoltageV > 350, 'PCS grid voltage should be ~380V');
  assert.ok(engine.state.telemetry.pcs.activePowerKw > 0, 'PCS active power should be positive');
  console.log('[7] PASS: Live InfluxDB HTTP polling verified across stations bms (#14/#3), edge1 (#43/#22), edge2 (#72/#41), pcs.');

  // 8. Verify DOM Inspector Drawer Interactions (Non-Destructive Refresh, L4 Single-Mod Roll-Up, L5 Micro-RC Selection)
  const domElements = new Map();
  function makeMockEl(id = '') {
    let _innerHTML = '';
    const el = {
      id,
      textContent: '',
      get innerHTML() { return _innerHTML; },
      set innerHTML(val) {
        _innerHTML = val;
        if (val === '') this.children = [];
      },
      disabled: false,
      onclick: null,
      style: {},
      dataset: {},
      children: [],
      attrs: new Map(),
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); },
        toggle(c, force) {
          if (force === undefined) {
            if (this.classes.has(c)) this.classes.delete(c);
            else this.classes.add(c);
          } else if (force) this.classes.add(c);
          else this.classes.delete(c);
        }
      },
      appendChild(ch) { this.children.push(ch); return ch; },
      setAttribute(k, v) { this.attrs.set(k, v); },
      getAttribute(k) { return this.attrs.get(k); },
      querySelectorAll() { return []; },
      getContext() {
        return {
          setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}
        };
      }
    };
    if (id) domElements.set(id, el);
    return el;
  }

  [
    'inspector-drawer', 'drawer-badge', 'drawer-title', 'drawer-subtitle',
    'btn-drawer-drilldown', 'lbl-drawer-drilldown', 'btn-drawer-rollup', 'lbl-drawer-rollup',
    'drawer-rollup-section', 'drawer-rollup-box', 'drawer-rollup-badge', 'drawer-metrics',
    'drawer-children-section', 'drawer-children-list', 'drawer-children-count',
    'drawer-deps-in', 'drawer-deps-out', 'sparkline-canvas', 'sparkline-metric-label',
    'breadcrumb-trail', 'smartscape-rail', 'kpi-depth-status', 'kpi-node-count',
    'kpi-conn-status', 'kpi-power', 'kpi-soc', 'kpi-delta-v', 'station-select'
  ].forEach(id => makeMockEl(id));

  global.document = {
    getElementById(id) { return domElements.get(id) || makeMockEl(id); },
    createElement(tag) { return makeMockEl(tag); },
    querySelectorAll() { return []; }
  };

  // Test non-destructive refresh: populateDrawer builds child list, refreshDrawerLiveValues does NOT clear child list
  engine.switchStation('bms');
  engine.setRollupDepth(3);
  engine.selectNode(engine.nodeById.get('mod-01'));
  const childListEl = domElements.get('drawer-children-list');
  assert.strictEqual(childListEl.children.length, 16, 'Mod-01 drawer should list 16 child cells');
  const firstChildNodeRef = childListEl.children[0];
  engine.refreshDrawerLiveValues(engine.nodeById.get('mod-01'));
  assert.strictEqual(childListEl.children[0], firstChildNodeRef, 'refreshDrawerLiveValues must NOT recreate child list DOM nodes');

  // Test L4 cell roll-up via btn-drawer-rollup: collapses only parent module in L3 while keeping other 9 modules expanded
  engine.setRollupDepth(4);
  engine.selectNode(engine.nodeById.get('cell-014')); // child of mod-01
  domElements.get('btn-drawer-rollup').onclick();
  assert.strictEqual(engine.state.rollupDepth, 3, 'Rolling up a cell from L4 must transition to L3');
  assert.strictEqual(engine.state.expandedContainers.has('mod-01'), false, 'Parent module mod-01 must be collapsed');
  assert.strictEqual(engine.state.expandedContainers.has('mod-02'), true, 'Sibling module mod-02 must remain expanded');

  // Test L5 micro-rc node selection in drawer
  engine.setRollupDepth(5, engine.nodeById.get('cell-014'));
  const rcR0 = engine.microNodes.find(n => n.id === 'rc-r0');
  engine.selectNode(rcR0);
  assert.strictEqual(domElements.get('drawer-metrics').children.length, 4, 'L5 micro-rc node must render 4 RC metric cards');
  assert.ok(domElements.get('drawer-deps-out').children.length >= 2, 'L5 rc-r0 must list downstream microEdges in drawer');
  console.log('[8] PASS: DOM Inspector Drawer (non-destructive refresh, L4 cell roll-up, L5 micro-rc dependencies) verified.');

  // 9. Verify "双击即下钻" (Double-Click Always Drills Down L0 -> L1 -> L2 -> L3 -> L4 -> L5 & Full Hit-Box)
  engine.setRollupDepth(0);
  // L0 -> L1 via Fleet Station
  engine.drillDownNode(engine.nodeById.get('station-bms'));
  assert.strictEqual(engine.state.rollupDepth, 1, 'Double-clicking station at L0 must drill down to L1');
  assert.strictEqual(engine.state.selectedNode.id, 'sys-cabinet', 'L1 drill-down must select sys-cabinet');

  // L1 -> L2 via Cabinet
  engine.drillDownNode(engine.nodeById.get('sys-cabinet'));
  assert.strictEqual(engine.state.rollupDepth, 2, 'Double-clicking sys-cabinet at L1 must drill down to L2');
  assert.strictEqual(engine.state.selectedNode.id, 'arr-rack', 'L2 drill-down must select arr-rack');

  // L2 -> L3 via Cabinet or Rack (never collapses!)
  engine.drillDownNode(engine.nodeById.get('sys-cabinet'));
  assert.strictEqual(engine.state.rollupDepth, 3, 'Double-clicking already-expanded sys-cabinet at L2 must drill deeper to L3');

  // L3 -> L4 via Rack (never collapses to L2!)
  engine.drillDownNode(engine.nodeById.get('arr-rack'));
  assert.strictEqual(engine.state.rollupDepth, 4, 'Double-clicking already-expanded arr-rack at L3 must drill deeper to L4 (160 cells)');

  // L4 -> L5 via Rack
  engine.drillDownNode(engine.nodeById.get('arr-rack'));
  assert.strictEqual(engine.state.rollupDepth, 5, 'Double-clicking arr-rack at L4 must drill deeper to L5 (Cell RC Micro-Twin)');

  // Module Two-Stage Drill-Down: Collapsed Mod-02 -> Expand 16 Cells -> Peak Cell L5 Micro-Twin
  engine.state.savedL3Modules = ['mod-01'];
  engine.setRollupDepth(3);
  assert.strictEqual(engine.state.expandedContainers.has('mod-02'), false, 'mod-02 starts collapsed at L3');
  engine.drillDownNode(engine.nodeById.get('mod-02'));
  assert.strictEqual(engine.state.expandedContainers.has('mod-02'), true, '1st double-click on mod-02 must expand its 16 cells');
  engine.drillDownNode(engine.nodeById.get('mod-02'));
  assert.strictEqual(engine.state.rollupDepth, 5, '2nd double-click on already-expanded mod-02 must drill down to L5 (never collapse)');

  // Hit-Box Test: Clicking on top badge (dy = -45) and bottom label (dy = +50) of a macro node
  engine.setRollupDepth(3);
  engine.state.panX = 0;
  engine.state.panY = 0;
  engine.state.scale = 1.0;
  const mod3 = engine.nodeById.get('mod-03');
  const hitTopBadge = engine.findNodeAt(mod3.x, 800 - 45);
  const hitBottomLabel = engine.findNodeAt(mod3.x, 800 + 50);
  assert.strictEqual(hitTopBadge && hitTopBadge.id, 'mod-03', 'findNodeAt must match top [+16电芯 🔽] badge of mod-03');
  assert.strictEqual(hitBottomLabel && hitBottomLabel.id, 'mod-03', 'findNodeAt must match bottom title/metrics label of mod-03');
  console.log('[9] PASS: "双击即下钻" (L0->L1->L2->L3->L4->L5 progressive drill-down & full badge/label hit-box) verified.');

  // 10. Verify Tooltip Never Covers Mouse Cursor or Node Icon across all positions
  makeMockEl('smartscape-tooltip');
  const testCoords = [
    { node: engine.nodeById.get('mod-01'), mx: 180, my: 800 },
    { node: engine.nodeById.get('mod-05'), mx: 900, my: 800 },
    { node: engine.nodeById.get('mod-10'), mx: 1360, my: 800 },
    { node: engine.nodeById.get('app-vpp'), mx: 180, my: 50 },
    { node: engine.nodeById.get('cell-014'), mx: 240, my: 980 }
  ];
  testCoords.forEach(({ node, mx, my }) => {
    const box = engine.updateTooltip(node, mx, my);
    assert.ok(box, `Tooltip box must be returned for ${node.id}`);
    const cursorInsideX = mx >= box.left - 10 && mx <= box.left + box.width + 10;
    const cursorInsideY = my >= box.top - 10 && my <= box.top + box.height + 10;
    assert.strictEqual(cursorInsideX && cursorInsideY, false, `Tooltip box [${box.left},${box.top},${box.width}x${box.height}] must NEVER cover mouse cursor (${mx},${my}) on ${node.id}`);
  });
  console.log('[10] PASS: Tooltip collision avoidance verified (never covers mouse cursor or node icon).');

  // 11. Verify All 5 Microgrid Stations (edge 0..4) Pack Voltage Consistency, Sign Convention & No Dual-Writer Collision
  for (const st of ['0', '1', '2', '3', '4']) {
    engine.switchStation(st);
    await engine.pollLiveTelemetry();
    assert.strictEqual(engine.state.connHealthy, true, `Live poll for station ${st} must succeed`);
    const cellSumV = +(engine.state.telemetry.cellsV.reduce((a, b) => a + b, 0) / 1000.0).toFixed(1);
    assert.ok(
      Math.abs(engine.state.telemetry.voltage - cellSumV) <= 1.5,
      `Station ${st} pack voltage (${engine.state.telemetry.voltage}V) must match 160-cell sum (${cellSumV}V) within 1.5V`
    );
    assert.strictEqual(
      engine.state.telemetry.pcs.activePowerKw,
      engine.state.telemetry.powerKw,
      `Station ${st} PCS activePowerKw (${engine.state.telemetry.pcs.activePowerKw}) must equal cabinet powerKw (${engine.state.telemetry.powerKw})`
    );
    if (Math.abs(engine.state.telemetry.powerKw) >= 1.0) {
      assert.strictEqual(
        Math.sign(engine.state.telemetry.current),
        Math.sign(engine.state.telemetry.powerKw),
        `Station ${st} current (${engine.state.telemetry.current}A) sign must match powerKw (${engine.state.telemetry.powerKw}kW)`
      );
      const rc = engine.buildCellMicroTwin(engine.nodeById.get('cell-001'));
      if (engine.state.telemetry.powerKw > 0) {
        assert.ok(rc.vOcvMv > rc.vTermMv, `Station ${st} discharging: Vocv (${rc.vOcvMv}) must exceed Vterm (${rc.vTermMv})`);
      } else {
        assert.ok(rc.vOcvMv < rc.vTermMv, `Station ${st} charging: Vocv (${rc.vOcvMv}) must be below Vterm (${rc.vTermMv})`);
      }
    }
  }
  console.log('[11] PASS: All 5 stations (edge=0..4) pack voltage 160S sum, current sign convention, and PCS/cabinet synchronization verified.');

  // 12. Verify Peripheral System, Control, and Application Nodes Bind to Live InfluxDB Telemetry
  engine.switchStation('1');
  await engine.pollLiveTelemetry();
  const gridMetrics1 = engine.nodeById.get('sys-grid').metrics;
  const hvacMetrics1 = engine.nodeById.get('sys-load-hvac').metrics;
  const machMetrics1 = engine.nodeById.get('sys-load-machinery').metrics;
  const edgeMetrics1 = engine.nodeById.get('ctrl-edge').metrics;
  assert.ok(!gridMetrics1.endsWith('95kW'), `Station 1 sys-grid must reflect live power instead of static 95kW, got: ${gridMetrics1}`);
  assert.ok(!hvacMetrics1.includes('32.5'), `Station 1 sys-load-hvac must reflect live HVAC power, got: ${hvacMetrics1}`);
  assert.ok(!machMetrics1.includes('48.0'), `Station 1 sys-load-machinery must reflect live machinery power, got: ${machMetrics1}`);
  assert.ok(edgeMetrics1.includes('RPC '), `Station 1 ctrl-edge must reflect live RPC counter, got: ${edgeMetrics1}`);

  // Select sys-grid in drawer and verify 4 domain-specific metric cards render
  engine.selectNode(engine.nodeById.get('sys-grid'));
  assert.strictEqual(domElements.get('drawer-metrics').children.length, 4, 'sys-grid must render 4 grid metric cards in drawer');
  console.log('[12] PASS: Peripheral System, Control, and Application nodes dynamically bound to live InfluxDB channels.');

  // 13. Verify Power-Coupled Particle Flow Speed, Direction Reversal, and Standby Pause
  engine.state.particlePhase = 0.5;
  engine.state.telemetry.powerKw = 0.0;
  engine.state.telemetry.current = 0.0;
  engine.stepParticlePhase(1.0);
  assert.strictEqual(engine.state.particlePhase, 0.5, 'Particle phase must pause when powerKw=0 and current=0 (standby)');

  engine.state.telemetry.powerKw = 200.0;
  engine.state.telemetry.current = 380.0;
  const pAfterDis = engine.stepParticlePhase(1.0);
  assert.ok(pAfterDis > 0.5, `Discharging (+200kW) must advance particlePhase forward (>0.5), got ${pAfterDis}`);

  engine.state.particlePhase = 0.5;
  engine.state.telemetry.powerKw = -200.0;
  engine.state.telemetry.current = -380.0;
  const pAfterChg = engine.stepParticlePhase(1.0);
  assert.ok(pAfterChg < 0.5, `Charging (-200kW) must reverse particlePhase (<0.5), got ${pAfterChg}`);
  console.log('[13] PASS: Power-coupled particle flow speed, charge reversal, and standby pause verified.');

  console.log('=== ALL SMARTSCAPE ENGINE v3.0 TESTS PASSED (13/13) ===');
})().catch(err => {
  console.error('Live test failed:', err);
  process.exit(1);
});
