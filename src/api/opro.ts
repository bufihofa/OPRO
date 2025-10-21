import { GoogleGenAI, Type } from '@google/genai';
import type { QuestionAnswer } from '../utils/tsvReader';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

if (!API_KEY) {
  throw new Error("VITE_GEMINI_API_KEY is not set. Please create a .env.local file and add it.");
}

const GenAI = new GoogleGenAI({
  apiKey: API_KEY,
});

/**
 * Response from the optimizer LLM (generates new prompts)
 */
export interface OptimizerResponse {
  prompts: string[];
}

/**
 * Response from the scorer LLM (evaluates a prompt)
 */
export interface ScorerResponse {
  solve: string;
  answer: number;
}

/**
 * Call Gemini to generate new prompts (Optimizer)
 */
export async function generatePrompts(
  metaPrompt: string,
  k: number,
  temperature: number,
  model: string,
  updateRequest: (inputTokens: number, outputTokens: number) => void
): Promise<string[]> {
  let attempt = 0;
  const retries = 3;
  
  const config = {
    maxOutputTokens: 2048,
    temperature,
    thinkingConfig: {
      thinkingBudget: 0,
    },
  };

  while (attempt < retries) {
    try {
      const response = await GenAI.models.generateContent({
        model,
        contents: metaPrompt,
        config,
      });

      const text = response.text;
      updateRequest(
        response.usageMetadata?.promptTokenCount || 0,
        response.usageMetadata?.candidatesTokenCount || 0
      );

      if (!text) {
        throw new Error('Empty response from LLM');
      }

      // Extract prompts between <INS> and </INS> tags
      const insRegex = /<INS>([\s\S]*?)<\/INS>/g;
      const matches = [...text.matchAll(insRegex)];
      const prompts = matches.map(match => match[1].trim());

      if (prompts.length === 0) {
        console.warn('No prompts found in response, trying to parse as plain text');
        // Fallback: split by newlines and filter empty lines
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        return lines.slice(0, k);
      }

      return prompts.slice(0, k);
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed for optimizer:`, error);
      attempt++;
      if (attempt >= retries) {
        throw new Error(`Failed to generate prompts after ${retries} attempts`);
      }
      await new Promise(res => setTimeout(res, 1000 * attempt * attempt));
    }
  }

  throw new Error('Failed to generate prompts');
}

/**
 * Call Gemini to evaluate a single question with a prompt (Scorer)
 */
async function callGeminiWithRetry(
  fullPrompt: string,
  temperature: number,
  model: string,
  updateRequest: (inputTokens: number, outputTokens: number) => void
): Promise<ScorerResponse> {
  let attempt = 0;
  const retries = 3;
  
  const config = {
    maxOutputTokens: 1024,
    temperature,
    thinkingConfig: {
      thinkingBudget: 0,
    },
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      required: ["solve", "answer"],
      properties: {
        solve: {
          type: Type.STRING,
        },
        answer: {
          type: Type.NUMBER,
        },
      },
    },
  };

  while (attempt < retries) {
    try {
      const response = await GenAI.models.generateContent({
        model,
        contents: fullPrompt,
        config,
      });

      const text = response.text;
      updateRequest(
        response.usageMetadata?.promptTokenCount || 0,
        response.usageMetadata?.candidatesTokenCount || 0
      );

      if (!text) {
        return { solve: '', answer: -1 };
      }

      try {
        return JSON.parse(text);
      } catch (error) {
        console.error(`Invalid JSON: ${text}`);
        return { solve: '', answer: -1 };
      }
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed for prompt: "${fullPrompt.substring(0, 50)}..."`, error);
      attempt++;
      if (attempt >= retries) {
        return { solve: '', answer: -1 };
      }
      await new Promise(res => setTimeout(res, 1000 * attempt * attempt));
    }
  }

  return { solve: '', answer: -1 };
}

/**
 * Score a prompt against a test set
 * Returns accuracy as a percentage (0-100)
 */
export async function scorePrompt(
  prompt: string,
  questions: QuestionAnswer[],
  temperature: number,
  model: string,
  updateProgress: (status: boolean) => void,
  updateRequest: (inputTokens: number, outputTokens: number) => void
): Promise<number> {
  let score = 0;

  const promises = questions.map(question => {
    const fullPrompt = prompt + '\n\n' + question.question;
    return callGeminiWithRetry(fullPrompt, temperature, model, updateRequest)
      .then(response => {
        if (response.answer === question.goldAnswer) {
          score++;
          updateProgress(true);
        } else {
          updateProgress(false);
        }
        return response;
      })
      .catch(error => {
        console.error(`Final failure for question "${question.question}":`, error);
        updateProgress(false);
        return null;
      });
  });

  await Promise.all(promises);

  const accuracy = (score / questions.length) * 100;
  console.log('Score:', score, '/', questions.length);
  console.log('Accuracy:', accuracy.toFixed(2), '%');

  return accuracy;
}

