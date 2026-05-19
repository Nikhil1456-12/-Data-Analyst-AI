import { useState, useEffect } from 'react';
import './index.css';
import ChatPanel from './components/ChatPanel';
import WorkflowPanel from './components/WorkflowPanel';
import ResultsPanel from './components/ResultsPanel';

function App() {
  const [query, setQuery] = useState('');
  const [workflowState, setWorkflowState] = useState('IDLE'); // IDLE, PARSING, EXECUTING, INSIGHTS, CHART, DONE, ERROR
  const [resultData, setResultData] = useState(null);
  const [messages, setMessages] = useState([
    { role: 'system', content: 'Hello! I am your AI Data Analyst. Ask me anything about your database.' }
  ]);
  const [suggestions, setSuggestions] = useState([]);
  const [sqlHistory, setSqlHistory] = useState([]);
  const [askedQuestions, setAskedQuestions] = useState([]);
  const [dbInfo, setDbInfo] = useState(null);
  const [databases, setDatabases] = useState([]);
  const [activeTable, setActiveTable] = useState(null);

  const fetchDatabases = async () => {
    try {
      const response = await fetch('/api/databases');
      const data = await response.json();
      if (data.databases) setDatabases(data.databases);
    } catch (err) {
      console.error('Failed to load databases', err);
    }
  };

  const fetchSuggestions = async (historyObj = askedQuestions, tableContext = activeTable) => {
    try {
      const response = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: historyObj, activeTable: tableContext })
      });
      const data = await response.json();
      if (data.suggestions) setSuggestions(data.suggestions);
    } catch (err) {
      console.error('Failed to load suggestions', err);
    }
  };

  const fetchDbInfo = async () => {
    try {
      const response = await fetch('/api/database/info');
      const data = await response.json();
      setDbInfo(data);
    } catch (err) {
      console.error('Failed to load db info', err);
    }
  };

  useEffect(() => {
    fetchDatabases();
    fetchSuggestions([]);
    fetchDbInfo();
  }, []);

  const handleDatabaseSwitch = async (newDb) => {
    try {
      await fetch('/api/database/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ database: newDb })
      });
      fetchDbInfo();
      setActiveTable(null);
      fetchSuggestions([], null);
      setMessages(prev => [...prev, { role: 'system', content: `Environment switched securely to database: ${newDb}` }]);
    } catch (err) {
      console.error(err);
    }
  };

  const handleFileUpload = async (files) => {
    const fileArray = Array.from(files);
    const fileNames = fileArray.map(f => f.name).join(', ');
    setMessages(prev => [...prev, { role: 'user', content: `Uploaded files: ${fileNames}` }]);
    setWorkflowState('PARSING');
    
    const formData = new FormData();
    fileArray.forEach(file => formData.append('files', file));
    
    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error(`Server returned HTML (Backend crashed or wrong port): ${text.substring(0, 60)}...`);
      }

      if (!response.ok) throw new Error(data.error);
      
      setMessages(prev => [...prev, { role: 'system', content: data.message }]);
      setWorkflowState('DONE');
      fetchSuggestions(); 
      fetchDbInfo();
    } catch (error) {
      setMessages(prev => [...prev, { role: 'system', content: `Error: ${error.message}` }]);
      setWorkflowState('ERROR');
    }
  };

  const handleQuerySubmit = async (userQuery) => {
    setQuery(userQuery);
    setMessages(prev => [...prev, { role: 'user', content: userQuery }]);
    
    const newAsked = [...askedQuestions, userQuery];
    setAskedQuestions(newAsked);

    setWorkflowState('PARSING');
    setResultData(null);

    const params = new URLSearchParams({ query: userQuery });
    if (activeTable) {
        params.append('activeTable', activeTable);
    }

    const eventSource = new EventSource(`/api/query/stream?${params.toString()}`);

    eventSource.addEventListener('state', (e) => {
        const state = JSON.parse(e.data);
        setWorkflowState(state);
    });

    eventSource.addEventListener('result', (e) => {
        const data = JSON.parse(e.data);
        setResultData(data);
        if (data.sql) setSqlHistory(prev => [...prev, data.sql]);
        setMessages(prev => [...prev, { role: 'system', content: `Query executed successfully! Found ${data.data?.length || 0} rows.` }]);
        fetchDbInfo();
        fetchSuggestions(newAsked);
        eventSource.close();
    });

    eventSource.addEventListener('error', (e) => {
        let msg = 'An error occurred during query processing.';
        try {
             // SSE sometimes sends raw strings or JSON
             msg = JSON.parse(e.data);
        } catch {
             msg = e.data || msg;
        }
        console.error("SSE Error:", msg);
        setWorkflowState('ERROR');
        setMessages(prev => [...prev, { role: 'system', content: `Error: ${msg}` }]);
        eventSource.close();
    });
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>AI Data Analyst</h1>
        <span className="badge">Pro</span>
      </header>
      <main className="three-panel-layout">
        <section className="panel chat-panel-container">
          <ChatPanel 
            messages={messages} 
            onSubmit={handleQuerySubmit} 
            onFileUpload={handleFileUpload} 
            isProcessing={workflowState !== 'IDLE' && workflowState !== 'DONE' && workflowState !== 'ERROR'} 
            dbInfo={dbInfo}
            databases={databases}
            onDatabaseSwitch={handleDatabaseSwitch}
            activeTable={activeTable}
            onTableSelect={(t) => {
              setActiveTable(t);
              fetchSuggestions(askedQuestions, t);
            }}
          />
        </section>
        <section className="panel workflow-panel-container">
          <WorkflowPanel currentState={workflowState} suggestions={suggestions} onSuggestionClick={handleQuerySubmit} />
        </section>
        <section className="panel results-panel-container">
          <ResultsPanel result={resultData} sqlHistory={sqlHistory} />
        </section>
      </main>
    </div>
  );
}

export default App;
