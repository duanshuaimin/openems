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
assert.strictEqual(engine.nodes.length, 197, 'Expected 197 total nodes');
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
  console.log('[7] PASS: Live InfluxDB HTTP polling verified across stations bms (#14/#3), edge1 (#43/#22), edge2 (#72/#41).');

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

  console.log('=== ALL SMARTSCAPE ENGINE v3.0 TESTS PASSED ===');
})().catch(err => {
  console.error('Live test failed:', err);
  process.exit(1);
});
