export default function HistoryDrawer({ isOpen, onClose, history, activeTable, onClearAll, onReRun }) {
  if (!isOpen) return null;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <h2>Query History</h2>
          <div className="drawer-actions">
            {history.length > 0 && (
              <button className="drawer-btn danger" onClick={onClearAll}>Clear All</button>
            )}
            <button className="drawer-close" onClick={onClose}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        {activeTable && (
          <div className="drawer-context">
            Showing history for: <strong>{activeTable}</strong>
          </div>
        )}

        <div className="drawer-content">
          {history.length > 0 ? (
            history.map((entry, i) => (
              <div key={i} className={`history-item status-${entry.status}`}>
                <div className="history-item-header">
                  <span className={`status-dot ${entry.status}`}></span>
                  <span className="history-query">{entry.nl_query}</span>
                  <button className="rerun-btn" onClick={() => { onReRun(entry.nl_query); onClose(); }} title="Re-run query">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                  </button>
                </div>
                <div className="history-item-meta">
                  {entry.row_count > 0 && <span>{entry.row_count} rows</span>}
                  {entry.execution_time_ms > 0 && <span>{entry.execution_time_ms}ms</span>}
                  <span>{new Date(entry.created_at).toLocaleString()}</span>
                </div>
                {entry.sql_query && (
                  <pre className="history-sql">{entry.sql_query}</pre>
                )}
                {entry.error_message && (
                  <p className="history-error">{entry.error_message}</p>
                )}
              </div>
            ))
          ) : (
            <div className="drawer-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              <p>No query history yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
