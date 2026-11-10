import React, { useState } from 'react';
import { Card } from './ui.jsx';
import { exportExcel, exportPdf, exportCsv } from '../lib/exporters.js';

const ITEMS = [
  {
    id: 'xlsx',
    icon: 'XLS',
    title: 'Excel workbook',
    desc: 'Summary, bullish and bearish setups with entry/stop/targets, sector table, all stocks with every indicator, and the settings used.',
    action: 'Download .xlsx',
  },
  {
    id: 'pdf',
    icon: 'PDF',
    title: 'PDF report',
    desc: 'Client-ready A4 landscape report: indices, market breadth, top setups, sector performance and the disclaimer on every page.',
    action: 'Download .pdf',
  },
  {
    id: 'csv',
    icon: 'CSV',
    title: 'CSV (all stocks)',
    desc: 'Flat file of every stock with signals. Opens in Excel, Google Sheets or any tool you use for your own analysis.',
    action: 'Download .csv',
  },
];

export default function Reports({ ctx }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const run = async (id) => {
    setBusy(id);
    setError('');
    try {
      if (id === 'xlsx') await exportExcel(ctx);
      if (id === 'pdf') await exportPdf(ctx);
      if (id === 'csv') exportCsv(ctx);
    } catch (e) {
      console.error(e);
      setError(`Could not create the file: ${e.message || e}`);
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <Card title="Download reports" right={<span className="muted small">Data as of {ctx.meta.lastTradingDate}</span>}>
        <div className="grid-3">
          {ITEMS.map((it) => (
            <div key={it.id} className="report-card">
              <div className="report-icon">{it.icon}</div>
              <h3>{it.title}</h3>
              <p className="muted small">{it.desc}</p>
              <button className="btn primary" disabled={!!busy} onClick={() => run(it.id)}>
                {busy === it.id ? 'Preparing…' : it.action}
              </button>
            </div>
          ))}
        </div>
        {error && <p className="error mt">{error}</p>}
      </Card>
      <Card title="What is inside">
        <ul className="plain small">
          <li>Files are created in your browser. Nothing is uploaded anywhere.</li>
          <li>Reports use the screener settings currently active (Admin panel). The Excel file lists them in the Settings sheet.</li>
          <li>Prices come from {ctx.meta.source}. Reports carry the data date so readers know how fresh they are.</li>
        </ul>
      </Card>
    </>
  );
}
