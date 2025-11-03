import type { Session, Step, Prompt, OPROConfig, QuestionAnswer } from '../types/opro';

const SESSIONS_KEY = 'opro_sessions';

/**
 * Randomly select n items from an array
 */
function randomSample<T>(array: T[], n: number): T[] {
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, array.length));
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get all sessions from localStorage
 */
export function getAllSessions(): Session[] {
  const sessionsJson = localStorage.getItem(SESSIONS_KEY);
  if (!sessionsJson) return [];
  
  try {
    const sessions = JSON.parse(sessionsJson);
    // Migrate old sessions that don't have statistics
    return sessions.map((session: any) => {
      if (!session.statistics) {
        session.statistics = {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalRequests: 0,
          correctCount: 0,
          incorrectCount: 0,
        };
      }
      
      // ✅ NEW: Reset any 'scoring' prompts to 'pending' on load
      // This handles interrupted sessions (e.g., page refresh, network disconnect)
      if (session.steps) {
        session.steps.forEach((step: Step) => {
          if (step.prompts) {
            step.prompts.forEach((prompt: Prompt) => {
              if (prompt.state === 'scoring') {
                prompt.state = 'pending';
                console.log(`Reset prompt ${prompt.id} from 'scoring' to 'pending'`);
              }
            });
          }
        });
      }
      
      return session;
    });
  } catch (error) {
    console.error('Error parsing sessions from localStorage:', error);
    return [];
  }
}

/**
 * Save all sessions to localStorage
 */
function saveAllSessions(sessions: Session[]): void {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

/**
 * Get a session by ID
 */
export function getSession(sessionId: string): Session | null {
  const sessions = getAllSessions();
  return sessions.find(s => s.id === sessionId) || null;
}

/**
 * Create initial meta-prompt for step 1
 * Note: This will be called k times to generate k independent prompts
 * Now includes step 0 prompts and their scores
 */
function createInitialMetaPrompt(testSet: QuestionAnswer[], step0Prompts: Prompt[]): string {
  // Randomly select 3 examples from the test set
  const examples = randomSample(testSet, 3);

  let metaPrompt = `I have some texts along with their corresponding scores. The texts are arranged in ascending order based on their scores, where higher scores indicate better quality.

`;

  // Add step 0 prompts and scores (already in ascending order by score)
  for (const prompt of step0Prompts) {
    metaPrompt += `text:\n${prompt.text}\nscore:\n${prompt.score}\n\n`;
  }

  metaPrompt += `The following exemplars show how to apply your text: you replace <INS> in each input with your
text, then read the input and give an output. We say your output is wrong if your output is different
from the given output, and we say your output is correct if they are the same.

`;

  // Add the random examples
  for (const example of examples) {
    metaPrompt += `Problem:
Q: ${example.question}
A: <INS>
Ground truth answer:
${example.goldAnswer}

`;
  }

  metaPrompt += `Write your new text that is different from the old ones and has a score as high as possible. Write the text in square brackets.
`;

  return metaPrompt;
}

/**
 * Create a new session
 */
export function createSession(name: string, config: OPROConfig, testSet: QuestionAnswer[]): Session {
  const sessionId = generateId();
  const now = Date.now();

  // Create step 0 with initial prompts and scores
  const step0Prompts: Prompt[] = [
    {
      id: generateId(),
      text: "Let's solve the problem.",
      score: 87.02,
      state: 'scored' as const,
      createdAt: now,
    },
    {
      id: generateId(),
      text: "Let's figure it out!",
      score: 89.31,
      state: 'scored' as const,
      createdAt: now + 1,
    },
    {
      id: generateId(),
      text: "Let's think step by step.",
      score: 90.08,
      state: 'scored' as const,
      createdAt: now + 2,
    },
  ];

  // Create initial meta-prompt for step 1 with step 0 prompts
  const initialMetaPrompt = createInitialMetaPrompt(testSet, step0Prompts);

  const session: Session = {
    id: sessionId,
    name,
    currentStep: 1,
    steps: [
      {
        stepNumber: 0,
        prompts: step0Prompts,
        metaPrompt: '', // Step 0 doesn't need a meta-prompt
        createdAt: now,
      },
      {
        stepNumber: 1,
        prompts: [],
        metaPrompt: initialMetaPrompt,
        createdAt: now,
      }
    ],
    config,
    testSet,
    statistics: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      correctCount: 0,
      incorrectCount: 0,
    },
    createdAt: now,
    updatedAt: now,
  };

  const sessions = getAllSessions();
  sessions.push(session);
  saveAllSessions(sessions);

  return session;
}

/**
 * Update a session
 */
export function updateSession(session: Session): void {
  const sessions = getAllSessions();
  const index = sessions.findIndex(s => s.id === session.id);
  
  if (index === -1) {
    throw new Error(`Session ${session.id} not found`);
  }
  
  session.updatedAt = Date.now();
  sessions[index] = session;
  saveAllSessions(sessions);
}

/**
 * Update session statistics
 */
export function updateSessionStatistics(
  session: Session,
  updates: Partial<{
    inputTokens: number;
    outputTokens: number;
    requests: number;
    correct: number;
    incorrect: number;
  }>
): void {
  if (updates.inputTokens !== undefined) {
    session.statistics.totalInputTokens += updates.inputTokens;
  }
  if (updates.outputTokens !== undefined) {
    session.statistics.totalOutputTokens += updates.outputTokens;
  }
  if (updates.requests !== undefined) {
    session.statistics.totalRequests += updates.requests;
  }
  if (updates.correct !== undefined) {
    session.statistics.correctCount += updates.correct;
  }
  if (updates.incorrect !== undefined) {
    session.statistics.incorrectCount += updates.incorrect;
  }

  updateSession(session);
}

/**
 * Delete a session
 */
export function deleteSession(sessionId: string): void {
  const sessions = getAllSessions();
  const filtered = sessions.filter(s => s.id !== sessionId);
  saveAllSessions(filtered);
}

/**
 * Add prompts to a step
 */
export function addPromptsToStep(session: Session, stepNumber: number, promptTexts: string[]): Session {
  const step = session.steps.find(s => s.stepNumber === stepNumber);
  
  if (!step) {
    throw new Error(`Step ${stepNumber} not found in session ${session.id}`);
  }
  
  const newPrompts: Prompt[] = promptTexts.map(text => ({
    id: generateId(),
    text,
    score: null,
    state: 'pending' as const,
    createdAt: Date.now(),
  }));
  
  step.prompts.push(...newPrompts);
  updateSession(session);
  
  return session;
}

/**
 * Update a prompt's state and score
 */
export function updatePrompt(session: Session, promptId: string, updates: Partial<Prompt>): Session {
  let found = false;
  
  for (const step of session.steps) {
    const prompt = step.prompts.find(p => p.id === promptId);
    if (prompt) {
      Object.assign(prompt, updates);
      found = true;
      break;
    }
  }
  
  if (!found) {
    throw new Error(`Prompt ${promptId} not found in session ${session.id}`);
  }
  
  updateSession(session);
  return session;
}

/**
 * Create a new step with meta-prompt based on previous step's results
 */
export function createNextStep(session: Session): Session {
  const currentStep = session.steps.find(s => s.stepNumber === session.currentStep);

  if (!currentStep) {
    throw new Error(`Current step ${session.currentStep} not found`);
  }

  // Collect all scored prompts from all previous steps
  const allScoredPrompts: Prompt[] = [];
  for (const step of session.steps) {
    const scoredInStep = step.prompts.filter(p => p.score !== null);
    allScoredPrompts.push(...scoredInStep);
  }

  // ✅ NEW: Remove duplicate prompts, keeping only the one with highest score
  const uniquePrompts = new Map<string, Prompt>();
  for (const prompt of allScoredPrompts) {
    const existing = uniquePrompts.get(prompt.text);
    if (!existing || (prompt.score || 0) > (existing.score || 0)) {
      uniquePrompts.set(prompt.text, prompt);
    }
  }

  // Sort by score descending and take top X
  const topX = session.config.topX;
  const topPrompts = Array.from(uniquePrompts.values())
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, topX);

  // Reverse to show in ascending order (low to high)
  topPrompts.reverse();

  // Randomly select 3 examples from the test set
  const examples = randomSample(session.testSet, 3);

  // Build meta-prompt with previous results
  // Note: This will be called k times to generate k independent prompts
  let metaPrompt = `I have some texts along with their corresponding scores. The texts are arranged in ascending order based on their scores, where higher scores indicate better quality.

`;

  // Add previous instructions and scores (in ascending order)
  for (const prompt of topPrompts) {
    metaPrompt += `text:\n${prompt.text}\nscore:\n${prompt.score}\n\n`;
  }

  metaPrompt += `The following exemplars show how to apply your text: you replace <INS> in each input with your text, then read the input and give an output. We say your output is wrong if your output is differentfrom the given output, and we say your output is correct if they are the same.

`;

  // Add the random examples
  for (const example of examples) {
    metaPrompt += `Problem:
Q: ${example.question}
A: <INS>
Ground truth answer:
${example.goldAnswer}

`;
  }

  metaPrompt += `Write your new text that is different from the old ones and has a score as high as possible. Write the text in square brackets.
`;

  const newStep: Step = {
    stepNumber: session.currentStep + 1,
    prompts: [],
    metaPrompt,
    createdAt: Date.now(),
  };

  session.steps.push(newStep);
  session.currentStep = newStep.stepNumber;
  updateSession(session);

  return session;
}

/**
 * Get the current step of a session
 */
export function getCurrentStep(session: Session): Step | null {
  return session.steps.find(s => s.stepNumber === session.currentStep) || null;
}

