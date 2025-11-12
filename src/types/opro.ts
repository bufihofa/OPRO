/**
 * State of a prompt in the OPRO optimization process
 */
export type PromptState = 'pending' | 'scoring' | 'scored';

/**
 * A single prompt with its score and state
 */
export interface Prompt {
  id: string;
  text: string;
  score: number | null;
  state: PromptState;
  createdAt: number;
}

/**
 * A step in the OPRO optimization process
 */
export interface Step {
  stepNumber: number;
  prompts: Prompt[];
}

/**
 * A question-answer pair from the test dataset
 */
export interface QuestionAnswer {
  question: string;
  goldAnswer: number;
}

/**
 * Configuration for OPRO optimization
 */
export interface OPROConfig {
  k: number; // Number of prompts to generate per step
  topX: number; // Number of top-scoring prompts to include in meta-prompt
  optimizerModel: string; // Model to use for generating prompts
  optimizerTemperature: number; // Temperature for prompt generation
  scorerModel: string; // Model to use for scoring prompts
  scorerTemperature: number; // Temperature for scoring prompts
}

/**
 * A complete OPRO session
 */
export interface Session {
  id: string;
  name: string;
  currentStep: number;
  steps: Step[];
  config: OPROConfig;
  createdAt: number;
  updatedAt: number;
}
