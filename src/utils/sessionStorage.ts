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
  if (!sessionsJson) {
    return [];
  }
  try {
    return JSON.parse(sessionsJson);
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
 */
function createInitialMetaPrompt(testSet: QuestionAnswer[]): string {
  // Randomly select 3 examples from the test set
  const examples = randomSample(testSet, 3);

  let metaPrompt = `Your task is to generate a single instruction <INS> for solving math word problems.

Below are some example problems:

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

  metaPrompt += `Generate one instruction that could help solve these types of math word problems. The instruction should begin with <INS> and end with </INS>. Make the instruction creative and effective.`;

  return metaPrompt;
}

/**
 * Create a new session
 */
export function createSession(name: string, config: OPROConfig, testSet: QuestionAnswer[]): Session {
  const sessionId = generateId();
  const now = Date.now();

  const initialMetaPrompt = createInitialMetaPrompt(testSet);

  const session: Session = {
    id: sessionId,
    name,
    currentStep: 1,
    steps: [{
      stepNumber: 1,
      prompts: [],
      metaPrompt: initialMetaPrompt,
      createdAt: now,
    }],
    config,
    testSet,
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

  // Sort by score descending and take top X
  const topX = session.config.topX;
  const topPrompts = [...allScoredPrompts]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, topX);

  // Reverse to show in ascending order (low to high)
  topPrompts.reverse();

  // Randomly select 3 examples from the test set
  const examples = randomSample(session.testSet, 3);

  // Build meta-prompt with previous results
  // Note: This will be called k times to generate k independent prompts
  let metaPrompt = `Your task is to generate a single instruction <INS> for solving math word problems.

Below are some previous instructions with their scores. The score ranges from 0 to 100.

`;

  // Add previous instructions and scores (in ascending order)
  for (const prompt of topPrompts) {
    metaPrompt += `text:\n${prompt.text}\nscore:\n${prompt.score}\n\n`;
  }

  metaPrompt += `Below are some example problems:

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

  metaPrompt += `Generate one instruction that is different from all the instructions <INS> above, and has a higher score than all the instructions <INS> above. The instruction should begin with <INS> and end with </INS>. Make the instruction creative and effective.`;

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

