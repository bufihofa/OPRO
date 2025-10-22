import { useState, useEffect, useRef } from 'react';
import type { Session, Prompt, AutomationOptions } from '../types/opro';
import {
  getCurrentStep,
  updatePrompt,
  addPromptsToStep,
  getSession,
  updateSession
} from '../utils/sessionStorage';
import { generatePrompts, scorePrompt } from '../api/opro';
import { readTSVFile, type QuestionAnswer } from '../utils/tsvReader';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

interface OPROWorkspaceProps {
  session: Session;
  onBack: () => void;
}

export function OPROWorkspace({ session: initialSession, onBack }: OPROWorkspaceProps) {
  const [session, setSession] = useState<Session>(initialSession);
  const [testData, setTestData] = useState<QuestionAnswer[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isScoringAll, setIsScoringAll] = useState(false);
  const [scoringPromptId, setScoringPromptId] = useState<string | null>(null);
  const [automationOptions, setAutomationOptions] = useState<AutomationOptions>({
    fullyAutomatic: false,
  });
  const [totalInputTokens, setTotalInputTokens] = useState(0);
  const [totalOutputTokens, setTotalOutputTokens] = useState(0);
  const [totalRequests, setTotalRequests] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);
  const [sortColumn, setSortColumn] = useState<'step' | 'score' | 'state' | 'createdAt'>('score');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // FIX: Track pending automation timeouts for cleanup
  const pendingTimeoutsRef = useRef<number[]>([]);

  // FIX: Track the active session ID to prevent operations on stale sessions
  const activeSessionIdRef = useRef<string>(initialSession.id);

  const currentStep = getCurrentStep(session);

  // FIX: Reset all state when session changes
  useEffect(() => {
    // Clear all pending timeouts from previous session
    pendingTimeoutsRef.current.forEach(timeout => clearTimeout(timeout));
    pendingTimeoutsRef.current = [];

    // Update active session ID
    activeSessionIdRef.current = initialSession.id;

    // Reset all state
    setSession(initialSession);
    setIsGenerating(false);
    setIsScoringAll(false);
    setScoringPromptId(null);
    setAutomationOptions({ fullyAutomatic: false });
    setTotalInputTokens(0);
    setTotalOutputTokens(0);
    setTotalRequests(0);
    setCorrectCount(0);
    setIncorrectCount(0);
    setSortColumn('score');
    setSortDirection('desc');
  }, [initialSession.id]); // Re-run when session ID changes

  // FIX: Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear all pending timeouts when component unmounts
      pendingTimeoutsRef.current.forEach(timeout => clearTimeout(timeout));
      pendingTimeoutsRef.current = [];
    };
  }, []);

  // Load test data
  useEffect(() => {
    readTSVFile('gsm_test.tsv')
      .then(data => setTestData(data))
      .catch(error => console.error('Error loading test data:', error));
  }, []);

  const updateRequest = (inputTokens: number, outputTokens: number) => {
    setTotalInputTokens(prev => prev + inputTokens);
    setTotalOutputTokens(prev => prev + outputTokens);
    setTotalRequests(prev => prev + 1);
  };

  const updateProgress = (status: boolean) => {
    if (status) {
      setCorrectCount(prev => prev + 1);
    } else {
      setIncorrectCount(prev => prev + 1);
    }
  };

  const refreshSession = () => {
    const updated = getSession(session.id);
    if (updated) {
      setSession(updated);
    }
  };

  const handleGeneratePrompts = async () => {
    if (!currentStep) return;

    // FIX: Capture current session ID for validation
    const currentSessionId = session.id;

    setIsGenerating(true);
    try {
      const prompts = await generatePrompts(
        currentStep.metaPrompt,
        session.config.k,
        session.config.optimizerTemperature,
        session.config.optimizerModel,
        updateRequest
      );

      // FIX: Verify we're still on the same session before updating
      if (activeSessionIdRef.current !== currentSessionId) {
        console.log('Session changed during generation, aborting update');
        return;
      }

      addPromptsToStep(session, currentStep.stepNumber, prompts);
      refreshSession();

      // BUG FIX: Trigger auto-scoring after generation if fully automatic is enabled
      if (automationOptions.fullyAutomatic) {
        const updatedSession = getSession(session.id);
        if (updatedSession && activeSessionIdRef.current === currentSessionId) {
          const updatedStep = getCurrentStep(updatedSession);
          if (updatedStep && updatedStep.prompts.length > 0) {
            const firstPrompt = updatedStep.prompts.find(p => p.state === 'pending');
            if (firstPrompt) {
              const timeoutId = window.setTimeout(() => {
                // FIX: Double-check session is still active before executing
                if (activeSessionIdRef.current === currentSessionId) {
                  handleScorePrompt(firstPrompt);
                }
              }, 1000);
              pendingTimeoutsRef.current.push(timeoutId);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error generating prompts:', error);
      alert('Failed to generate prompts. Check console for details.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleScorePrompt = async (prompt: Prompt) => {
    if (testData.length === 0) {
      alert('Test data not loaded yet');
      return;
    }

    // FIX: Capture current session ID for validation
    const currentSessionId = session.id;

    setScoringPromptId(prompt.id);
    setCorrectCount(0);
    setIncorrectCount(0);

    try {
      // FIX: Verify we're still on the same session
      if (activeSessionIdRef.current !== currentSessionId) {
        console.log('Session changed during scoring setup, aborting');
        return;
      }

      updatePrompt(session, prompt.id, { state: 'scoring' });
      refreshSession();

      const score = await scorePrompt(
        prompt.text,
        testData,
        session.config.scorerTemperature,
        session.config.scorerModel,
        updateProgress,
        updateRequest
      );

      // FIX: Verify we're still on the same session after async operation
      if (activeSessionIdRef.current !== currentSessionId) {
        console.log('Session changed during scoring, aborting update');
        return;
      }

      updatePrompt(session, prompt.id, {
        state: 'scored',
        score: Math.round(score * 100) / 100
      });
      refreshSession();

      // Check automation options
      if (automationOptions.fullyAutomatic && activeSessionIdRef.current === currentSessionId) {
        const updatedSession = getSession(session.id);
        if (updatedSession) {
          const updatedStep = getCurrentStep(updatedSession);
          if (updatedStep) {
            const hasUnscored = updatedStep.prompts.some(p => p.state === 'pending');

            if (hasUnscored) {
              // Auto-score next prompt
              const nextPrompt = updatedStep.prompts.find(p => p.state === 'pending');
              if (nextPrompt) {
                const timeoutId = window.setTimeout(() => {
                  // FIX: Double-check session is still active before executing
                  if (activeSessionIdRef.current === currentSessionId) {
                    handleScorePrompt(nextPrompt);
                  }
                }, 1000);
                pendingTimeoutsRef.current.push(timeoutId);
              }
            } else {
              // Auto next step - all prompts scored
              const timeoutId = window.setTimeout(() => {
                // FIX: Double-check session is still active before executing
                if (activeSessionIdRef.current === currentSessionId) {
                  handleNextStep();
                }
              }, 1000);
              pendingTimeoutsRef.current.push(timeoutId);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error scoring prompt:', error);
      alert('Failed to score prompt. Check console for details.');
      updatePrompt(session, prompt.id, { state: 'pending' });
      refreshSession();
    } finally {
      setScoringPromptId(null);
    }
  };

  const handleScoreAll = async () => {
    if (!currentStep) return;
    if (testData.length === 0) {
      alert('Test data not loaded yet');
      return;
    }

    // FIX: Capture current session ID for validation
    const currentSessionId = session.id;

    const unscoredPrompts = currentStep.prompts.filter(p => p.state === 'pending');
    if (unscoredPrompts.length === 0) {
      alert('No unscored prompts');
      return;
    }

    setIsScoringAll(true);

    for (const prompt of unscoredPrompts) {
      // FIX: Check if session is still active before scoring each prompt
      if (activeSessionIdRef.current !== currentSessionId) {
        console.log('Session changed during batch scoring, aborting');
        break;
      }
      await handleScorePrompt(prompt);
    }

    setIsScoringAll(false);
  };

  const handleNextStep = async () => {
    if (!currentStep) return;

    const allScored = currentStep.prompts.every(p => p.state === 'scored');
    if (!allScored) {
      alert('Please score all prompts before proceeding to the next step');
      return;
    }

    // FIX: Capture current session ID for validation
    const currentSessionId = session.id;

    try {
      // Import createNextStep dynamically to avoid circular dependency
      const { createNextStep } = await import('../utils/sessionStorage');
      const updatedSession = createNextStep(session);

      // FIX: Verify we're still on the same session
      if (activeSessionIdRef.current !== currentSessionId) {
        console.log('Session changed during next step creation, aborting');
        return;
      }

      setSession(updatedSession);

      // Auto-generate prompts for the new step
      const newStep = getCurrentStep(updatedSession);
      if (newStep) {
        setIsGenerating(true);
        try {
          const prompts = await generatePrompts(
            newStep.metaPrompt,
            updatedSession.config.k,
            updatedSession.config.optimizerTemperature,
            updatedSession.config.optimizerModel,
            updateRequest
          );

          // FIX: Verify we're still on the same session after async operation
          if (activeSessionIdRef.current !== currentSessionId) {
            console.log('Session changed during prompt generation, aborting update');
            return;
          }

          addPromptsToStep(updatedSession, newStep.stepNumber, prompts);
          refreshSession();

          // BUG FIX: Trigger auto-scoring after generation if fully automatic is enabled
          if (automationOptions.fullyAutomatic && activeSessionIdRef.current === currentSessionId) {
            const finalSession = getSession(updatedSession.id);
            if (finalSession) {
              const finalStep = getCurrentStep(finalSession);
              if (finalStep && finalStep.prompts.length > 0) {
                const firstPrompt = finalStep.prompts.find(p => p.state === 'pending');
                if (firstPrompt) {
                  const timeoutId = window.setTimeout(() => {
                    // FIX: Double-check session is still active before executing
                    if (activeSessionIdRef.current === currentSessionId) {
                      handleScorePrompt(firstPrompt);
                    }
                  }, 1000);
                  pendingTimeoutsRef.current.push(timeoutId);
                }
              }
            }
          }
        } catch (error) {
          console.error('Error generating prompts for new step:', error);
          alert('Failed to generate prompts for new step. Check console for details.');
        } finally {
          setIsGenerating(false);
        }
      }
    } catch (error) {
      console.error('Error creating next step:', error);
      alert('Failed to create next step. Check console for details.');
    }
  };

  if (!currentStep) {
    return <div>Error: Current step not found</div>;
  }

  const allScored = currentStep.prompts.length > 0 && currentStep.prompts.every(p => p.state === 'scored');
  const hasPrompts = currentStep.prompts.length > 0;

  // Get all prompts from all steps for history table
  const allPrompts = session.steps.flatMap(step =>
    step.prompts.map(prompt => ({
      ...prompt,
      stepNumber: step.stepNumber
    }))
  );

  // Sort prompts for history table
  const sortedPrompts = [...allPrompts].sort((a, b) => {
    let comparison = 0;
    switch (sortColumn) {
      case 'step':
        comparison = a.stepNumber - b.stepNumber;
        break;
      case 'score':
        comparison = (a.score ?? -1) - (b.score ?? -1);
        break;
      case 'state':
        comparison = a.state.localeCompare(b.state);
        break;
      case 'createdAt':
        comparison = a.createdAt - b.createdAt;
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // Get all prompt scores for scatter chart
  const allPromptsChartData = session.steps.flatMap(step =>
    step.prompts
      .filter(p => p.score !== null)
      .map(prompt => ({
        step: step.stepNumber,
        score: prompt.score!,
        promptText: prompt.text,
        state: prompt.state,
        id: prompt.id
      }))
  );

  // Handle column sort
  const handleSort = (column: 'step' | 'score' | 'state' | 'createdAt') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection(column === 'score' ? 'desc' : 'asc');
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>{session.name} - Step {session.currentStep}</h2>
          <div style={{ fontSize: '14px', color: '#666' }}>
            k={session.config.k} | topX={session.config.topX}
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '3px' }}>
            Optimizer: {session.config.optimizerModel} (temp={session.config.optimizerTemperature})
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '3px' }}>
            Scorer: {session.config.scorerModel} (temp={session.config.scorerTemperature})
          </div>
        </div>
        <button onClick={onBack} style={{ padding: '10px 20px' }}>
          Back to Sessions
        </button>
      </div>

      {/* Statistics */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
        <h3>Statistics</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          <div>Total Requests: {totalRequests}</div>
          <div>Input Tokens: {totalInputTokens.toLocaleString()}</div>
          <div>Output Tokens: {totalOutputTokens.toLocaleString()}</div>
          <div>Correct: {correctCount}</div>
          <div>Incorrect: {incorrectCount}</div>
          <div>Cost: ${(totalInputTokens / 1000000 * 0.1 * 26500 + totalOutputTokens / 1000000 * 0.4 * 26500).toFixed(4)}</div>
        </div>
      </div>

      {/* Automation Options */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
        <h3>Automation</h3>
        <label>
          <input
            type="checkbox"
            checked={automationOptions.fullyAutomatic}
            onChange={(e) => setAutomationOptions({ fullyAutomatic: e.target.checked })}
          />
          {' '}Fully Automatic
        </label>
        <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
          When enabled: automatically scores all prompts, progresses to next step, and continues the cycle
        </div>
      </div>

      {/* Feature 1: Meta-Prompt Viewer */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
        <h3>Current Step Meta-Prompt</h3>
        <textarea
          value={currentStep.metaPrompt}
          readOnly
          style={{
            width: '100%',
            minHeight: '200px',
            padding: '10px',
            fontFamily: 'monospace',
            fontSize: '13px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            backgroundColor: '#f9f9f9',
            resize: 'vertical'
          }}
        />
      </div>

      {/* Actions */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        {!hasPrompts && (
          <button 
            onClick={handleGeneratePrompts}
            disabled={isGenerating}
            style={{ padding: '10px 20px', fontSize: '16px' }}
          >
            {isGenerating ? 'Generating...' : `Generate ${session.config.k} Prompts`}
          </button>
        )}
        {hasPrompts && !allScored && (
          <button 
            onClick={handleScoreAll}
            disabled={isScoringAll || scoringPromptId !== null}
            style={{ padding: '10px 20px', fontSize: '16px' }}
          >
            {isScoringAll ? 'Scoring All...' : 'Score All'}
          </button>
        )}
        {allScored && (
          <button 
            onClick={handleNextStep}
            style={{ padding: '10px 20px', fontSize: '16px', backgroundColor: '#4CAF50', color: 'white' }}
          >
            Next Step
          </button>
        )}
      </div>

      {/* Prompts List */}
      <div>
        <h3>Prompts ({currentStep.prompts.length})</h3>
        {currentStep.prompts.length === 0 ? (
          <p>No prompts generated yet. Click "Generate Prompts" to start.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {currentStep.prompts.map((prompt, index) => (
              <div 
                key={prompt.id}
                style={{ 
                  padding: '15px', 
                  border: '2px solid ' + (
                    prompt.state === 'scored' ? '#4CAF50' : 
                    prompt.state === 'scoring' ? '#FFA500' : 
                    '#ddd'
                  ),
                  borderRadius: '5px',
                  backgroundColor: prompt.state === 'scoring' ? '#FFF8DC' : 'white'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div style={{ flex: 1 }}>
                    <strong>Prompt {index + 1}</strong>
                    <span style={{ 
                      marginLeft: '10px', 
                      padding: '3px 8px', 
                      borderRadius: '3px',
                      fontSize: '12px',
                      backgroundColor: 
                        prompt.state === 'scored' ? '#4CAF50' : 
                        prompt.state === 'scoring' ? '#FFA500' : 
                        '#999',
                      color: 'white'
                    }}>
                      {prompt.state.toUpperCase()}
                    </span>
                    {prompt.score !== null && (
                      <span style={{ marginLeft: '10px', fontWeight: 'bold', color: '#4CAF50' }}>
                        Score: {prompt.score.toFixed(2)}%
                      </span>
                    )}
                    <div style={{ marginTop: '10px', whiteSpace: 'pre-wrap' }}>
                      {prompt.text}
                    </div>
                  </div>
                  {prompt.state === 'pending' && (
                    <button 
                      onClick={() => handleScorePrompt(prompt)}
                      disabled={scoringPromptId !== null}
                      style={{ padding: '8px 16px', marginLeft: '10px' }}
                    >
                      Score
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Feature 3: All Prompt Scores Chart */}
      {allPromptsChartData.length > 0 && (
        <div style={{ marginTop: '30px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
          <h3>All Prompt Scores by Step ({allPromptsChartData.length} prompts)</h3>
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="step"
                name="Step"
                label={{ value: 'Step Number', position: 'insideBottom', offset: -5 }}
                domain={['dataMin', 'dataMax']}
                allowDecimals={false}
              />
              <YAxis
                type="number"
                dataKey="score"
                name="Score"
                label={{ value: 'Accuracy (%)', angle: -90, position: 'insideLeft' }}
                domain={[0, 100]}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div style={{
                        backgroundColor: 'white',
                        padding: '10px',
                        border: '1px solid #ccc',
                        borderRadius: '5px',
                        maxWidth: '300px'
                      }}>
                        <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>
                          Step {data.step}
                        </p>
                        <p style={{ margin: '0 0 5px 0', color: '#4CAF50' }}>
                          Score: {data.score}%
                        </p>
                        <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: '#666' }}>
                          State: {data.state}
                        </p>
                        <p style={{ margin: '0', fontSize: '12px', color: '#333' }}>
                          Prompt: {data.promptText.length > 100
                            ? data.promptText.substring(0, 100) + '...'
                            : data.promptText}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend />
              <Scatter
                name="Prompt Scores"
                data={allPromptsChartData}
                fill="#4CAF50"
                shape="circle"
              >
                {allPromptsChartData.map((_entry, index) => (
                  <Cell key={`cell-${index}`} fill="#4CAF50" />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Feature 2: Prompt History Table */}
      {allPrompts.length > 0 && (
        <div style={{ marginTop: '30px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
          <h3>All Prompts History ({allPrompts.length} total)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '14px'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#f5f5f5' }}>
                  <th
                    onClick={() => handleSort('step')}
                    style={{
                      padding: '10px',
                      border: '1px solid #ddd',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                  >
                    Step {sortColumn === 'step' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    onClick={() => handleSort('score')}
                    style={{
                      padding: '10px',
                      border: '1px solid #ddd',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                  >
                    Score {sortColumn === 'score' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    onClick={() => handleSort('state')}
                    style={{
                      padding: '10px',
                      border: '1px solid #ddd',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                  >
                    State {sortColumn === 'state' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th style={{ padding: '10px', border: '1px solid #ddd' }}>
                    Prompt Text
                  </th>
                  <th
                    onClick={() => handleSort('createdAt')}
                    style={{
                      padding: '10px',
                      border: '1px solid #ddd',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                  >
                    Created {sortColumn === 'createdAt' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedPrompts.map((prompt) => (
                  <tr key={`${prompt.stepNumber}-${prompt.id}`}>
                    <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>
                      {prompt.stepNumber}
                    </td>
                    <td style={{
                      padding: '10px',
                      border: '1px solid #ddd',
                      textAlign: 'center',
                      fontWeight: 'bold',
                      color: prompt.score !== null ? '#4CAF50' : '#999'
                    }}>
                      {prompt.score !== null ? prompt.score.toFixed(2) + '%' : '-'}
                    </td>
                    <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: '3px',
                        fontSize: '11px',
                        backgroundColor:
                          prompt.state === 'scored' ? '#4CAF50' :
                          prompt.state === 'scoring' ? '#FFA500' :
                          '#999',
                        color: 'white'
                      }}>
                        {prompt.state.toUpperCase()}
                      </span>
                    </td>
                    <td style={{
                      padding: '10px',
                      border: '1px solid #ddd',
                      maxWidth: '400px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={prompt.text}
                    >
                      {prompt.text}
                    </td>
                    <td style={{
                      padding: '10px',
                      border: '1px solid #ddd',
                      fontSize: '12px',
                      color: '#666',
                      whiteSpace: 'nowrap'
                    }}>
                      {new Date(prompt.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

