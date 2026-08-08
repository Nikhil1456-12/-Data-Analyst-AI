import { useState, useEffect } from 'react';

export default function ProfilePanel({ tableName }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeProfileTab, setActiveProfileTab] = useState('overview');

  useEffect(() => {
    if (!tableName) {
      setProfile(null);
      return;
    }
    loadProfile(tableName);
  }, [tableName]);

  const loadProfile = async (table) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(table)}`);
      if (!res.ok) throw new Error('Failed to load profile');
      const data = await res.json();
      setProfile(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!tableName) {
    return (
      <div className="profile-panel empty-state">
        <div className="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 20V10M12 20V4M6 20v-6" /></svg>
        </div>
        <h3>Data Profiling</h3>
        <p>Select a table from the sidebar to view its data profile.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="profile-panel loading-state">
        <div className="loader"></div>
        <p>Profiling <strong>{tableName}</strong>...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="profile-panel error-state">
        <p>Error: {error}</p>
        <button onClick={() => loadProfile(tableName)} className="retry-btn">Retry</button>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="profile-panel">
      {/* Header */}
      <div className="profile-header">
        <div>
          <h2>{profile.tableName}</h2>
          <div className="profile-meta">
            <span>{profile.totalRows.toLocaleString()} rows</span>
            <span>{profile.totalColumns} columns</span>
            <span>{profile.duplicateRows} duplicates</span>
          </div>
        </div>
        <div className="quality-score">
          <div className={`score-circle ${profile.dataQuality.score >= 80 ? 'good' : profile.dataQuality.score >= 50 ? 'fair' : 'poor'}`}>
            <span className="score-value">{profile.dataQuality.score}</span>
          </div>
          <span className="score-label">Quality</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="profile-tabs">
        <button className={`tab-btn ${activeProfileTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveProfileTab('overview')}>Overview</button>
        <button className={`tab-btn ${activeProfileTab === 'columns' ? 'active' : ''}`} onClick={() => setActiveProfileTab('columns')}>Columns</button>
        <button className={`tab-btn ${activeProfileTab === 'anomalies' ? 'active' : ''}`} onClick={() => setActiveProfileTab('anomalies')}>Anomalies</button>
      </div>

      {/* Content */}
      <div className="profile-content">
        {activeProfileTab === 'overview' && (
          <div className="profile-overview">
            {/* Quality Issues */}
            {profile.dataQuality.issues.length > 0 && (
              <div className="quality-issues">
                <h4>Quality Issues</h4>
                {profile.dataQuality.issues.map((issue, i) => (
                  <div key={i} className="issue-item">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Column Type Distribution */}
            <div className="type-distribution">
              <h4>Column Types</h4>
              <div className="type-bars">
                {Object.entries(
                  profile.columns.reduce((acc, col) => {
                    acc[col.category] = (acc[col.category] || 0) + 1;
                    return acc;
                  }, {})
                ).map(([type, count]) => (
                  <div key={type} className="type-bar-item">
                    <span className="type-name">{type}</span>
                    <div className="type-bar">
                      <div className="type-bar-fill" style={{ width: `${(count / profile.totalColumns) * 100}%` }}></div>
                    </div>
                    <span className="type-count">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeProfileTab === 'columns' && (
          <div className="profile-columns">
            {profile.columns.map((col) => (
              <div key={col.name} className="column-card">
                <div className="column-card-header">
                  <span className="col-name">{col.name}</span>
                  <span className={`col-type type-${col.category}`}>{col.type}</span>
                </div>
                <div className="column-card-stats">
                  <div className="stat-item">
                    <span className="stat-label">Nulls</span>
                    <span className={`stat-value ${col.nullPercentage > 30 ? 'warn' : ''}`}>{col.nullPercentage.toFixed(1)}%</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Unique</span>
                    <span className="stat-value">{col.uniqueCount.toLocaleString()}</span>
                  </div>
                  {col.stats && (
                    <>
                      <div className="stat-item">
                        <span className="stat-label">Mean</span>
                        <span className="stat-value">{col.stats.mean?.toFixed(2) ?? '—'}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Std</span>
                        <span className="stat-value">{col.stats.stddev?.toFixed(2) ?? '—'}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Min</span>
                        <span className="stat-value">{col.stats.min?.toFixed(2) ?? '—'}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Max</span>
                        <span className="stat-value">{col.stats.max?.toFixed(2) ?? '—'}</span>
                      </div>
                    </>
                  )}
                </div>
                {col.topValues && col.topValues.length > 0 && (
                  <div className="column-distribution">
                    {col.topValues.slice(0, 5).map((tv, i) => (
                      <div key={i} className="dist-bar">
                        <span className="dist-label" title={String(tv.value)}>{String(tv.value).slice(0, 20)}</span>
                        <div className="dist-bar-track">
                          <div className="dist-bar-fill" style={{ width: `${tv.percentage}%` }}></div>
                        </div>
                        <span className="dist-pct">{tv.percentage}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeProfileTab === 'anomalies' && (
          <div className="profile-anomalies">
            {profile.anomalies.length > 0 ? (
              profile.anomalies.map((anomaly, i) => (
                <div key={i} className={`anomaly-card severity-${anomaly.severity}`}>
                  <div className="anomaly-header">
                    <span className={`severity-badge ${anomaly.severity}`}>{anomaly.severity}</span>
                    <span className="anomaly-type">{anomaly.type.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="anomaly-message">{anomaly.message}</p>
                  {anomaly.column && <span className="anomaly-column">Column: {anomaly.column}</span>}
                </div>
              ))
            ) : (
              <div className="no-anomalies">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                <p>No anomalies detected. Data quality looks good.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
