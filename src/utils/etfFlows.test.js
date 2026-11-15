import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEtfDateToUtc,
  aggregateWeeklyEtfFlows,
  buildEtfFlowBarData,
  formatEtfFlowM,
} from './etfFlows.js';

test('parseEtfDateToUtc handles DD/MM/YY, DD/MM, YYYY-MM-DD and rejects invalid dates', () => {
  const d1 = parseEtfDateToUtc('18/06/26');
  assert.equal(d1.toISOString().slice(0, 10), '2026-06-18');

  const d2 = parseEtfDateToUtc('05/01', 26);
  assert.equal(d2.toISOString().slice(0, 10), '2026-01-05');

  const d3 = parseEtfDateToUtc('2026-06-15');
  assert.equal(d3.toISOString().slice(0, 10), '2026-06-15');

  assert.equal(parseEtfDateToUtc('31/02/26'), null);
  assert.equal(parseEtfDateToUtc(''), null);
  assert.equal(parseEtfDateToUtc(null), null);
});

test('aggregateWeeklyEtfFlows groups daily flows into Monday-start weeks and sums flows', () => {
  const sample = [
    // Week of Mon 08/06/26
    { date: '08/06/26', flow: -91.4 },
    { date: '09/06/26', flow: -77.4 },
    { date: '10/06/26', flow: -213.9 },
    { date: '11/06/26', flow: -22.5 },
    { date: '12/06/26', flow: 85.9 },
    // Week of Mon 15/06/26 (partial 4-day week)
    { date: '15/06/26', flow: -64.8 },
    { date: '16/06/26', flow: 10.2 },
    { date: '17/06/26', flow: -82.2 },
    { date: '18/06/26', flow: -90.7 },
  ];

  const weekly = aggregateWeeklyEtfFlows(sample);
  assert.equal(weekly.length, 2);

  assert.deepEqual(weekly[0], {
    weekStartDate: '08/06/26',
    label: '08/06',
    firstDate: '08/06/26',
    lastDate: '12/06/26',
    flow: -319.3,
    sessions: 5,
  });

  assert.deepEqual(weekly[1], {
    weekStartDate: '15/06/26',
    label: '15/06',
    firstDate: '15/06/26',
    lastDate: '18/06/26',
    flow: -227.5,
    sessions: 4,
  });
});

test('aggregateWeeklyEtfFlows handles year boundary weeks cleanly', () => {
  const sample = [
    { date: '30/12/24', flow: -415.1 }, // Mon
    { date: '31/12/24', flow: 5.3 },    // Tue
    { date: '02/01/25', flow: -242.3 }, // Thu
    { date: '03/01/25', flow: 908.1 },  // Fri
  ];

  const weekly = aggregateWeeklyEtfFlows(sample);
  assert.equal(weekly.length, 1);
  assert.equal(weekly[0].weekStartDate, '30/12/24');
  assert.equal(weekly[0].firstDate, '30/12/24');
  assert.equal(weekly[0].lastDate, '03/01/25');
  assert.equal(weekly[0].sessions, 4);
  assert.equal(weekly[0].flow, 256);
});

test('buildEtfFlowBarData colors positive and negative flows correctly', () => {
  const data = buildEtfFlowBarData(
    [
      { label: '08/06', flow: -319.3 },
      { label: '15/06', flow: 120.5 },
    ],
    'dark',
    { labelKey: 'label' }
  );

  assert.deepEqual(data.labels, ['08/06', '15/06']);
  assert.deepEqual(data.datasets[0].data, [-319.3, 120.5]);
  assert.deepEqual(data.datasets[0].backgroundColor, ['#f43f5e', '#10b981']);
});

test('formatEtfFlowM formats values < 1000M as M and >= 1000M as B', () => {
  assert.equal(formatEtfFlowM(0), '+0M');
  assert.equal(formatEtfFlowM(500), '+500M');
  assert.equal(formatEtfFlowM(-185.4), '-185.4M');
  assert.equal(formatEtfFlowM(1000), '+1B');
  assert.equal(formatEtfFlowM(-1065.3), '-1.07B');
  assert.equal(formatEtfFlowM(-1500), '-1.5B');
  assert.equal(formatEtfFlowM(1240), '+1.24B');
  assert.equal(formatEtfFlowM(null), '---');
});
