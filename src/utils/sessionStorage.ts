import type { Session, Step, Prompt, OPROConfig, QuestionAnswer } from '../types/opro';

const SESSIONS_KEY = 'opro_sessions';
function randomSample<T>(array: T[], n: number): T[] {
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, array.length));
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function getAllSessions(): Session[] {
  const sessionsJson = localStorage.getItem(SESSIONS_KEY);
  if (!sessionsJson) return [];
  try {
    const sessions = JSON.parse(sessionsJson);
    return sessions;
  } catch (error) {
    console.error('Error parsing sessions from localStorage:', error);
    return [];
  }
}

function saveAllSessions(sessions: Session[]): void {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export function getSession(sessionId: string): Session | null {
  const sessions = getAllSessions();
  return sessions.find(s => s.id === sessionId) || null;
}

export function generateMetaPrompt(session: Session, testSet: QuestionAnswer[]): string {
  if (session.currentStep === 0) {
    return createInitialMetaPrompt(testSet, session.config.k);
  } else {
    return createCurrentMetaPrompt(session, testSet, session.config.k);
  }
}

function createInitialMetaPrompt(testSet: QuestionAnswer[], k: number = 4): string {
  // Randomly select 3 examples from the test set
  const examples = randomSample(testSet, 3);

  let metaPrompt = 
`Your task is to generate an instruction that will be prepended to a question to guide a language model to solve it correctly.

The following exemplars show how your instruction should be applied: you replace <INS> in each input with your instruction, then read the input and give an output.

`;

  // Add the random examples
  for (const example of examples) {
    metaPrompt += 
`Problem:
Q: <INS> ${example.question}
Ground truth answer:
${example.goldAnswer}

`;
  }

  metaPrompt += 
`Write ${k} new instructions that will help solve similar problems correctly. The instruction should be clear, concise, and encourage step-by-step reasoning. 
`;

  return metaPrompt;
}

function createCurrentMetaPrompt(session: Session, testSet: QuestionAnswer[], k: number = 4): string {
  // Collect all scored prompts from all previous steps
  const allScoredPrompts: Prompt[] = [];
  for (const step of session.steps) {
    const scoredInStep = step.prompts.filter(p => p.score !== null);
    allScoredPrompts.push(...scoredInStep);
  }

  // Remove duplicate prompts, keeping only the one with highest score
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

  

  let metaPrompt = 
`Your task is to generate ${session.config.k} answer starting sentence <Start> to enhance precision in solving diverse grade school math problems. Scores range from 0 to 100 (higher is better). Below are previous starting sentences with their precision scores, sorted ascending.

`;

  // Add previous instructions and scores (in ascending order)
  for (const prompt of topPrompts) {
    metaPrompt += `Precision: ${prompt.score} <Start>${prompt.text}</Start>\n`;
  }

  metaPrompt += 
`Below are exemplar problems. Apply your <Start> sentence at the beginning of the answer.

`;

  // Randomly select 3 examples from the test set
  const examples = randomSample(testSet, 3);

  // Add the random examples
  for (const example of examples) {
    metaPrompt += 
`Problem: ${example.question} <Start> Ground truth: ${example.goldAnswer}
`;
  }

  metaPrompt += 
`Generate ${session.config.k} new starting sentences that strictly adhere to the structure and vocabulary of the top-scoring examples above. The new sentences should be nearly identical to the best ones, to achieve even higher precision. 

`;

  return metaPrompt;
}
/**
 * Create a new session
 */
export function createSession(name: string, config: OPROConfig): Session {
  const sessionId = generateId();
  const now = Date.now();

  const session: Session = {
    id: sessionId,
    name,
    currentStep: 0,
    steps: [
      {
        stepNumber: 0,
        prompts: []
      }
    ],
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
export function createNextStep(session: Session): Session {
  const currentStep = session.steps.find(s => s.stepNumber === session.currentStep);

  if (!currentStep) {
    throw new Error(`Current step ${session.currentStep} not found`);
  }

  const newStep: Step = {
    stepNumber: session.currentStep + 1,
    prompts: []
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

