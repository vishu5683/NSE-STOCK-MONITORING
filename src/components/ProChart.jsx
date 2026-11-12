import React, { useEffect, useRef, useState } from 'react';
import { CandleChart } from './Charts.jsx';

// TradingView Lightweight Charts (open source, Apache-2.0): zoom, pan, crosshair.
// Loaded only when a popup opens. If it cannot load, the simple SVG chart is shown instead.
// bars: [t, o, h, l, c, v, vwap]; levels: [{ label, value, color }]
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

export default function ProChart({ bars, levels = [], cpr, height = 300 }) {
  const box = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!bars || bars.length < 2 || !box.current) return undefined;
    let chart = null;
    let off = false;
    import('lightweight-charts')
      .then(({ createChart, CrosshairMode, LineStyle }) => {
        if (off || !box.current) return;
        const text = css('--muted', '#8a94a6');
        const line = css('--line', '#26324a');
        const up = css('--up', '#22c55e');
        const down = css('--down', '#ef4444');
        const accent = css('--accent', '#4f8cff');
        chart = createChart(box.current, {
          autoSize: true,
          height,
          layout: { background: { color: 'transparent' }, textColor: text, fontSize: 11 },
          grid: { vertLines: { color: line }, horzLines: { color: line } },
          rightPriceScale: { borderColor: line },
          timeScale: { borderColor: line, timeVisible: true, secondsVisible: false },
          crosshair: { mode: CrosshairMode.Normal },
          localization: { timeFormatter: (t) => new Date((t + 19800) * 1000).toISOString().slice(11, 16) },
        });
        const shift = (t) => t + 19800; // show IST on the axis
        const candles = chart.addCandlestickSeries({ upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
        candles.setData(bars.map((b) => ({ time: shift(b[0]), open: b[1], high: b[2], low: b[3], close: b[4] })));
        const vwap = chart.addLineSeries({ color: accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'VWAP' });
        vwap.setData(bars.map((b) => ({ time: shift(b[0]), value: b[6] })));
        const closes = bars.map((b) => b[4]);
        const e9 = ema(closes, 9);
        const e15 = ema(closes, 15);
        const l9 = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA 9' });
        const l15 = chart.addLineSeries({ color: '#a855f7', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'EMA 15' });
        l9.setData(bars.map((b, i) => ({ time: shift(b[0]), value: e9[i] })));
        l15.setData(bars.map((b, i) => ({ time: shift(b[0]), value: e15[i] })));
        const lo = Math.min(...bars.map((b) => b[3]));
        const hi = Math.max(...bars.map((b) => b[2]));
        const near = (v) => typeof v === 'number' && Number.isFinite(v) && v > lo - (hi - lo) && v < hi + (hi - lo);
        for (const l of levels) {
          const color = /^var\((--[\w-]+)\)$/.test(l.color || '') ? css(l.color.slice(4, -1), text) : l.color;
          if (near(l.value)) candles.createPriceLine({ price: l.value, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: l.label });
        }
        if (cpr && near(cpr.bc) && near(cpr.tc)) {
          candles.createPriceLine({ price: cpr.tc, color: '#f59e0b', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: 'CPR' });
          candles.createPriceLine({ price: cpr.bc, color: '#f59e0b', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
        }
        chart.timeScale().fitContent();
      })
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
      if (chart) chart.remove();
    };
  }, [bars, levels, cpr, height]);
  if (failed) return <CandleChart bars={bars} levels={levels} cpr={cpr} />;
  return <div ref={box} className="pro-chart" style={{ height }} aria-label="Today's 5-minute candles with VWAP and EMA 9 / 15" />;
}
