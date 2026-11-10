import { price, pct, dec, mult } from './fmt.js';
import { weeklyLabel, monthlyLabel, convictionLabel, breakoutLabel } from './signals.js';

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const stamp = (meta) => (meta?.lastTradingDate || new Date().toISOString().slice(0, 10)).replaceAll('-', '');
const slug = (s) => (s || 'report').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

// ---------- Excel ----------
const NAVY = '#12305a';
const GRID = '#d5deec';
const ZEBRA = '#f4f7fc';
const HEAD = { fontWeight: 'bold', backgroundColor: NAVY, textColor: '#ffffff', align: 'center', alignVertical: 'center', wrap: true, height: 30, borderColor: '#0b1f3d' };
const head = (labels) => labels.map((value) => ({ value, ...HEAD }));
const text = (value, extra) => ({ value: value ?? '', ...extra });
const n = (value, format, extra) => (Number.isFinite(value) ? { value, type: Number, ...(format ? { format } : {}), ...extra } : { value: '' });
const sideCell = (r) =>
  r.side === 'BULL'
    ? { value: 'BULLISH', textColor: '#166534', backgroundColor: '#dcfce7', fontWeight: 'bold', align: 'center' }
    : r.side === 'BEAR'
      ? { value: 'BEARISH', textColor: '#991b1b', backgroundColor: '#fee2e2', fontWeight: 'bold', align: 'center' }
      : { value: '-', align: 'center', textColor: '#64748b' };
const changeCell = (v) =>
  Number.isFinite(v)
    ? { value: v, type: Number, format: '+0.00;-0.00;0.00', fontWeight: 'bold', textColor: v > 0 ? '#15803d' : v < 0 ? '#b91c1c' : '#475569' }
    : { value: '' };
const scoreCell = (v) => {
  if (!Number.isFinite(v)) return { value: '' };
  const fill = v >= 75 ? '#bbf7d0' : v >= 60 ? '#dbeafe' : null;
  return { value: v, type: Number, format: '0', align: 'center', fontWeight: 'bold', ...(fill ? { backgroundColor: fill } : {}) };
};
const rsiCell = (v) => n(v, '0.0', v >= 70 ? { textColor: '#b45309', fontWeight: 'bold' } : v <= 30 ? { textColor: '#7c3aed', fontWeight: 'bold' } : undefined);
// grid lines + zebra rows, without overriding a cell's own fill
const styleRow = (cells, i) => cells.map((cell) => ({ borderColor: GRID, ...(i % 2 === 1 && !cell.backgroundColor ? { backgroundColor: ZEBRA } : {}), ...cell }));
const band = (value, span, extra) => [{ value, columnSpan: span, backgroundColor: NAVY, textColor: '#ffffff', fontWeight: 'bold', alignVertical: 'center', ...extra }, ...Array(span - 1).fill(null)];

export async function exportExcel({ rows, indices, sectors, breadth, meta, settings }) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const c = settings.screener;

  const stockHead = [
    'Rank', 'Symbol', 'Sector', 'LTP', '1D %', '1W %', '1M %', 'Signal', 'Setup', 'Score', 'Conviction', 'Entry', 'Stop loss', 'Target 1', 'Target 2',
    'Open', 'High', 'Low', 'Prev close', 'Volume', 'Value (Cr)', 'Lot size', 'Vol spike (x)', 'RSI 14', 'ADX 14', 'ATR 14', 'EMA 20', 'EMA 50', 'EMA 200', 'MACD', 'MACD signal',
    '52W high', '52W low', 'From 52W high %', 'From 52W low %', 'Trend',
  ];
  const stockRow = (r, i) =>
    styleRow(
      [
        n(i + 1, '0', { align: 'center', textColor: '#64748b' }), { value: r.s, fontWeight: 'bold' }, text(r.sec), n(r.ltp, '#,##0.00', { fontWeight: 'bold' }), changeCell(r.chg), changeCell(r.chg1w), changeCell(r.chg1m),
        sideCell(r), text(r.setup || ''), scoreCell(r.score), text(convictionLabel(r.score, r.side), { align: 'center', fontWeight: 'bold' }),
        n(r.plan?.entry, '#,##0.00'), n(r.plan?.stop, '#,##0.00', { textColor: '#b91c1c' }), n(r.plan?.t1, '#,##0.00', { textColor: '#15803d' }), n(r.plan?.t2, '#,##0.00', { textColor: '#15803d' }),
        n(r.open, '#,##0.00'), n(r.high, '#,##0.00'), n(r.low, '#,##0.00'), n(r.prevClose, '#,##0.00'),
        n(r.volume, '#,##0'), n(r.valueCr, '#,##0.00'), n(r.lot, '#,##0'), n(r.volSpike, '0.00', r.volOk ? { fontWeight: 'bold', textColor: '#1d4ed8' } : undefined), rsiCell(r.rsi), n(r.adx, '0.0'), n(r.atr, '0.00'),
        n(r.ema20, '#,##0.00'), n(r.ema50, '#,##0.00'), n(r.ema200, '#,##0.00'), n(r.macd, '0.000'), n(r.macdSig, '0.000'),
        n(r.hi52, '#,##0.00'), n(r.lo52, '#,##0.00'), n(r.distHi, '0.00'), n(r.distLo, '0.00'), text(r.trend),
      ],
      i,
    );
  const stockCols = [
    { width: 6 }, { width: 15 }, { width: 24 }, { width: 12 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 11 }, { width: 21 }, { width: 8 }, { width: 12 },
    { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 },
    { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 },
    { width: 14 }, { width: 11 }, { width: 10 }, { width: 10 }, { width: 8 }, { width: 8 }, { width: 9 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 10 }, { width: 10 },
    { width: 11 }, { width: 11 }, { width: 12 }, { width: 12 }, { width: 12 },
  ];
  const stockSheet = (name, list) => ({
    sheet: name,
    data: [head(stockHead), ...(list.length ? list.map(stockRow) : [[text('No stocks match the current settings.')]])],
    columns: stockCols,
    stickyRowsCount: 1,
    stickyColumnsCount: 2,
  });

  const bull = rows.filter((r) => r.side === 'BULL').sort((x, y) => y.score - x.score);
  const bear = rows.filter((r) => r.side === 'BEAR').sort((x, y) => y.score - x.score);
  const kv = (label, cell, i) => styleRow([text(label, { fontWeight: 'bold' }), cell], i);
  const topRows = (list) =>
    list.slice(0, 5).map((r, i) =>
      styleRow([{ value: r.s, fontWeight: 'bold' }, n(r.ltp, '#,##0.00'), changeCell(r.chg), scoreCell(r.score), n(r.plan?.entry, '#,##0.00'), n(r.plan?.stop, '#,##0.00'), n(r.plan?.t1, '#,##0.00')], i),
    );
  const note = (value, height) => [{ value, columnSpan: 7, textColor: '#475569', wrap: true, alignVertical: 'top', ...(height ? { height } : {}) }, null, null, null, null, null, null];

  const summary = [
    band(`${settings.clientName}  |  Market report`, 7, { fontSize: 18, height: 40 }),
    band(`Data as of ${meta.lastTradingDate}   |   Generated ${meta.generatedAtIST}   |   ${meta.marketPhase}`, 7, { fontWeight: undefined, backgroundColor: '#1d4477', height: 22 }),
    [],
    head(['Market breadth', 'Value']),
    kv('Stocks tracked', n(breadth.total), 0),
    kv('Advancers', n(breadth.adv, '0', { textColor: '#15803d', fontWeight: 'bold' }), 1),
    kv('Decliners', n(breadth.dec, '0', { textColor: '#b91c1c', fontWeight: 'bold' }), 0),
    kv('Above 50-day EMA (%)', n(breadth.above50Pct, '0.0'), 1),
    kv('Above 200-day EMA (%)', n(breadth.above200Pct, '0.0'), 0),
    kv('Average RSI', n(breadth.avgRsi, '0.0'), 1),
    kv('Bullish setups', n(breadth.bull, '0', { backgroundColor: '#dcfce7', fontWeight: 'bold' }), 0),
    kv('Bearish setups', n(breadth.bear, '0', { backgroundColor: '#fee2e2', fontWeight: 'bold' }), 1),
    [],
    head(['Index', 'Level', '1D %', '1W %', '1M %', 'RSI 14', 'Trend']),
    ...indices.map((x, i) => styleRow([{ value: x.name, fontWeight: 'bold' }, n(x.ltp, '#,##0.00'), changeCell(x.chg), changeCell(x.chg1w), changeCell(x.chg1m), rsiCell(x.rsi), text(x.trend)], i)),
    [],
    head(['Top 5 bullish', 'LTP', '1D %', 'Score', 'Entry', 'Stop loss', 'Target 1']),
    ...topRows(bull),
    [],
    head(['Top 5 bearish', 'LTP', '1D %', 'Score', 'Entry', 'Stop loss', 'Target 1']),
    ...topRows(bear),
    [],
    note(`Source: ${meta.source}`),
    note(settings.disclaimer, 46),
  ];

  const sectorSheet = [
    head(['Sector', 'Stocks', 'Advancers', '1D % (avg)', '1W % (avg)', '1M % (avg)', 'Bullish setups', 'Bearish setups']),
    ...sectors.map((s, i) =>
      styleRow(
        [
          { value: s.sector, fontWeight: 'bold' }, n(s.count), n(s.adv), changeCell(s.chg), changeCell(s.chg1w), changeCell(s.chg1m),
          n(s.bull, '0', s.bull ? { textColor: '#15803d', fontWeight: 'bold' } : undefined), n(s.bear, '0', s.bear ? { textColor: '#b91c1c', fontWeight: 'bold' } : undefined),
        ],
        i,
      ),
    ),
  ];

  const settingsSheet = [
    head(['Setting', 'Value']),
    ...[
      ['Minimum score', n(c.minScore)], ['Volume spike (x)', n(c.volSpike)], ['Bull RSI >=', n(c.bullRsi)], ['Bear RSI <=', n(c.bearRsi)], ['ADX >=', n(c.adx)],
      ['Stop loss = ATR x', n(c.atrMult)], ['Target 1 = risk x', n(c.rr1)], ['Target 2 = risk x', n(c.rr2)], ['Volume required', text(c.requireVolume ? 'Yes' : 'No')],
    ].map(([k, v], i) => kv(k, v, i)),
  ];

  const momentum = [
    head(['Symbol', 'Sector', 'LTP', 'Today %', 'Weekly %', 'Weekly status', 'Monthly %', 'Monthly status', 'Vol spike (x)', 'Breakout status', 'Signal']),
    ...[...rows].sort((x, y) => (y.chg1m ?? -999) - (x.chg1m ?? -999)).map((r, i) =>
      styleRow(
        [
          { value: r.s, fontWeight: 'bold' }, text(r.sec), n(r.ltp, '#,##0.00'), changeCell(r.chg), changeCell(r.chg1w), text(weeklyLabel(r.chg1w), { align: 'center' }),
          changeCell(r.chg1m), text(monthlyLabel(r.chg1m), { align: 'center' }), n(r.volSpike, '0.00'), text(breakoutLabel(r), { align: 'center', fontWeight: 'bold' }), sideCell(r),
        ],
        i,
      ),
    ),
  ];
  const breakoutRows = [...rows].filter((r) => breakoutLabel(r)).sort((x, y) => (y.distHi ?? -999) - (x.distHi ?? -999));
  const breakouts = [
    head(['Symbol', 'Sector', 'LTP', 'Today %', '52W high', 'From 52W high %', '52W low', 'From 52W low %', 'Vol spike (x)', 'Status', 'Signal']),
    ...(breakoutRows.length
      ? breakoutRows.map((r, i) =>
          styleRow(
            [
              { value: r.s, fontWeight: 'bold' }, text(r.sec), n(r.ltp, '#,##0.00'), changeCell(r.chg), n(r.hi52, '#,##0.00'), n(r.distHi, '0.00'), n(r.lo52, '#,##0.00'), n(r.distLo, '0.00'),
              n(r.volSpike, '0.00'), text(breakoutLabel(r), { align: 'center', fontWeight: 'bold' }), sideCell(r),
            ],
            i,
          ),
        )
      : [[text('No stock is within 2% of its 52-week high or low.')]]),
  ];

  const guide = [
    head(['Column', 'What it means']),
    ...[
      ['Signal', 'BULLISH or BEARISH when the stock meets every rule in the Settings sheet. Otherwise "-".'],
      ['Setup', 'BREAKOUT/BREAKDOWN + VOLUME = at the 52-week extreme with a volume spike. TREND + MOMENTUM = trend rules met away from the extreme.'],
      ['Score', '0 to 100. EMA trend 25, RSI zone 20, ADX strength 20, volume 15, near 52-week extreme 10, MACD 10. Green = 75+, blue = 60+.'],
      ['Entry / Stop loss / Targets', 'Mechanical levels. Stop = ATR x multiplier from entry. Target 1 and 2 = risk x the multipliers in Settings.'],
      ['Rank / Conviction', 'Rank is the position by score inside the sheet. Conviction: score 85+ VERY HIGH, 70+ HIGH, otherwise MEDIUM.'],
      ['Open / High / Low / Prev close / Value (Cr)', 'Last session prices. Value = last price x volume, in crores (approximate turnover).'],
      ['Lot size', 'Copied from the client sheet of 8-Nov-2026. NSE revises lot sizes, verify before trading.'],
      ['Weekly / Monthly status', 'Labels on the 1-week and 1-month return: RALLY, TREND, MILD, DROP, MEGATREND, ACCUMULATION, DISTRIBUTION, DRAWDOWN.'],
      ['Breakout status', '52W BREAKOUT = within 0.5% of the 52-week high or above it. NEAR = within 2%. Same idea for BREAKDOWN at the low.'],
      ['Vol spike (x)', 'Last completed session volume divided by the 20-day average. Blue = at or above the threshold.'],
      ['RSI 14', 'Momentum, 0 to 100. Orange = 70 or more (stretched up). Purple = 30 or less (stretched down).'],
      ['ADX 14', 'Trend strength. Higher means a stronger trend, in either direction.'],
      ['EMA 20 / 50 / 200', 'Exponential moving averages of the daily close.'],
      ['From 52W high / low %', 'Distance of the last price from the 52-week high and low.'],
      ['Data', `${meta.source}. Daily candles. Data date ${meta.lastTradingDate}.`],
      ['Important', 'Rule-based research output. Not investment advice. Verify prices with your broker before trading.'],
    ].map(([k, v], i) => styleRow([text(k, { fontWeight: 'bold', alignVertical: 'top' }), text(v, { wrap: true, alignVertical: 'top' })], i)),
  ];

  const blob = await writeXlsxFile([
    { sheet: 'Summary', data: summary, columns: [{ width: 28 }, { width: 14 }, { width: 11 }, { width: 11 }, { width: 12 }, { width: 12 }, { width: 14 }] },
    stockSheet('Bullish setups', bull),
    stockSheet('Bearish setups', bear),
    { sheet: 'Momentum', data: momentum, columns: [{ width: 15 }, { width: 24 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 18 }, { width: 10 }, { width: 18 }, { width: 11 }, { width: 18 }, { width: 11 }], stickyRowsCount: 1, stickyColumnsCount: 1 },
    { sheet: 'Breakouts', data: breakouts, columns: [{ width: 15 }, { width: 24 }, { width: 12 }, { width: 10 }, { width: 11 }, { width: 14 }, { width: 11 }, { width: 14 }, { width: 11 }, { width: 18 }, { width: 11 }], stickyRowsCount: 1 },
    { sheet: 'Sectors', data: sectorSheet, columns: [{ width: 28 }, { width: 9 }, { width: 11 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 }], stickyRowsCount: 1 },
    stockSheet('All stocks', [...rows].sort((x, y) => x.s.localeCompare(y.s))),
    { sheet: 'Settings', data: settingsSheet, columns: [{ width: 26 }, { width: 12 }] },
    { sheet: 'Guide', data: guide, columns: [{ width: 28 }, { width: 110 }] },
  ]).toBlob();

  download(blob, `${slug(settings.clientName)}-market-report-${stamp(meta)}.xlsx`);
}

// ---------- CSV ----------
export function exportCsv({ rows, meta, settings }) {
  const cols = [
    ['Symbol', (r) => r.s], ['Sector', (r) => r.sec], ['LTP', (r) => r.ltp], ['1D %', (r) => r.chg], ['1W %', (r) => r.chg1w], ['1M %', (r) => r.chg1m],
    ['Vol spike', (r) => r.volSpike], ['RSI', (r) => r.rsi], ['ADX', (r) => r.adx], ['Trend', (r) => r.trend],
    ['Signal', (r) => r.side || ''], ['Setup', (r) => r.setup || ''], ['Score', (r) => r.score],
    ['Entry', (r) => r.plan?.entry], ['Stop loss', (r) => r.plan?.stop], ['Target 1', (r) => r.plan?.t1], ['Target 2', (r) => r.plan?.t2],
  ];
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [cols.map((c) => c[0]).join(','), ...rows.map((r) => cols.map((c) => esc(c[1](r))).join(','))];
  download(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), `${slug(settings.clientName)}-stocks-${stamp(meta)}.csv`);
}

// ---------- PDF ----------
const hexToRgb = (hex) => {
  const m = /^#?([a-f0-9]{6})$/i.exec(hex || '');
  if (!m) return [79, 140, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

export async function exportPdf({ rows, indices, sectors, breadth, meta, settings }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const accent = hexToRgb(settings.accent);
  const navy = [11, 18, 32];

  // header band
  doc.setFillColor(...navy);
  doc.rect(0, 0, W, 64, 'F');
  doc.setFillColor(...accent);
  doc.rect(0, 64, W, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(settings.clientName, 36, 34);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Market report | Data as of ${meta.lastTradingDate} | Generated ${meta.generatedAtIST}`, 36, 52);

  let y = 90;
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Indices', 36, y);

  const red = [185, 28, 28];
  const green = [21, 128, 61];
  const colorChange = (data, idxs) => {
    if (data.section !== 'body' || !idxs.includes(data.column.index)) return;
    const raw = String(data.cell.raw);
    if (raw.startsWith('+')) data.cell.styles.textColor = green;
    else if (raw.startsWith('-') && raw !== '-') data.cell.styles.textColor = red;
  };

  autoTable(doc, {
    startY: y + 8,
    head: [['Index', 'Level', '1D %', '1W %', '1M %', 'RSI 14', 'Trend']],
    body: indices.map((i) => [i.name, price(i.ltp), pct(i.chg), pct(i.chg1w), pct(i.chg1m), dec(i.rsi), i.trend]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: accent, textColor: 255 },
    didParseCell: (d) => colorChange(d, [2, 3, 4]),
    margin: { left: 36, right: 36 },
  });

  y = doc.lastAutoTable.finalY + 18;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Market breadth', 36, y);
  autoTable(doc, {
    startY: y + 8,
    head: [['Stocks', 'Advancers', 'Decliners', 'Above 50 EMA', 'Above 200 EMA', 'Avg RSI', 'Bullish setups', 'Bearish setups']],
    body: [[breadth.total, breadth.adv, breadth.dec, `${dec(breadth.above50Pct, 0)}%`, `${dec(breadth.above200Pct, 0)}%`, dec(breadth.avgRsi), breadth.bull, breadth.bear]],
    styles: { fontSize: 9, cellPadding: 4, halign: 'center' },
    headStyles: { fillColor: accent, textColor: 255 },
    margin: { left: 36, right: 36 },
  });

  const setupTable = (title, list, fill) => {
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(30, 41, 59);
    doc.text(title, 36, 44);
    autoTable(doc, {
      startY: 54,
      head: [['#', 'Symbol', 'Sector', 'LTP', '1D %', 'Vol x', 'RSI', 'ADX', 'Setup', 'Score', 'Entry', 'Stop loss', 'Target 1', 'Target 2']],
      body: list.slice(0, 25).map((r, i) => [
        i + 1, r.s, r.sec, price(r.ltp), pct(r.chg), mult(r.volSpike), dec(r.rsi), dec(r.adx, 0), r.setup || '', r.score,
        price(r.plan?.entry), price(r.plan?.stop), price(r.plan?.t1), price(r.plan?.t2),
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: fill, textColor: 255 },
      didParseCell: (d) => colorChange(d, [4]),
      margin: { left: 36, right: 36 },
    });
    if (!list.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text('No stocks match the current settings.', 36, 80);
    }
  };
  setupTable('Top bullish setups', rows.filter((r) => r.side === 'BULL').sort((a, b) => b.score - a.score), green);
  setupTable('Top bearish setups', rows.filter((r) => r.side === 'BEAR').sort((a, b) => b.score - a.score), red);

  doc.addPage();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(30, 41, 59);
  doc.text('Sector performance', 36, 44);
  autoTable(doc, {
    startY: 54,
    head: [['Sector', 'Stocks', 'Advancers', '1D % avg', '1W % avg', '1M % avg', 'Bullish', 'Bearish']],
    body: sectors.map((s) => [s.sector, s.count, s.adv, pct(s.chg), pct(s.chg1w), pct(s.chg1m), s.bull, s.bear]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: accent, textColor: 255 },
    didParseCell: (d) => colorChange(d, [3, 4, 5]),
    margin: { left: 36, right: 36 },
  });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    const lines = doc.splitTextToSize(`${settings.disclaimer} Source: ${meta.source}.`, W - 140);
    doc.text(lines, 36, H - 26);
    doc.text(`Page ${p} of ${pages}`, W - 36, H - 16, { align: 'right' });
  }

  doc.save(`${slug(settings.clientName)}-market-report-${stamp(meta)}.pdf`);
}

