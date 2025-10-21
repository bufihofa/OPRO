import type { Session, Step, Prompt, OPROConfig } from '../types/opro';

const SESSIONS_KEY = 'opro_sessions';

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
 */
function createInitialMetaPrompt(k: number): string {
  return `Your task is to generate ${k} different instructions <INS> for solving math word problems.

Below are some example problems:

Problem:
Q: Alannah, Beatrix, and Queen are preparing for the new school year and have been given books by their parents. Alannah has 20 more books than Beatrix. Queen has 1/5 times more books than Alannah. If Beatrix has 30 books, how many books do the three have together?
A: <INS>
Ground truth answer:
140

Problem:
Q: Natalia sold clips to 48 of her friends in April, and then she sold half as many clips in May. How many clips did Natalia sell altogether in April and May?
A: <INS>
Ground truth answer:
72

Problem:
Q: Weng earns $12 an hour for babysitting. Yesterday, she just did 50 minutes of babysitting. How much did she earn?
A: <INS>
Ground truth answer:
10

Generate ${k} different instructions that could help solve these types of math word problems. Each instruction should begin with <INS> and end with </INS>. Make the instructions diverse and creative.`;
}

/**
 * Create a new session
 */
export function createSession(name: string, config: OPROConfig): Session {
  const sessionId = generateId();
  const now = Date.now();
  
  const initialMetaPrompt = createInitialMetaPrompt(config.k);
  
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
export function createNextStep(session: Session, k: number): Session {
  const currentStep = session.steps.find(s => s.stepNumber === session.currentStep);
  
  if (!currentStep) {
    throw new Error(`Current step ${session.currentStep} not found`);
  }
  
  // Sort prompts by score in descending order
  const sortedPrompts = [...currentStep.prompts]
    .filter(p => p.score !== null)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  
  // Build meta-prompt with previous results
  let metaPrompt = `Your task is to generate ${k} different instructions <INS> for solving math word problems.

Below are some previous instructions with their scores. The score ranges from 0 to 100.

`;
  
  // Add previous instructions and scores
  for (const prompt of sortedPrompts) {
    metaPrompt += `text:\n${prompt.text}\nscore:\n${prompt.score}\n\n`;
  }
  
  metaPrompt += `Below are some example problems:

Problem:
Q: Alannah, Beatrix, and Queen are preparing for the new school year and have been given books by their parents. Alannah has 20 more books than Beatrix. Queen has 1/5 times more books than Alannah. If Beatrix has 30 books, how many books do the three have together?
A: <INS>
Ground truth answer:
140

Problem:
Q: Natalia sold clips to 48 of her friends in April, and then she sold half as many clips in May. How many clips did Natalia sell altogether in April and May?
A: <INS>
Ground truth answer:
72

Problem:
Q: Weng earns $12 an hour for babysitting. Yesterday, she just did 50 minutes of babysitting. How much did she earn?
A: <INS>
Ground truth answer:
10

Generate ${k} instructions that are different from all the instructions <INS> above, and have a higher score than all the instructions <INS> above. Each instruction should begin with <INS> and end with </INS>. Make the instructions diverse and creative.`;
  
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

