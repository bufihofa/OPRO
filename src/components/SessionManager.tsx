import { useState, useEffect } from 'react';
import type { Session, OPROConfig } from '../types/opro';
import { getAllSessions, createSession, deleteSession } from '../utils/sessionStorage';
import { readTSVFile, type QuestionAnswer } from '../utils/tsvReader';

interface SessionManagerProps {
  onSelectSession: (session: Session) => void;
}

export function SessionManager({ onSelectSession }: SessionManagerProps) {
  const [sessions, setSessions] = useState<Session[]>(getAllSessions());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [k, setK] = useState(4);
  const [topX, setTopX] = useState(20);
  const [optimizerModel, setOptimizerModel] = useState('gemini-2.5-flash');
  const [optimizerTemperature, setOptimizerTemperature] = useState(1.0);
  const [scorerModel, setScorerModel] = useState('gemini-2.5-flash-lite');
  const [scorerTemperature, setScorerTemperature] = useState(0.0);
  const [testData, setTestData] = useState<QuestionAnswer[]>([]);
  const [scoreData, setScoreData] = useState<QuestionAnswer[]>([]);
  // Load test data
  useEffect(() => {
    readTSVFile('gsm_train.tsv')
      .then(data => setTestData(data))
      .catch(error => console.error('Error loading train data:', error));
  }, []);

  const handleCreateSession = () => {
    if (!newSessionName.trim()) {
      alert('Please enter a session name');
      return;
    }

    if (testData.length === 0) {
      alert('Test data not loaded yet. Please wait a moment and try again.');
      return;
    }

    const config: OPROConfig = {
      k,
      topX,
      optimizerModel,
      optimizerTemperature,
      scorerModel,
      scorerTemperature,
    };

    // Only pass testSet for initial meta-prompt generation
    const session = createSession(newSessionName, config);
    setSessions(getAllSessions());
    setNewSessionName('');
    setShowCreateForm(false);
    onSelectSession(session);
  };

  const handleDeleteSession = (sessionId: string) => {
    if (confirm('Are you sure you want to delete this session?')) {
      deleteSession(sessionId);
      setSessions(getAllSessions());
    }
  };

  const handleResumeSession = (sessionId: string) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      onSelectSession(session);
    }
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', marginBottom: '20px' }}>
      <h2>Session Management</h2>
      
      {!showCreateForm && (
        <button 
          onClick={() => setShowCreateForm(true)}
          style={{ marginBottom: '20px', padding: '10px 20px', fontSize: '16px' }}
        >
          Create New Session
        </button>
      )}

      {showCreateForm && (
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
          <h3>Create New Session</h3>
          <div style={{ marginBottom: '10px' }}>
            <label>
              Session Name:
              <input
                type="text"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                style={{ marginLeft: '10px', padding: '5px', width: '300px' }}
              />
            </label>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label>
              Number of prompts per step (k):
              <input
                type="number"
                value={k}
                onChange={(e) => setK(Number(e.target.value))}
                min="1"
                max="16"
                style={{ marginLeft: '10px', padding: '5px', width: '100px' }}
              />
            </label>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label>
              Top X prompts in meta-prompt (topX):
              <input
                type="number"
                value={topX}
                onChange={(e) => setTopX(Number(e.target.value))}
                min="1"
                max="50"
                style={{ marginLeft: '10px', padding: '5px', width: '100px' }}
              />
            </label>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '5px', marginLeft: '10px' }}>
              Number of highest-scoring prompts to include in meta-prompt (sorted ascending)
            </div>
          </div>

          <h4 style={{ marginTop: '20px', marginBottom: '10px' }}>Optimizer LLM Configuration</h4>
          <div style={{ marginBottom: '10px' }}>
            <label>
              Optimizer Model:
              <select
                value={optimizerModel}
                onChange={(e) => setOptimizerModel(e.target.value)}
                style={{ marginLeft: '10px', padding: '5px', width: '200px' }}
              >
                <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
              </select>
            </label>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label>
              Optimizer Temperature:
              <input
                type="number"
                value={optimizerTemperature}
                onChange={(e) => setOptimizerTemperature(Number(e.target.value))}
                min="0"
                max="2"
                step="0.1"
                style={{ marginLeft: '10px', padding: '5px', width: '100px' }}
              />
            </label>
          </div>

          <h4 style={{ marginTop: '20px', marginBottom: '10px' }}>Scorer LLM Configuration</h4>
          <div style={{ marginBottom: '10px' }}>
            <label>
              Scorer Model:
              <select
                value={scorerModel}
                onChange={(e) => setScorerModel(e.target.value)}
                style={{ marginLeft: '10px', padding: '5px', width: '200px' }}
              >
                <option value="gemini-2.0-flash-lite">gemini-2.0-flash-lite</option>
                <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
              </select>
            </label>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label>
              Scorer Temperature:
              <input
                type="number"
                value={scorerTemperature}
                onChange={(e) => setScorerTemperature(Number(e.target.value))}
                min="0"
                max="2"
                step="0.1"
                style={{ marginLeft: '10px', padding: '5px', width: '100px' }}
              />
            </label>
          </div>

          <button
            onClick={handleCreateSession}
            style={{ marginRight: '10px', padding: '8px 16px' }}
          >
            Create
          </button>
          <button
            onClick={() => setShowCreateForm(false)}
            style={{ padding: '8px 16px' }}
          >
            Cancel
          </button>
        </div>
      )}

      <h3>Existing Sessions</h3>
      {sessions.length === 0 ? (
        <p>No sessions yet. Create one to get started!</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {sessions.map(session => (
            <div 
              key={session.id}
              style={{ 
                padding: '15px', 
                border: '1px solid #ddd', 
                borderRadius: '5px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <strong>{session.name}</strong>
                <div style={{ fontSize: '14px', color: '#666', marginTop: '5px' }}>
                  Step {session.currentStep} | k={session.config.k} | topX={session.config.topX}
                </div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '3px' }}>
                  Optimizer: {session.config.optimizerModel} (temp={session.config.optimizerTemperature})
                </div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '3px' }}>
                  Scorer: {session.config.scorerModel} (temp={session.config.scorerTemperature})
                </div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '3px' }}>
                  Created: {new Date(session.createdAt).toLocaleString()}
                </div>
              </div>
              <div>
                <button 
                  onClick={() => handleResumeSession(session.id)}
                  style={{ marginRight: '10px', padding: '8px 16px' }}
                >
                  Resume
                </button>
                <button 
                  onClick={() => handleDeleteSession(session.id)}
                  style={{ padding: '8px 16px', backgroundColor: '#ff4444', color: 'white' }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

