import { useState } from 'react';

export default function ResultsPanel({ result, activeTable }) {
  const [activeTab, setActiveTab] = useState('insights');

  const handleExportCSV = () => {
    if (!result?.data?.length) return;
    const columns = Object.keys(result.data[0]);
    const csv = [
      columns.join(','),
      ...result.data.map(row => columns.map(c => {
        const val = String(row[c] ?? '');
        return val.includes(',') ? `"${val}"` : val;
      }).join(','))
    ].join('\n');

    downloadBlob(csv, 'analysis_data.csv', 'text/csv');
  };

  const handleExportSQL = () => {
    if (!result?.sql) return;
    downloadBlob(result.sql, 'query.sql', 'text/sql');
  };

  const handleExportPDF = async () => {
    if (!result) return;
    try {
      const res = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Data Analysis Report',
          subtitle: activeTable ? `Table: ${activeTable}` : 'General Analysis',
          analysisResult: result
        })
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report_${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF export failed', err);
    }
  };

  const downloadBlob = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!result) {
    return (
      <div className="results-panel empty-state">
        <div className="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 3v18" />
          </svg>
        </div>
        <h3>No Results Yet</h3>
        <p>Ask a question or run an analysis to see results here.</p>
      </div>
    );
  }

  const { sql, data, insights, chartImage, vizSkipped, rowCount, executionTime } = result;
  const columns = data?.length > 0 ? Object.keys(data[0]) : [];

  return (
    <div className="results-panel">
      {/* Header */}
      <div className="results-header">
        <div className="results-meta">
          <span className="meta-item">{rowCount || data?.length || 0} rows</span>
          {executionTime && <span className="meta-item">{executionTime}ms</span>}
        </div>
        <div className="export-actions">
          <button className="export-btn" onClick={handleExportCSV} title="Export CSV">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            CSV
          </button>
          <button className="export-btn" onClick={handleExportSQL} title="Export SQL">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            SQL
          </button>
          <button className="export-btn export-btn-primary" onClick={handleExportPDF} title="Export PDF Report">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
            PDF Report
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="results-tabs">
        <button className={`tab-btn ${activeTab === 'insights' ? 'active' : ''}`} onClick={() => setActiveTab('insights')}>Insights</button>
        <button className={`tab-btn ${activeTab === 'chart' ? 'active' : ''}`} onClick={() => setActiveTab('chart')}>Visualization</button>
        <button className={`tab-btn ${activeTab === 'data' ? 'active' : ''}`} onClick={() => setActiveTab('data')}>Data Table</button>
        <button className={`tab-btn ${activeTab === 'sql' ? 'active' : ''}`} onClick={() => setActiveTab('sql')}>SQL</button>
      </div>

      {/* Tab Content */}
      <div className="results-content">
        {activeTab === 'insights' && (
          <div className="tab-content insights-content">
            {insights ? (
              <div className="insights-text">
                {insights.split('\n').filter(l => l.trim()).map((line, i) => (
                  <p key={i} className="insight-line">{line}</p>
                ))}
              </div>
            ) : (
              <p className="no-content">No insights generated.</p>
            )}
          </div>
        )}

        {activeTab === 'chart' && (
          <div className="tab-content chart-content">
            {chartImage ? (
              <img src={chartImage} alt="Data Visualization" className="chart-image" />
            ) : (
              <div className="no-chart">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 20V10M12 20V4M6 20v-6" /></svg>
                <p>{vizSkipped || 'No visualization available for this query.'}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'data' && (
          <div className="tab-content table-content">
            {data && data.length > 0 ? (
              <div className="data-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {columns.map(col => <th key={col}>{col}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.slice(0, 100).map((row, i) => (
                      <tr key={i}>
                        {columns.map(col => (
                          <td key={col} title={String(row[col] ?? '')}>
                            {row[col] !== null && row[col] !== undefined ? String(row[col]) : <span className="null-val">null</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.length > 100 && (
                  <div className="table-footer">Showing 100 of {data.length} rows</div>
                )}
              </div>
            ) : (
              <p className="no-content">No data returned.</p>
            )}
          </div>
        )}

        {activeTab === 'sql' && (
          <div className="tab-content sql-content">
            <pre className="sql-code"><code>{sql}</code></pre>
          </div>
        )}
      </div>
    </div>
  );
}
