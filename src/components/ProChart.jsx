import React, { useEffect, useRef, useState } from 'react';
import { CandleChart } from './Charts.jsx';

// TradingView Lightweight Charts (open source, Apache-2.0): zoom, pan, crosshair.
// Loaded only when a popup opens. If it cannot load, the simple SVG chart is shown instead.
// The chart is built once; new candles update the series and new levels only move the price lines,
// so live ticks never reset the zoom.
// bars: [t, o, h, l, c, v, vwap]; levels: [{ label, value, color }]
const IST = 19800;
const ema = (vals, n) => {
  const a = 2 / (n + 1);
  let p = null;
  return vals.map((v) => (p = p === null ? v : a * v + (1 - a) * p));
};
const css = (name, fallback) => {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
};
const colorOf = (c, fallback) => (/^var\((--[\w-]+)\)$/.test(c || '') ? css(c.slice(4, -1), fallback) : c || fallback);

export default function ProChart({ bars, levels = [], cpr, height = 300 }) {
  const box = useRef(null);
  const api = useRef(null); // { chart, candles, vwap, e9, e15, lib, lines: [] }
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // build once
  useEffect(() => {
    let off = false;
    import('lightweight-charts')
      .then((lib) => {
        if (off || !box.current) return;
        const text = css('--muted', '#8a94a6');
        const line = css('--line', '#26324a');
        const up = css('--up', '#22c55e');
        const down = css('--down', '#ef4444');
        const chart = lib.createChart(box.current, {
          autoSize: true,
          height,
          layout: { background: { color: 'transparent' }, textColor: text, fontSize: 11 },
          grid: { vertLines: { color: line }, horzLines: { color: line } },
          rightPriceScale: { borderColor: line },
          timeScale: { borderColor: line, timeVisible: true, secondsVisible: false },
          crosshair: { mode: lib.CrosshairMode.Normal },
          localization: { timeFormatter: (t) => new Date(t * 1000).toISOString().slice(11, 16) },
        });
        api.current = {
          chart,
          lib,
          lines: [],
          candles: chart.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down }),
          vwap: chart.addLineSeries({ color: css('--accent', '#4f8cff'), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'VWAP' }),
          e9: chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA 9' }),
          e15: chart.addLineSeries({ color: '#a855f7', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA 15' }),
          fitted: false,
        };
        setReady(true);
      })
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
      if (api.current) api.current.chart.remove();
      api.current = null;
    };
  }, [height]);

  // candles: update the data in place
  useEffect(() => {
    const a = api.current;
    if (!ready || !a || !bars || bars.length < 2) return;
    a.candles.setData(bars.map((b) => ({ time: b[0] + IST, open: b[1], high: b[2], low: b[3], close: b[4] })));
    a.vwap.setData(bars.map((b) => ({ time: b[0] + IST, value: b[6] })));
    const closes = bars.map((b) => b[4]);
    const e9 = ema(closes, 9);
    const e15 = ema(closes, 15);
    a.e9.setData(bars.map((b, i) => ({ time: b[0] + IST, value: e9[i] })));
    a.e15.setData(bars.map((b, i) => ({ time: b[0] + IST, value: e15[i] })));
    if (!a.fitted) {
      a.chart.timeScale().fitContent();
      a.fitted = true;
    }
  }, [ready, bars]);

  // reference lines: replace only the price lines
  useEffect(() => {
    const a = api.current;
    if (!ready || !a || !bars || bars.length < 2) return;
    for (const l of a.lines) a.candles.removePriceLine(l);
    a.lines = [];
    const lo = Math.min(...bars.map((b) => b[3]));
    const hi = Math.max(...bars.map((b) => b[2]));
    const near = (v) => typeof v === 'number' && Number.isFinite(v) && v > lo - (hi - lo) && v < hi + (hi - lo);
    const text = css('--muted', '#8a94a6');
    for (const l of levels) {
      if (near(l.value)) a.lines.push(a.candles.createPriceLine({ price: l.value, color: colorOf(l.color, text), lineWidth: 1, lineStyle: a.lib.LineStyle.Dashed, axisLabelVisible: true, title: l.label }));
    }
    if (cpr && near(cpr.bc) && near(cpr.tc)) {
      a.lines.push(a.candles.createPriceLine({ price: cpr.tc, color: '#f59e0b', lineWidth: 1, lineStyle: a.lib.LineStyle.Dotted, axisLabelVisible: false, title: 'CPR' }));
      a.lines.push(a.candles.createPriceLine({ price: cpr.bc, color: '#f59e0b', lineWidth: 1, lineStyle: a.lib.LineStyle.Dotted, axisLabelVisible: false, title: '' }));
    }
  }, [ready, bars, levels, cpr]);

  if (failed) return <CandleChart bars={bars} levels={levels} cpr={cpr} />;
  return <div ref={box} className="pro-chart" style={{ height }} aria-label="Today's 5-minute candles with VWAP and EMA 9 / 15" />;
}
