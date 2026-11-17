import assert from 'node:assert/strict';
import test from 'node:test';
import { runQuery, queryText, blankCondition, FIELD_BY_KEY } from './lens.js';

const rows = [
  { s: 'A', pe: 10, pb: 2, chg: 1.5 },
  { s: 'B', pe: 25, pb: 4, chg: -0.5 },
  { s: 'C', pb: 1, chg: 2 }, // no pe: must fail a pe condition, not be treated as 0
];

test('runQuery: AND across conditions, ignores unfilled rows, skips stocks missing the field', () => {
  assert.deepEqual(runQuery(rows, [blankCondition()]).map((r) => r.s), ['A', 'B', 'C']); // empty value -> no-op
  assert.deepEqual(runQuery(rows, [{ field: 'pe', op: '<', value: '15' }]).map((r) => r.s), ['A']);
  assert.deepEqual(runQuery(rows, [{ field: 'pb', op: '<', value: '3' }, { field: 'chg', op: '>', value: '0' }]).map((r) => r.s), ['A', 'C']);
});

test('queryText renders the field label, operator and value joined by AND', () => {
  assert.equal(queryText([{ field: 'pe', op: '<', value: '15' }, { field: 'pb', op: '<', value: '3' }]), `${FIELD_BY_KEY.pe.label} < 15 AND ${FIELD_BY_KEY.pb.label} < 3`);
  assert.equal(queryText([blankCondition()]), '');
});

test('every preset uses known fields and operators, and sits in a known tab', async () => {
  const { PRESETS, PRESET_GROUPS, OPS } = await import('./lens.js');
  for (const p of PRESETS) {
    assert.ok(PRESET_GROUPS.includes(p.group), `${p.name}: group`);
    for (const c of p.conditions) {
      assert.ok(FIELD_BY_KEY[c.field], `${p.name}: field ${c.field}`);
      assert.ok(OPS[c.op], `${p.name}: op ${c.op}`);
      assert.ok(Number.isFinite(Number(c.value)), `${p.name}: value ${c.value}`);
    }
  }
});

test('derived fields: cross, all-time high distance, volume in lakhs', () => {
  const r = { ltp: 99, ema50: 110, ema200: 100, ath: 100, volume: 2_500_000 };
  assert.equal(Math.round(FIELD_BY_KEY.cross.get(r)), 10);
  assert.equal(Math.round(FIELD_BY_KEY.distAth.get(r)), -1);
  assert.equal(FIELD_BY_KEY.volLakh.get(r), 25);
  assert.equal(FIELD_BY_KEY.distAtl.get(r), null, 'missing all-time low is null, not 0');
});
