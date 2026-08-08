const WORKFLOW_STEPS = [
  { id: 'PARSING', label: 'NL → SQL', icon: '🔄' },
  { id: 'VALIDATING', label: 'Validating', icon: '🛡️' },
  { id: 'EXECUTING', label: 'Executing', icon: '⚡' },
  { id: 'INSIGHTS', label: 'Insights', icon: '💡' },
  { id: 'CHART', label: 'Visualization', icon: '📊' },
];

export default function WorkflowPanel({ currentState, suggestions, onSuggestionClick }) {
  const getStepStatus = (stepId) => {
    if (currentState === 'IDLE') return 'idle';
    if (currentState === 'ERROR') return 'error';
    if (currentState === 'DONE') return 'done';

    const currentIdx = WORKFLOW_STEPS.findIndex(s => s.id === currentState);
    const stepIdx = WORKFLOW_STEPS.findIndex(s => s.id === stepId);

    if (stepIdx < currentIdx) return 'done';
    if (stepIdx === currentIdx) return 'active';
    return 'pending';
  };

  return (
    <div className="workflow-panel">
      {/* Pipeline Progress */}
      <div className="workflow-section">
        <h3 className="section-title">Pipeline</h3>
        <div className="workflow-steps">
          {WORKFLOW_STEPS.map((step) => {
            const status = getStepStatus(step.id);
            return (
              <div key={step.id} className={`workflow-step step-${status}`}>
                <div className="step-icon">
                  {status === 'done' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : status === 'active' ? (
                    <div className="step-spinner"></div>
                  ) : (
                    <span className="step-emoji">{step.icon}</span>
                  )}
                </div>
                <span className="step-label">{step.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Suggestions */}
      <div className="workflow-section suggestions-section">
        <h3 className="section-title">Suggested Queries</h3>
        <div className="suggestions-list">
          {suggestions.length > 0 ? (
            suggestions.map((sug, i) => (
              <button
                key={i}
                className="suggestion-card"
                onClick={() => onSuggestionClick(sug)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                <span>{sug}</span>
              </button>
            ))
          ) : (
            <p className="no-suggestions">Upload data to get AI-generated query suggestions</p>
          )}
        </div>
      </div>
    </div>
  );
}
