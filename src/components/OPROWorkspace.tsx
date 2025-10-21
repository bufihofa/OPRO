import { useState, useEffect } from 'react';
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
    autoScore: false,
    autoNextStep: false,
  });
  const [totalInputTokens, setTotalInputTokens] = useState(0);
  const [totalOutputTokens, setTotalOutputTokens] = useState(0);
  const [totalRequests, setTotalRequests] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);

  const currentStep = getCurrentStep(session);

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

    setIsGenerating(true);
    try {
      const prompts = await generatePrompts(
        currentStep.metaPrompt,
        session.config.k,
        session.config.temperature,
        session.config.model,
        updateRequest
      );

      addPromptsToStep(session, currentStep.stepNumber, prompts);
      refreshSession();
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

    setScoringPromptId(prompt.id);
    setCorrectCount(0);
    setIncorrectCount(0);

    try {
      updatePrompt(session, prompt.id, { state: 'scoring' });
      refreshSession();

      const score = await scorePrompt(
        prompt.text,
        testData,
        0, // Use temperature 0 for scoring
        session.config.model,
        updateProgress,
        updateRequest
      );

      updatePrompt(session, prompt.id, { 
        state: 'scored', 
        score: Math.round(score * 100) / 100 
      });
      refreshSession();

      // Check automation options
      if (automationOptions.autoScore || automationOptions.autoNextStep) {
        const updatedSession = getSession(session.id);
        if (updatedSession) {
          const updatedStep = getCurrentStep(updatedSession);
          if (updatedStep) {
            const hasUnscored = updatedStep.prompts.some(p => p.state === 'pending');
            
            if (hasUnscored && automationOptions.autoScore) {
              // Auto-score next prompt
              const nextPrompt = updatedStep.prompts.find(p => p.state === 'pending');
              if (nextPrompt) {
                setTimeout(() => handleScorePrompt(nextPrompt), 1000);
              }
            } else if (!hasUnscored && automationOptions.autoNextStep) {
              // Auto next step
              setTimeout(() => handleNextStep(), 1000);
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

    const unscoredPrompts = currentStep.prompts.filter(p => p.state === 'pending');
    if (unscoredPrompts.length === 0) {
      alert('No unscored prompts');
      return;
    }

    setIsScoringAll(true);

    for (const prompt of unscoredPrompts) {
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

    try {
      // Import createNextStep dynamically to avoid circular dependency
      const { createNextStep } = await import('../utils/sessionStorage');
      const updatedSession = createNextStep(session, session.config.k);
      setSession(updatedSession);

      // Auto-generate prompts for the new step
      const newStep = getCurrentStep(updatedSession);
      if (newStep) {
        setIsGenerating(true);
        try {
          const prompts = await generatePrompts(
            newStep.metaPrompt,
            updatedSession.config.k,
            updatedSession.config.temperature,
            updatedSession.config.model,
            updateRequest
          );

          addPromptsToStep(updatedSession, newStep.stepNumber, prompts);
          refreshSession();
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

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>{session.name} - Step {session.currentStep}</h2>
          <div style={{ fontSize: '14px', color: '#666' }}>
            k={session.config.k} | temp={session.config.temperature} | {session.config.model}
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
          <div>Cost: ${(totalInputTokens / 1000000 * 0.1 + totalOutputTokens / 1000000 * 0.4).toFixed(4)}</div>
        </div>
      </div>

      {/* Automation Options */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '5px' }}>
        <h3>Automation</h3>
        <label style={{ marginRight: '20px' }}>
          <input
            type="checkbox"
            checked={automationOptions.autoScore}
            onChange={(e) => setAutomationOptions({ ...automationOptions, autoScore: e.target.checked })}
          />
          {' '}Auto-Score
        </label>
        <label>
          <input
            type="checkbox"
            checked={automationOptions.autoNextStep}
            onChange={(e) => setAutomationOptions({ ...automationOptions, autoNextStep: e.target.checked })}
          />
          {' '}Auto-Next-Step
        </label>
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
    </div>
  );
}

