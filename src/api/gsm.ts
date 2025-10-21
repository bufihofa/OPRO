import {
  GoogleGenAI,
  Type,
} from '@google/genai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
console.log('API_KEY: ', API_KEY);
if (!API_KEY) {
  throw new Error("VITE_GEMINI_API_KEY is not set. Please create a .env.local file and add it.");
}

export interface GeminiResponse {
  solve: string;
  answer: number;
}

const GenAI = new GoogleGenAI({
    apiKey: API_KEY,
});


async function callGeminiWithRetry(fullPrompt: string, temperature: number = 0, model: string = 'gemini-2.5-flash-lite', updateRequest: (inputTokens: number, outputTokens: number) => void): Promise<GeminiResponse> {
    let attempt = 0;
    let retries = 3;
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

    const contents = fullPrompt;

    while (attempt < retries) {
        try {
        const response = await GenAI.models.generateContent({
            model,
            contents,
            config
        });

        const text = response.text;
        updateRequest(response.usageMetadata?.promptTokenCount || 0, response.usageMetadata?.candidatesTokenCount || 0);
        if (!text) {
            return { solve: '', answer: -1 };
        }
        try {
            return JSON.parse(text);
        }
        catch (error) {
            console.error(`Invalid JSON: ${text}`);
            return { solve: '', answer: -1 };
        }
        } catch (error) {
            console.error(`Attempt ${attempt + 1} failed for prompt: "${fullPrompt.substring(0, 50)}..."`, error);
            attempt++;
            if (attempt >= retries) {
                return { solve: '', answer: -1 };
            }
            await new Promise(res => setTimeout(res, 1000 * attempt*attempt));
        }
    }
    return { solve: '', answer: -1 };
}


export async function Score(prompt: string, questions: any[], temperature: number = 0, model: string = 'gemini-2.5-flash-lite', updateProgress: (status: boolean) => void, updateRequest: (inputTokens: number, outputTokens: number) => void): Promise<number> {
    
    let score = 0;
    const promises = questions.map(question => {
        const fullPrompt = prompt + question.question;
        return callGeminiWithRetry(fullPrompt, temperature, model, updateRequest)
            .then(response => {
                if (response.answer === question.goldAnswer) {
                    score++;
                    updateProgress(true)
                }
                else {
                    updateProgress(false)
                }
                return response;
            }).catch(error => {
            console.error(`Final failure for question "${question.question}":`, error);
            return null; 
        });
    });
    await Promise.all(promises);
    const accuracy = score / questions.length;
    console.log('total score: ', score, "/", questions.length);
    console.log('accuracy: ', accuracy * 100, '%');
    return accuracy;
}
