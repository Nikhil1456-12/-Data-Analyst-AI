import { useState } from 'react';

export default function Sidebar({ dbInfo, databases, activeTable, relationships, onDatabaseSwitch, onTableSelect, onHistoryOpen, onPanelSwitch, activePanel }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          {!isCollapsed && <span>Explorer</span>}
        </div>
        <button className="sidebar-toggle" onClick={() => setIsCollapsed(!isCollapsed)} title={isCollapsed ? 'Expand' : 'Collapse'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {isCollapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
          </svg>
        </button>
      </div>

      {!isCollapsed && (
        <>
          {/* Database Selector */}
          <div className="sidebar-section">
            <label className="sidebar-label">Database</label>
            <select
              className="sidebar-select"
              value={dbInfo?.dbName || ''}
              onChange={(e) => onDatabaseSwitch(e.target.value)}
            >
              {databases.map(db => (
                <option key={db} value={db}>{db}</option>
              ))}
            </select>
          </div>

          {/* Tables */}
          <div className="sidebar-section tables-section">
            <label className="sidebar-label">Tables</label>
            <div className="table-list">
              {dbInfo?.tables?.length > 0 ? (
                dbInfo.tables.map(t => (
                  <div
                    key={t.tableName}
                    className={`table-item ${activeTable === t.tableName ? 'active' : ''}`}
                    onClick={() => onTableSelect(t.tableName)}
                  >
                    <div className="table-item-name">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                        <line x1="3" y1="15" x2="21" y2="15" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                      </svg>
                      <span>{t.tableName}</span>
                    </div>
                    <div className="table-item-meta">
                      <span className="meta-badge">{t.rowCount} rows</span>
                      <span className="meta-badge">{t.columnCount} cols</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-tables">
                  <p>No tables yet</p>
                  <p className="hint">Upload a CSV, Excel, or JSON file</p>
                </div>
              )}
            </div>
          </div>

          {/* Relationships */}
          {relationships.length > 0 && (
            <div className="sidebar-section">
              <label className="sidebar-label">Relationships</label>
              <div className="relationship-list">
                {relationships.slice(0, 5).map((r, i) => (
                  <div key={i} className="relationship-item">
                    <span className="rel-table">{r.tableA}</span>
                    <span className="rel-arrow">↔</span>
                    <span className="rel-table">{r.tableB}</span>
                    <span className={`rel-confidence ${r.confidence}`}>{r.confidence}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* View Panels */}
          <div className="sidebar-section">
            <label className="sidebar-label">View</label>
            <div className="panel-nav">
              <button className={`panel-nav-btn ${activePanel === 'results' ? 'active' : ''}`} onClick={() => onPanelSwitch('results')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
                Results
              </button>
              <button className={`panel-nav-btn ${activePanel === 'profile' ? 'active' : ''}`} onClick={() => onPanelSwitch('profile')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6" /></svg>
                Profile
              </button>
            </div>
          </div>

          {/* History Button */}
          <div className="sidebar-footer">
            <button className="sidebar-btn" onClick={onHistoryOpen}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Query History
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
