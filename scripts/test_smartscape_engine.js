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
const engine = require('/opt/openems/smartscape/smartscape.js');

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
  engine.state.telemetry.cellsV[i] = 3300;
  engine.state.telemetry.cellsT[i] = 24.0;
}
// Put max cell at #77 (in Mod #05) and min cell at #42 (in Mod #03)
engine.state.telemetry.cellsV[76] = 3330; // Cell #77 (Mod #05)
engine.state.telemetry.cellsV[41] = 3285; // Cell #42 (Mod #03)
engine.state.telemetry.cellsT[119] = 27.2; // Cell #120 (Mod #08)
engine.computeRollUpAggregations();

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
console.log('[5] PASS: L3<->L4 state preservation & PowerFlow mode filtering verified.');

console.log('=== ALL SMARTSCAPE ENGINE v3.0 TESTS PASSED ===');
