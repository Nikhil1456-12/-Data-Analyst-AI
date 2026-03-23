import React from 'react';
import './panels.css';

const WORKFLOW_STEPS = [
  { id: 'PARSING', label: 'NL to SQL Parsing' },
  { id: 'EXECUTING', label: 'Executing Query' },
  { id: 'INSIGHTS', label: 'Generating Insights' },
  { id: 'CHART', label: 'Python Visualization' },
];

export default function WorkflowPanel({ currentState, suggestions, onSuggestionClick }) {
  const getStepStatus = (stepId, currentState) => {
    if (currentState === 'IDLE') return 'waiting';
    if (currentState === 'ERROR') return 'error';
    if (currentState === 'DONE') return 'done';

    const currentIndex = WORKFLOW_STEPS.findIndex(s => s.id === currentState);
    const stepIndex = WORKFLOW_STEPS.findIndex(s => s.id === stepId);

    if (stepIndex < currentIndex) return 'done';
    if (stepIndex === currentIndex) return 'active';
    return 'waiting';
  };

  return (
    <div className="workflow-panel">
      <div className="chat-header">
        <h2>Task Workflow</h2>
      </div>
      <div className="workflow-steps">
        {WORKFLOW_STEPS.map((step, idx) => {
          const status = getStepStatus(step.id, currentState);
          return (
            <div key={step.id} className={`workflow-step ${status}`}>
              <div className="step-indicator">
                {status === 'done' ? '✓' : idx + 1}
              </div>
              <div className="step-label">{step.label}</div>
            </div>
          );
        })}
      </div>

      <div className="chat-header" style={{ borderTop: '1px solid var(--border-color)', marginTop: 'auto' }}>
        <h2>💡 Suggested Queries</h2>
      </div>
      <div className="suggestions-list" style={{ padding: '16px', overflowY: 'auto' }}>
        {(!suggestions || suggestions.length === 0) ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Waiting for database schema context...</p>
        ) : (
          suggestions.map((sug, i) => (
            <div 
              key={i} 
              className="suggestion-item" 
              onClick={() => onSuggestionClick(sug)}
              style={{
                padding: '10px', backgroundColor: '#f1f5f9', borderRadius: '6px', 
                marginBottom: '8px', cursor: 'pointer', fontSize: '0.85rem', 
                color: 'var(--primary)', border: '1px solid #e2e8f0', transition: 'all 0.2s'
              }}
            >
              {sug}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
