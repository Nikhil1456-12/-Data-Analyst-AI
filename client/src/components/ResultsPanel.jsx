import React from 'react';
import './panels.css';

export default function ResultsPanel({ result, sqlHistory }) {
  const downloadSQL = () => {
    if (!sqlHistory || sqlHistory.length === 0) return alert('No queries to download!');
    const content = sqlHistory.join(';\n\n') + ';';
    const blob = new Blob([content], { type: 'text/sql' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'session_history.sql';
    link.click();
  };

  const downloadCSV = () => {
    if (!result || !result.data || result.data.length === 0) return alert('No data to download!');
    const data = result.data;
    const columns = Object.keys(data[0]);
    const csvContent = [
      columns.join(','),
      ...data.map(row => columns.map(c => {
        let val = String(row[c]);
        // handle commas in csv
        if (val.includes(',')) val = `"${val}"`; 
        return val;
      }).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'dashboard_data.csv';
    link.click();
  };

  if (!result) {
    return (
      <div className="results-panel empty">
        <div className="empty-state">
          <p>Results will be displayed here.</p>
        </div>
      </div>
    );
  }

  const { sql, data, insights, chartImage } = result;
  const columns = data && data.length > 0 ? Object.keys(data[0]) : [];

  return (
    <div className="results-panel has-data">
      <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Dashboard Results</h2>
        <div className="export-actions" style={{ display: 'flex', gap: '8px' }}>
          <button onClick={downloadSQL} className="send-btn" style={{ fontSize: '0.8rem', padding: '6px 12px' }}>Download SQL</button>
          <button onClick={downloadCSV} className="send-btn" style={{ fontSize: '0.8rem', padding: '6px 12px' }}>Export CSV</button>
        </div>
      </div>
      
      <div className="results-content">
        {/* Insights Section */}
        {insights && (
          <div className="result-card insights-card">
            <h3>🔑 Business Insights</h3>
            <div className="insights-text">
              {insights.split('\n').map((line, idx) => (
                <p key={idx}>{line}</p>
              ))}
            </div>
          </div>
        )}

        {/* Chart Section */}
        {chartImage && (
          <div className="result-card chart-card">
            <h3>📈 Visualization</h3>
            <img src={chartImage} alt="Data Visualization" className="chart-image" />
          </div>
        )}

        {/* Data Table Section */}
        <div className="result-card table-card">
          <h3>📊 Data Table</h3>
          {data && data.length > 0 ? (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    {columns.map(col => <th key={col}>{col}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.slice(0, 100).map((row, i) => (
                    <tr key={i}>
                      {columns.map(col => <td key={col}>{row[col]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.length > 100 && <p className="table-note">Showing first 100 rows.</p>}
            </div>
          ) : (
            <p>No data returned.</p>
          )}
        </div>

        {/* SQL Section */}
        <div className="result-card sql-card">
          <h3>💻 Generated SQL</h3>
          <pre className="sql-code"><code>{sql}</code></pre>
        </div>
      </div>
    </div>
  );
}
