import { useState, useEffect, useCallback } from 'react';
import './App.css';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import ResultsPanel from './components/ResultsPanel';
import WorkflowPanel from './components/WorkflowPanel';
import ProfilePanel from './components/ProfilePanel';
import HistoryDrawer from './components/HistoryDrawer';

function App() {
  // Core state
  const [workflowState, setWorkflowState] = useState('IDLE');
  const [resultData, setResultData] = useState(null);
  const [messages, setMessages] = useState([
    { role: 'system', content: 'Welcome to Data Analyst AI. Upload a dataset or ask a question to begin your analysis.' }
  ]);

  // Database state
  const [dbInfo, setDbInfo] = useState(null);
  const [databases, setDatabases] = useState([]);
  const [activeTable, setActiveTable] = useState(null);
  const [relationships, setRelationships] = useState([]);

  // Feature state
  const [suggestions, setSuggestions] = useState([]);
  const [askedQuestions, setAskedQuestions] = useState([]);
  const [activePanel, setActivePanel] = useState('results'); // results | profile | stats | forecast

  // History
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyLogs, setHistoryLogs] = useState([]);

  // ─── Data Fetchers ───────────────────────────────────────────────────────

  const fetchDbInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/database/info');
      const data = await res.json();
      setDbInfo(data);
    } catch (err) {
      console.error('Failed to load database info', err);
    }
  }, []);

  const fetchDatabases = useCallback(async () => {
    try {
      const res = await fetch('/api/database/list');
      const data = await res.json();
      if (data.databases) setDatabases(data.databases);
    } catch (err) {
      console.error('Failed to load databases', err);
    }
  }, []);

  const fetchSuggestions = useCallback(async (history = [], tableCtx = null) => {
    try {
      const res = await fetch('/api/query/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history, activeTable: tableCtx })
      });
      const data = await res.json();
      if (data.suggestions) setSuggestions(data.suggestions);
    } catch (err) {
      console.error('Failed to load suggestions', err);
    }
  }, []);

  const fetchRelationships = useCallback(async () => {
    try {
      const res = await fetch('/api/database/relationships');
      const data = await res.json();
      if (data.relationships) setRelationships(data.relationships);
    } catch (err) {
      console.error('Failed to load relationships', err);
    }
  }, []);

  const fetchHistory = useCallback(async (tableCtx = null) => {
    try {
      const url = tableCtx
        ? `/api/history?activeTable=${encodeURIComponent(tableCtx)}`
        : '/api/history';
      const res = await fetch(url);
      const data = await res.json();
      if (data.history) setHistoryLogs(data.history);
    } catch (err) {
      console.error('Failed to load history', err);
    }
  }, []);

  useEffect(() => {
    fetchDatabases();
    fetchDbInfo();
    fetchSuggestions([]);
    fetchHistory();
  }, [fetchDatabases, fetchDbInfo, fetchSuggestions, fetchHistory]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleDatabaseSwitch = async (newDb) => {
    try {
      await fetch('/api/database/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database: newDb })
      });
      setActiveTable(null);
      fetchDbInfo();
      fetchSuggestions([], null);
      fetchRelationships();
      fetchHistory();
      addMessage('system', `Switched to database: ${newDb}`);
    } catch (err) {
      addMessage('system', `Error switching database: ${err.message}`);
    }
  };

  const handleTableSelect = (table) => {
    const newTable = table === activeTable ? null : table;
    setActiveTable(newTable);
    fetchSuggestions(askedQuestions, newTable);
    fetchHistory(newTable);
  };

  const handleFileUpload = async (files) => {
    const fileArray = Array.from(files);
    addMessage('user', `Uploading: ${fileArray.map(f => f.name).join(', ')}`);
    setWorkflowState('PARSING');

    const formData = new FormData();
    fileArray.forEach(file => formData.append('files', file));

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      addMessage('system', data.message);
      setWorkflowState('DONE');
      fetchDbInfo();
      fetchSuggestions();
      fetchRelationships();
    } catch (error) {
      addMessage('system', `Upload Error: ${error.message}`);
      setWorkflowState('ERROR');
    }
  };

  const handleQuerySubmit = async (userQuery) => {
    addMessage('user', userQuery);
    const newAsked = [...askedQuestions, userQuery];
    setAskedQuestions(newAsked);
    setWorkflowState('PARSING');
    setResultData(null);
    setActivePanel('results');

    const params = new URLSearchParams({ query: userQuery });
    if (activeTable) params.append('activeTable', activeTable);

    const eventSource = new EventSource(`/api/query/stream?${params.toString()}`);

    eventSource.addEventListener('state', (e) => {
      setWorkflowState(JSON.parse(e.data));
    });

    eventSource.addEventListener('result', (e) => {
      const data = JSON.parse(e.data);
      setResultData(data);
      addMessage('system', `Analysis complete — ${data.rowCount || data.data?.length || 0} rows returned in ${data.executionTime || 0}ms`);
      fetchDbInfo();
      fetchSuggestions(newAsked, activeTable);
      fetchHistory(activeTable);
      eventSource.close();
    });

    eventSource.addEventListener('error', (e) => {
      let msg = 'An error occurred during processing.';
      try { msg = JSON.parse(e.data); } catch { msg = e.data || msg; }
      setWorkflowState('ERROR');
      addMessage('system', `Error: ${msg}`);
      fetchHistory(activeTable);
      eventSource.close();
    });
  };

  const handleCleanData = async (instruction) => {
    if (!activeTable) {
      addMessage('system', 'Please select a table first to perform cleaning operations.');
      return;
    }

    addMessage('user', `Clean: ${instruction}`);
    setWorkflowState('EXECUTING');

    try {
      const res = await fetch('/api/query/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, tableName: activeTable })
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      addMessage('system', data.message);
      setWorkflowState('DONE');
      fetchDbInfo();
    } catch (error) {
      addMessage('system', `Cleaning Error: ${error.message}`);
      setWorkflowState('ERROR');
    }
  };

  const handleClearHistory = async () => {
    try {
      await fetch('/api/history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeTable })
      });
      setHistoryLogs([]);
    } catch (err) {
      console.error('Failed to clear history', err);
    }
  };

  const addMessage = (role, content) => {
    setMessages(prev => [...prev, { role, content, timestamp: Date.now() }]);
  };

  const isProcessing = !['IDLE', 'DONE', 'ERROR'].includes(workflowState);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="app-container">
      <Sidebar
        dbInfo={dbInfo}
        databases={databases}
        activeTable={activeTable}
        relationships={relationships}
        onDatabaseSwitch={handleDatabaseSwitch}
        onTableSelect={handleTableSelect}
        onHistoryOpen={() => setIsHistoryOpen(true)}
        onPanelSwitch={setActivePanel}
        activePanel={activePanel}
      />

      <main className="main-content">
        <div className="top-bar">
          <div className="top-bar-left">
            <h1 className="app-title">Data Analyst AI</h1>
            <span className="version-badge">v2.0</span>
          </div>
          <div className="top-bar-right">
            {activeTable && (
              <span className="active-table-badge">
                <span className="badge-dot"></span>
                {activeTable}
              </span>
            )}
          </div>
        </div>

        <div className="content-grid">
          <section className="panel-chat">
            <ChatPanel
              messages={messages}
              onSubmit={handleQuerySubmit}
              onFileUpload={handleFileUpload}
              onClean={handleCleanData}
              isProcessing={isProcessing}
              activeTable={activeTable}
            />
          </section>

          <section className="panel-workflow">
            <WorkflowPanel
              currentState={workflowState}
              suggestions={suggestions}
              onSuggestionClick={handleQuerySubmit}
            />
          </section>

          <section className="panel-results">
            {activePanel === 'results' && (
              <ResultsPanel result={resultData} activeTable={activeTable} />
            )}
            {activePanel === 'profile' && (
              <ProfilePanel tableName={activeTable} />
            )}
          </section>
        </div>
      </main>

      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={historyLogs}
        activeTable={activeTable}
        onClearAll={handleClearHistory}
        onReRun={handleQuerySubmit}
      />
    </div>
  );
}

export default App;
