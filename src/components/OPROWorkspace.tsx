import { useState, useEffect, useRef } from 'react';
import type { Session, Prompt } from '../types/opro';
import {
  getCurrentStep,
  updatePrompt,
  addPromptsToStep,
  getSession,
  createNextStep,
  generateMetaPrompt
} from '../utils/sessionStorage';
import { generatePrompts, scorePrompt } from '../api/gemini';
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
  const [isScoringBatch, setIsScoringBatch] = useState(false);
  const [scoringBatchIds, setScoringBatchIds] = useState<Set<string>>(new Set());
  const [scoreBatchSize, setScoreBatchSize] = useState<number>(initialSession.config.k);
  const [fullyAutomatic, setFullyAutomatic] = useState(false);
  const [sortColumn, setSortColumn] = useState<'step' | 'score' | 'state' | 'createdAt'>('score');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  
  // Custom prompt scoring
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [customPromptScore, setCustomPromptScore] = useState<number | null>(null);
  const [isScoringCustom, setIsScoringCustom] = useState(false);

  const pendingTimeoutsRef = useRef<number[]>([]);
  const activeSessionIdRef = useRef<string>(initialSession.id);

  const currentStep = getCurrentStep(session);

  // Reset state when session changes
  useEffect(() => {
    pendingTimeoutsRef.current.forEach(timeout => clearTimeout(timeout));
    pendingTimeoutsRef.current = [];
    activeSessionIdRef.current = initialSession.id;
    
    setSession(initialSession);
    setIsGenerating(false);
    setIsScoringBatch(false);
    setScoringBatchIds(new Set());
    setScoreBatchSize(initialSession.config.k);
    setFullyAutomatic(false);
    setSortColumn('score');
    setSortDirection('desc');
    setCustomPrompt('');
    setCustomPromptScore(null);
    setIsScoringCustom(false);
  }, [initialSession.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pendingTimeoutsRef.current.forEach(timeout => clearTimeout(timeout));
      pendingTimeoutsRef.current = [];
    };
  }, []);

  // Load test data
  useEffect(() => {
    readTSVFile('gsm_train.tsv')
      .then(data => setTestData(data))
      .catch(error => console.error('Error loading test data:', error));
  }, []);

  const refreshSession = () => {
    const updated = getSession(session.id);
    if (updated) {
      setSession(updated);
    }
  };

  const handleGeneratePrompts = async () => {
    if (testData.length === 0) {
      alert('Test data not loaded yet');
      return;
    }

    const currentSessionId = session.id;
    setIsGenerating(true);

    try {
      // Always fetch the latest session/step to avoid stale closures
      const freshSession = getSession(session.id);
      if (!freshSession) {
        console.error('Session not found');
        return;
      }
      const freshStep = getCurrentStep(freshSession);
      if (!freshStep) {
        console.error('Current step not found');
        return;
      }

      // Generate meta-prompt for current (fresh) step
      const metaPrompt = generateMetaPrompt(freshSession, testData);

      // Generate k prompts with fresh config
      const prompts = await generatePrompts(
        metaPrompt,
        freshSession.config.k,
        freshSession.config.optimizerTemperature,
        freshSession.config.optimizerModel
      );

      if (activeSessionIdRef.current !== currentSessionId) {
        console.log('Session changed during generation, aborting');
        return;
      }

      // Add prompts to the latest step (not the stale one)
      addPromptsToStep(freshSession, freshStep.stepNumber, prompts);

      if (fullyAutomatic && activeSessionIdRef.current === currentSessionId) {
        const updatedSession = getSession(session.id);
        if (updatedSession) {
          setSession(updatedSession);
          const timeoutId = window.setTimeout(() => {
            if (activeSessionIdRef.current === currentSessionId) {
              handleScoreBatch();
            }
          }, 1000);
          pendingTimeoutsRef.current.push(timeoutId);
        }
      } else {
        refreshSession();
      }
    } catch (error) {
      console.error('Error generating prompts:', error);
      alert('Failed to generate prompts. Check console for details.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleScoreBatch = async () => {
    if (testData.length === 0) {
      alert('Test data not loaded yet');
      return;
    }

    const currentSessionId = session.id;
    const freshSession = getSession(session.id);
    if (!freshSession) {
      console.error('Session not found');
      return;
    }

    const freshStep = getCurrentStep(freshSession);
    if (!freshStep) {
      console.error('Current step not found');
      return;
    }

    const unscoredPrompts = freshStep.prompts.filter(p => p.state === 'pending');
    if (unscoredPrompts.length === 0) {
      console.log('No unscored prompts');
      return;
    }

    const promptsToScore = unscoredPrompts.slice(0, scoreBatchSize);
    console.log(`Scoring ${promptsToScore.length} prompts in parallel...`);

    setIsScoringBatch(true);
    setScoringBatchIds(new Set(promptsToScore.map(p => p.id)));

    try {
      if (activeSessionIdRef.current !== currentSessionId) {
        console.log('Session changed, aborting');
        return;
      }

      // Mark all as scoring on the fresh session
      for (const prompt of promptsToScore) {
        updatePrompt(freshSession, prompt.id, { state: 'scoring' });
      }
      refreshSession();

      // Score all in parallel
      const scoringPromises = promptsToScore.map((prompt, index) => {
        console.log(`Starting scoring for prompt ${index + 1}/${promptsToScore.length}...`);

        return scorePrompt(
          prompt.text,
          testData,
          freshSession.config.scorerTemperature,
          freshSession.config.scorerModel
        )
        .then(score => {
          console.log(`Successfully scored prompt ${index + 1}: ${score.toFixed(2)}%`);

          if (activeSessionIdRef.current !== currentSessionId) {
            console.log('Session changed during scoring, aborting update');
            return null;
          }

          updatePrompt(freshSession, prompt.id, {
            state: 'scored',
            score: Math.round(score * 100) / 100
          });
          refreshSession();

          return { promptId: prompt.id, score };
        })
        .catch(error => {
          console.error(`Failed to score prompt ${index + 1}:`, error);

          if (activeSessionIdRef.current !== currentSessionId) {
            console.log('Session changed during error, aborting');
            return null;
          }

          updatePrompt(freshSession, prompt.id, { state: 'pending' });
          refreshSession();

          throw new Error(`Failed to score prompt ${index + 1}: ${error}`);
        });
      });

      await Promise.all(scoringPromises);
      console.log(`Successfully scored all ${promptsToScore.length} prompts`);

      // Check if all scored, then auto next step
      if (fullyAutomatic && activeSessionIdRef.current === currentSessionId) {
        const updatedSession = getSession(session.id);
        if (updatedSession) {
          const updatedStep = getCurrentStep(updatedSession);
          if (updatedStep) {
            const hasUnscored = updatedStep.prompts.some(p => p.state === 'pending');

            if (!hasUnscored) {
              const timeoutId = window.setTimeout(() => {
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
      console.error('Error during batch scoring:', error);
      alert('Failed to score some prompts. Check console for details.');
    } finally {
      setIsScoringBatch(false);
      setScoringBatchIds(new Set());
    }
  };

  const handleNextStep = async () => {
    // Luôn lấy session mới nhất để tránh ghi đè dữ liệu vừa chấm
    const freshSession = getSession(session.id);
    if (!freshSession) {
      console.error('Session not found');
      return;
    }

    const freshStep = getCurrentStep(freshSession);
    if (!freshStep) {
      console.error('Current step not found');
      return;
    }

    const allScoredFresh =
      freshStep.prompts.length > 0 && freshStep.prompts.every(p => p.state === 'scored');

    if (!allScoredFresh) {
      alert('Please score all prompts before proceeding to the next step');
      return;
    }

    const currentSessionId = freshSession.id;

    try {
      const updatedSession = createNextStep(freshSession);

      if (activeSessionIdRef.current !== currentSessionId) {
        console.log('Session changed, aborting');
        return;
      }

      setSession(updatedSession);

      // Auto-generate prompts for new step
      if (fullyAutomatic && activeSessionIdRef.current === currentSessionId) {
        const timeoutId = window.setTimeout(() => {
          if (activeSessionIdRef.current === currentSessionId) {
            handleGeneratePrompts();
          }
        }, 1000);
        pendingTimeoutsRef.current.push(timeoutId);
      }
    } catch (error) {
      console.error('Error creating next step:', error);
      alert('Failed to create next step. Check console for details.');
    }
  };

  const handleScoreCustomPrompt = async () => {
    if (testData.length === 0) {
      alert('Test data not loaded yet');
      return;
    }

    setIsScoringCustom(true);
    setCustomPromptScore(null);

    try {
      const score = await scorePrompt(
        customPrompt,
        testData,
        session.config.scorerTemperature,
        session.config.scorerModel
      );

      setCustomPromptScore(Math.round(score * 100) / 100);
    } catch (error) {
      console.error('Error scoring custom prompt:', error);
      alert('Failed to score custom prompt. Check console for details.');
    } finally {
      setIsScoringCustom(false);
    }
  };

  if (!currentStep) {
    return <div>Error: Current step not found</div>;
  }

  const allScored = currentStep.prompts.length > 0 && currentStep.prompts.every(p => p.state === 'scored');
  const hasPrompts = currentStep.prompts.length > 0;

  // Get all prompts from all steps
  const allPrompts = session.steps.flatMap(step =>
    step.prompts.map(prompt => ({
      ...prompt,
      stepNumber: step.stepNumber
    }))
  );

  // Sort prompts
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

  // Chart data
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

        {/* Batch Size Configuration */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid #ddd' }}>
          <label style={{ fontSize: '14px', fontWeight: 'bold' }}>
            Parallel Scoring Batch Size:
          </label>
          <input
            type="number"
            min="1"
            max="20"
            value={scoreBatchSize}
            onChange={(e) => {
              const value = parseInt(e.target.value);
              if (!isNaN(value) && value > 0 && value <= 20) {
                setScoreBatchSize(value);
              }
            }}
            disabled={isScoringBatch}
            style={{
              padding: '8px 12px',
              fontSize: '14px',
              width: '70px',
              border: '1px solid #ccc',
              borderRadius: '4px'
            }}
          />
          <span style={{ fontSize: '12px', color: '#666' }}>
            (Number of prompts to score in parallel)
          </span>
        </div>
      </div>

      {/* Automation */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
        <h3>Automation</h3>
        <label>
          <input
            type="checkbox"
            checked={fullyAutomatic}
            onChange={(e) => setFullyAutomatic(e.target.checked)}
          />
          {' '}Fully Automatic
        </label>
        <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
          Automatically generates prompts, scores them, and progresses through steps
        </div>
      </div>

      {/* Custom Prompt Scoring */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #4CAF50', borderRadius: '5px', backgroundColor: '#f9fff9' }}>
        <h3>Custom Prompt Scoring</h3>
        <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
          Enter a custom prompt to score it independently
        </div>
        <textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Enter your custom prompt here..."
          disabled={isScoringCustom}
          style={{
            width: '100%',
            minHeight: '100px',
            padding: '10px',
            fontFamily: 'monospace',
            fontSize: '13px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            backgroundColor: isScoringCustom ? '#f5f5f5' : 'white',
            resize: 'vertical',
            marginBottom: '10px'
          }}
        />
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={handleScoreCustomPrompt}
            disabled={isScoringCustom || testData.length === 0}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: (isScoringCustom || testData.length === 0) ? 'not-allowed' : 'pointer',
              opacity: (isScoringCustom || testData.length === 0) ? 0.6 : 1
            }}
          >
            {isScoringCustom ? 'Scoring...' : 'Score Custom Prompt'}
          </button>
          {customPromptScore !== null && (
            <div style={{
              padding: '10px 20px',
              backgroundColor: '#4CAF50',
              color: 'white',
              borderRadius: '4px',
              fontWeight: 'bold',
              fontSize: '16px'
            }}>
              Score: {customPromptScore.toFixed(2)}%
            </div>
          )}
          {isScoringCustom && (
            <div style={{ fontSize: '14px', color: '#666' }}>
              Scoring in progress...
            </div>
          )}
          <button
            onClick={() => {
              setCustomPrompt('');
              setCustomPromptScore(null);
            }}
            disabled={isScoringCustom}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              backgroundColor: '#999',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isScoringCustom ? 'not-allowed' : 'pointer',
              opacity: isScoringCustom ? 0.6 : 1
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Actions */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
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
            onClick={handleScoreBatch}
            disabled={isScoringBatch}
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              backgroundColor: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isScoringBatch ? 'not-allowed' : 'pointer',
              opacity: isScoringBatch ? 0.6 : 1
            }}
          >
            {isScoringBatch ? `Scoring ${scoreBatchSize} Prompts...` : `Score ${scoreBatchSize} Prompts`}
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
                  {prompt.state === 'scoring' && scoringBatchIds.has(prompt.id) && (
                    <span style={{
                      marginLeft: '10px',
                      padding: '8px 16px',
                      backgroundColor: '#FFA500',
                      color: 'white',
                      borderRadius: '4px',
                      fontSize: '14px'
                    }}>
                      Scoring...
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chart */}
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

      {/* History Table */}
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