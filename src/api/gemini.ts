import type { QuestionAnswer } from "../utils/tsvReader";

export async function generatePrompts(
    metaPrompt: string, 
    k: number,
    temperature: number,
    model: string
): Promise<string[]> {
    // fetch API from localhost:3000/api/generate

    const response = await fetch('http://localhost:3000/api/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            metaPrompt,
            k,
            temperature,
            model
        })
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.prompts; // Assuming the response contains an array of prompts in 'prompts' key

}

export async function scorePrompt(
    prompt: string,
    questions: QuestionAnswer[],
    temperature: number,
    model: string
): Promise<number> {
    const response = await fetch('http://localhost:3000/api/score', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            prompt,
            questions,
            temperature,
            model
        })
    });
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.accuracy; 
}