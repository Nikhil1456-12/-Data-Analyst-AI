import React from 'react';

export default function HistoryDrawer({ isOpen, onClose, history, activeTable, onClearAll, onReRun }) {
  const handleCopySql = (sql, e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(sql);
    const btn = e.currentTarget;
    const origText = btn.innerHTML;
    btn.innerHTML = '✓ Copied!';
    setTimeout(() => {
      btn.innerHTML = origText;
    }, 1500);
  };

  const formatTime = (timeStr) => {
    try {
      const date = new Date(timeStr);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return timeStr;
    }
  };

  return (
    <div className={`history-drawer-overlay ${isOpen ? 'open' : ''}`} onClick={onClose}>
      <div className="history-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="history-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <h3 style={{ margin: 0 }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary)' }}>
                <path d="M12 8v4l3 3M3 12a9 9 0 1 1 9 9m-9-9c.3-2.6 1.8-4.8 4-6" />
              </svg>
              Query Log History
            </h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {activeTable ? `Scope: "${activeTable}" Table History` : 'Scope: General Database Logs'}
            </span>
          </div>
          <button className="close-drawer-btn" onClick={onClose} title="Close History">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="history-content">
          {(!history || history.length === 0) ? (
            <div className="history-empty-state">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 8v4l3 3"></path>
              </svg>
              <p style={{ fontWeight: 500 }}>No operations logged yet</p>
              <p style={{ fontSize: '0.82rem', maxWidth: '280px' }}>
                {activeTable 
                  ? `Your queries and analytical results for table "${activeTable}" will be logged persistently here.`
                  : 'Your database general queries, files processed, and analytical results will be logged persistently here.'}
              </p>
            </div>
          ) : (
            history.map((item) => (
              <div key={item.id} className="history-item">
                <div className="history-item-meta">
                  <span className={`history-item-badge ${item.status}`}>
                    {item.status === 'success' ? `✓ Success (${item.row_count} rows)` : '✗ Error'}
                  </span>
                  <span className="history-item-time">{formatTime(item.executed_at)}</span>
                </div>
                <div className="history-item-query">
                  {item.nl_query}
                </div>
                {item.sql_query && (
                  <div className="history-item-sql">
                    {item.sql_query}
                  </div>
                )}
                {item.error_message && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--error)', backgroundColor: '#fef2f2', padding: '8px 12px', borderRadius: '6px', border: '1px solid #fee2e2' }}>
                    <strong>Error Log:</strong> {item.error_message}
                  </div>
                )}
                <div className="history-item-actions">
                  <button className="history-action-btn" onClick={() => { onReRun(item.nl_query); onClose(); }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    Re-run Query
                  </button>
                  {item.sql_query && (
                    <button className="history-action-btn secondary" onClick={(e) => handleCopySql(item.sql_query, e)}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                      Copy SQL
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {history && history.length > 0 && (
          <button className="history-clear-all-btn" onClick={onClearAll}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
            Clear {activeTable ? `Table "${activeTable}"` : 'Database'} History
          </button>
        )}
      </div>
    </div>
  );
}
