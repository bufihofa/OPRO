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
  answer: number;
}

/**
 * Call Gemini once to generate a single prompt (Optimizer)
 */
async function generateSinglePrompt(
  metaPrompt: string,
  temperature: number,
  model: string,
  updateRequest: (inputTokens: number, outputTokens: number) => void
): Promise<string> {
  let attempt = 0;
  const retries = 3;

  const config = {
    maxOutputTokens: 40960,
    temperature,
    thinkingConfig: {
      thinkingBudget: 20480,
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

      // Extract prompt between <INS> and </INS> tags
      const insRegex = /<INS>([\s\S]*?)<\/INS>/;
      const match = text.match(insRegex);

      if (match && match[1]) {
        return match[1].trim();
      }

      // Fallback: return the entire text if no tags found
      console.warn('No <INS> tags found in response, using entire text');
      return text.trim();
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed for optimizer:`, error);
      attempt++;
      if (attempt >= retries) {
        throw new Error(`Failed to generate prompt after ${retries} attempts`);
      }
      await new Promise(res => setTimeout(res, 1000 * attempt * attempt));
    }
  }

  throw new Error('Failed to generate prompt');
}

/**
 * Call Gemini k times to generate k prompts (Optimizer)
 * Each prompt is generated independently with a separate API call
 * All k API calls are executed in parallel using Promise.all()
 */
export async function generatePrompts(
  metaPrompt: string,
  k: number,
  temperature: number,
  model: string,
  updateRequest: (inputTokens: number, outputTokens: number) => void
): Promise<string[]> {
  console.log(`Generating ${k} prompts in parallel with ${k} separate API calls...`);

  // Create k promises for parallel execution
  const promptPromises = Array.from({ length: k }, (_, i) => {
    console.log(`Starting prompt generation ${i + 1}/${k}...`);
    return generateSinglePrompt(metaPrompt, temperature, model, updateRequest)
      .then(prompt => {
        console.log(`Successfully generated prompt ${i + 1}/${k}`);
        return prompt;
      })
      .catch(error => {
        console.error(`Failed to generate prompt ${i + 1}/${k}:`, error);
        throw new Error(`Failed to generate prompt ${i + 1}/${k}: ${error}`);
      });
  });

  // Execute all k API calls in parallel
  const prompts = await Promise.all(promptPromises);

  console.log(`Successfully generated all ${k} prompts in parallel`);
  return prompts;
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
      required: ["sort_solve", "answer"],
      properties: {
        sort_solve: {
          type: Type.STRING,
          description: "Shortest solve for the question",
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
        return { answer: -1 };
      }

      try {
        const res = JSON.parse(text);
        return { answer: res.answer };
      } catch (error) {
        console.error(`Invalid JSON: ${text}`);
        return { answer: -1 };
      }
    } catch (error) {
      console.error(`Attempt ${attempt + 1} failed for prompt: "${fullPrompt.substring(0, 50)}..."`, error);
      attempt++;
      if (attempt >= retries) {
        return { answer: -1 };
      }
      await new Promise(res => setTimeout(res, 1000 * attempt * attempt));
    }
  }

  return { answer: -1 };
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

