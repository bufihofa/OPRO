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
  metaPrompt: string;
  createdAt: number;
}

/**
 * Configuration for OPRO optimization
 */
export interface OPROConfig {
  k: number; // Number of prompts to generate per step
  temperature: number; // Temperature for LLM generation
  model: string; // Model to use for optimization
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

/**
 * Options for automation
 */
export interface AutomationOptions {
  autoScore: boolean;
  autoNextStep: boolean;
}

