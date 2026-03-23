import React, { useState, useEffect, useRef } from 'react';
import './panels.css';

function TableStatItem({ table }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetch(`/api/database/stats/${table.tableName}`)
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(err => setStats({ rowCount: 'Err', totalNulls: 'Err', totalDuplicates: 'Err' }));
  }, [table.tableName]);

  return (
    <li className="table-item">
      <strong>{table.tableName}</strong>
      {!stats ? (
        <div className="table-stats">
          <span className="stat-badge" style={{ background: '#f1f5f9', color: '#64748b' }}>Calculating heavy stats...</span>
        </div>
      ) : (
        <div className="table-stats">
          <span className="stat-badge rows">Rows: {stats.rowCount}</span>
          <span className="stat-badge nulls" title="Total NULL fields">Nulls: {stats.totalNulls}</span>
          <span className="stat-badge dups" title="Fully repeated rows">Dups: {stats.totalDuplicates}</span>
        </div>
      )}
    </li>
  );
}

export default function ChatPanel({ messages, onSubmit, onFileUpload, isProcessing, dbInfo, databases, onDatabaseSwitch }) {
  const [input, setInput] = useState('');
  const endOfMessagesRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !isProcessing) {
      onSubmit(input.trim());
      setInput('');
    }
  };

  const handleFileChange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0 && onFileUpload) {
      onFileUpload(files);
    }
    // reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="chat-panel">
      {/* Database Explorer Section */}
      <div className="db-explorer">
        <div className="chat-header" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2>🗄️ Database: </h2>
          <select 
            value={dbInfo?.dbName || ''} 
            onChange={(e) => onDatabaseSwitch(e.target.value)}
            style={{ padding: '4px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.9rem' }}
          >
            {(!databases || databases.length === 0) && <option value="">Loading...</option>}
            {databases && databases.map(db => (
              <option key={db} value={db}>{db}</option>
            ))}
          </select>
        </div>
        <div className="explorer-content">
          {dbInfo && dbInfo.tables && dbInfo.tables.length > 0 ? (
            <ul className="table-list">
              {dbInfo.tables.map(table => (
                <TableStatItem key={table.tableName} table={table} />
              ))}
            </ul>
          ) : (
            <p className="no-tables">No tables currently available.</p>
          )}
        </div>
      </div>

      {/* Chat Section */}
      <div className="chat-header" style={{ borderTop: '1px solid var(--border-color)' }}>
        <h2>💬 Chat Session</h2>
      </div>
      <div className="messages-container">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role === 'user' ? 'message-user' : 'message-system'}`}>
            <div className="message-bubble">{msg.content}</div>
          </div>
        ))}
        {isProcessing && (
          <div className="message message-system">
            <div className="message-bubble typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
        <div ref={endOfMessagesRef} />
      </div>
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input 
          type="file" 
          accept=".csv, .xlsx, .xls"
          multiple
          style={{ display: 'none' }}
          ref={fileInputRef}
          onChange={handleFileChange}
        />
        <button 
          type="button" 
          className="send-btn" 
          style={{ backgroundColor: '#64748b' }}
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          📎
        </button>
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about your data..."
          disabled={isProcessing}
          className="chat-input"
        />
        <button type="submit" disabled={isProcessing || !input.trim()} className="send-btn">
          Send
        </button>
      </form>
    </div>
  );
}
