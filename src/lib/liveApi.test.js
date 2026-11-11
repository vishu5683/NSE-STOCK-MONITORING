import assert from 'node:assert/strict';
import test from 'node:test';
import { marketOpenNow, pollMs } from './liveApi.js';

// 2026-11-10 is a Tuesday. IST = UTC + 5:30.
const ist = (h, m, day = '2026-11-10') => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+05:30`);

test('market is open on a weekday between 09:15 and 15:30 IST', () => {
  assert.equal(marketOpenNow(ist(10, 0)), true);
  assert.equal(marketOpenNow(ist(15, 30)), true);
  assert.equal(pollMs(ist(11, 0)), 5000);
});

test('market is closed early morning, evening and on weekends', () => {
  assert.equal(marketOpenNow(ist(8, 0)), false);
  assert.equal(marketOpenNow(ist(18, 0)), false);
  assert.equal(marketOpenNow(ist(11, 0, '2026-11-14')), false); // Saturday
  assert.equal(pollMs(ist(18, 0)), 60000);
});

import { marketPhaseNow } from './liveApi.js';

test('market phase follows the IST clock and the last live tick', () => {
  const at = (iso) => new Date(iso);
  assert.equal(marketPhaseNow(at('2026-11-14T06:00:00Z')).label, 'MARKET CLOSED (weekend)'); // Saturday
  assert.equal(marketPhaseNow(at('2026-11-11T03:00:00Z')).label, 'MARKET CLOSED (opens 09:15)'); // 08:30 IST
  assert.equal(marketPhaseNow(at('2026-11-11T03:35:00Z')).label, 'PRE-OPEN'); // 09:05
  assert.equal(marketPhaseNow(at('2026-11-11T06:00:00Z'), '2026-11-11T05:59:50Z').open, true); // 11:30, fresh tick
  assert.equal(marketPhaseNow(at('2026-11-11T06:00:00Z'), '2026-11-10T09:59:00Z').label, 'NO LIVE TICKS (exchange holiday?)');
  assert.equal(marketPhaseNow(at('2026-11-11T10:05:00Z')).label, 'MARKET CLOSED'); // 15:35
});
