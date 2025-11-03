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
async function getRandomPrompt(){
  const promptList = [
    "Translate the word problem into a structured representation of quantities and their interactions. Then, execute the necessary mathematical transformations (arithmetic, algebraic, logical) to evolve these quantities to their final state, ensuring each step logically follows from the problem's conditions. Finally, pinpoint the precise answer requested by the question.",
    "First, clearly identify the ultimate question. Then, systematically extract all numerical facts and their relationships, breaking the problem into a sequence of smaller, dependent calculations, solving each step precisely to build towards the final answer.",
    "Treat the problem as a recipe: identify your ingredients (all numerical values with their units), understand the cooking steps (the relationships and operations between them), perform all necessary measurements (unit conversions), then systematically combine them to yield the final dish (the answer).",
    "First, meticulously chart the problem's narrative, pinpointing all initial resources, actions, and the ultimate goal. Then, build a precise, step-by-step mathematical model where each action dynamically updates the relevant quantities, maintaining a continuous record of the 'state' of the problem. Finally, confirm the derived solution directly answers the specific question, ensuring no detail was overlooked or misinterpreted.",
    "Engage as a forensic analyst for numerical mysteries: First, precisely define the central question you must resolve by analyzing the crime scene (the word problem). Next, meticulously collect and catalog all available evidence (numerical facts, variables, units, and their explicit relationships). Then, carefully reconstruct the sequence of events, employing analytical tools (mathematical operations) to connect pieces of evidence and account for any peculiar circumstances or alterations (problem conditions/updates). Finally, synthesize your findings into a definitive report that directly and irrefutably answers the central question.",
    "Act as a Mathematical Cartographer and Analyst: First, meticulously chart your destination by precisely identifying the ultimate question and the expected units of the answer. Then, dissect the problem's landscape: map out all distinct entities, their associated numerical quantities, and the explicit relationships or actions connecting them. Next, construct a detailed dependency map illustrating how each quantity evolves or interacts with others through these connections. Based on this map, plan the most efficient route to your destination, detailing each necessary mathematical operation as a navigational step. Finally, execute this charted course by performing the calculations sequentially, ensuring logical progression at every step, and verify that your final coordinates (the answer) accurately address the original question.",
    "Become a **Mathematical Detective**: First, **examine the scene** by thoroughly understanding the problem and pinpointing the exact question you need to answer. Next, **gather the clues**: meticulously extract all numerical facts, units, and their stated relationships. Then, **build the case** by devising a logical sequence of deductions and calculations—your investigative steps—to connect the clues to the solution. Following this, **interrogate the evidence** by executing the planned operations with precision, ensuring each step logically follows from the problem's conditions. Finally, **present the verdict** by clearly stating the computed answer, confirmed to solve the mystery posed by the problem.",
    "Adopt the role of a Mathematical Mission Commander: Begin by defining the primary objective: clearly state the exact question to be answered. Next, conduct a comprehensive intelligence gathering operation to extract all numerical facts and their established connections. Subsequently, analyze and integrate any situational updates or dynamic changes described in the scenario. Finally, design and meticulously execute a step-by-step operational sequence of calculations and logical deductions to achieve the mission's goal and deliver the definitive answer.",
    "Act as a word-problem architect: First, draw the blueprint by identifying the exact question. Then, gather your materials: all numerical facts and their stated relationships. Next, apply any modifications or updates described in the problem to your materials. Finally, perform the key structural calculation using the final state of materials to build the answer.",
    "Treat the word problem as a blueprint: First, map out all the given numerical components and their interrelations. Then, clearly sketch the final structure you need to build (the answer). Finally, meticulously detail and execute each construction step – from preparing materials (updating quantities) to assembling components (performing calculations) – to perfectly realize the blueprint.",
    "Transform word problems into solutions by becoming a Math Alchemist: First, carefully gather all the numerical facts and relationships presented, treating them as your raw ingredients. Then, clearly define the specific question you need to answer. Finally, strategically combine these ingredients using the correct mathematical operations—your powerful catalysts—to precisely transmute them into the final, accurate result.",
    "Translate the word problem into a structured representation of quantities and their interactions. Then, execute the necessary mathematical transformations (arithmetic, algebraic, logical) to evolve these quantities to their final state, ensuring each step logically follows from the problem's conditions. Finally, pinpoint the precise answer requested by the question.",
    "First, clearly identify the ultimate question. Then, systematically extract all numerical facts and their relationships, breaking the problem into a sequence of smaller, dependent calculations, solving each step precisely to build towards the final answer.",
    "Treat the problem as a recipe: identify your ingredients (all numerical values with their units), understand the cooking steps (the relationships and operations between them), perform all necessary measurements (unit conversions), then systematically combine them to yield the final dish (the answer).",
    "First, meticulously chart the problem's narrative, pinpointing all initial resources, actions, and the ultimate goal. Then, build a precise, step-by-step mathematical model where each action dynamically updates the relevant quantities, maintaining a continuous record of the 'state' of the problem. Finally, confirm the derived solution directly answers the specific question, ensuring no detail was overlooked or misinterpreted.",
    "Engage as a forensic analyst for numerical mysteries: First, precisely define the central question you must resolve by analyzing the crime scene (the word problem). Next, meticulously collect and catalog all available evidence (numerical facts, variables, units, and their explicit relationships). Then, carefully reconstruct the sequence of events, employing analytical tools (mathematical operations) to connect pieces of evidence and account for any peculiar circumstances or alterations (problem conditions/updates). Finally, synthesize your findings into a definitive report that directly and irrefutably answers the central question.",
    "Act as a Mathematical Cartographer and Analyst: First, meticulously chart your destination by precisely identifying the ultimate question and the expected units of the answer. Then, dissect the problem's landscape: map out all distinct entities, their associated numerical quantities, and the explicit relationships or actions connecting them. Next, construct a detailed dependency map illustrating how each quantity evolves or interacts with others through these connections. Based on this map, plan the most efficient route to your destination, detailing each necessary mathematical operation as a navigational step. Finally, execute this charted course by performing the calculations sequentially, ensuring logical progression at every step, and verify that your final coordinates (the answer) accurately address the original question.",
  ]
  //sleep 100-200ms
  return promptList[Math.floor(Math.random() * promptList.length)];
}
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
      // const response = await GenAI.models.generateContent({
      //   model,
      //   contents: metaPrompt,
      //   config,
      // });
      const response = {
        text: await getRandomPrompt(),
        usageMetadata: {
          promptTokenCount: Math.floor(Math.random() * 100 + 50),
          candidatesTokenCount: Math.floor(Math.random() * 50 + 20),
        }
      };
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
      // const response = await GenAI.models.generateContent({
      //   model,
      //   contents: fullPrompt,
      //   config,
      // });
      const response = {
        text: await getRandomPrompt(),
        usageMetadata: {
          promptTokenCount: Math.floor(Math.random() * 100 + 50),
          candidatesTokenCount: Math.floor(Math.random() * 50 + 20),
        },
      };
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
        if (Math.random() < 0.7) { // Mock correctness check
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

