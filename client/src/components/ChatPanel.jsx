import { useState, useEffect, useRef } from 'react';

export default function ChatPanel({ messages, onSubmit, onFileUpload, onClean, isProcessing, activeTable }) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('analyze'); // analyze | clean
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    if (mode === 'clean') {
      onClean(input.trim());
    } else {
      onSubmit(input.trim());
    }
    setInput('');
  };

  const handleFileChange = (e) => {
    if (e.target.files?.length > 0) {
      onFileUpload(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h2>Analysis Chat</h2>
        <div className="mode-toggle">
          <button
            className={`mode-btn ${mode === 'analyze' ? 'active' : ''}`}
            onClick={() => setMode('analyze')}
            title="Ask analytical questions"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            Analyze
          </button>
          <button
            className={`mode-btn ${mode === 'clean' ? 'active' : ''}`}
            onClick={() => setMode('clean')}
            title="Data cleaning operations"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            Clean
          </button>
        </div>
      </div>

      <div className="messages-container">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message message-${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
              )}
            </div>
            <div className="message-content">
              <div className="message-bubble">{msg.content}</div>
            </div>
          </div>
        ))}
        {isProcessing && (
          <div className="message message-system">
            <div className="message-avatar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
            </div>
            <div className="message-content">
              <div className="message-bubble typing">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="file"
          multiple
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".csv,.xlsx,.xls,.json,.pdf,.tsv,.txt"
          style={{ display: 'none' }}
        />
        <button
          type="button"
          className="input-action-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
          title="Upload files"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>
        <input
          type="text"
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={mode === 'clean'
            ? `Describe cleaning operation${activeTable ? ` for ${activeTable}` : ''}...`
            : 'Ask a question about your data...'
          }
          disabled={isProcessing}
        />
        <button type="submit" className="send-btn" disabled={isProcessing || !input.trim()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  );
}
