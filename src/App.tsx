import { readTSVFile } from './utils/tsvReader';
import { Score } from './api/gsm';
import { useEffect, useState } from 'react';

function App() {
    const [totalQuestions, setTotalQuestions] = useState<number>(0);
    const [correctCount, setCorrectCount] = useState<number>(0);
    const [inCorrectCount, setInCorrectCount] = useState<number>(0);
    const [totalInputTokens, setTotalInputTokens] = useState<number>(localStorage.getItem('totalInputTokens') ? Number(localStorage.getItem('totalInputTokens')) : 0);
    const [totalOutputTokens, setTotalOutputTokens] = useState<number>(localStorage.getItem('totalOutputTokens') ? Number(localStorage.getItem('totalOutputTokens')) : 0);
    const [totalRequests, setTotalRequests] = useState<number>(localStorage.getItem('totalRequests') ? Number(localStorage.getItem('totalRequests')) : 0);
    
    // Keep console and localStorage in sync with the latest totals
    useEffect(() => {
        console.log("totalInputTokens:", totalInputTokens);
        console.log("totalOutputTokens:", totalOutputTokens);
        console.log("totalRequests:", totalRequests);
        localStorage.setItem('totalInputTokens', totalInputTokens.toString());
        localStorage.setItem('totalOutputTokens', totalOutputTokens.toString());
        localStorage.setItem('totalRequests', totalRequests.toString());
    }, [totalRequests]);
    
    const updateProgress = (status: boolean) => {
        console.log(status);
        if (status) {
            setCorrectCount(prev => prev + 1);
        } else {
            setInCorrectCount(prev => prev + 1);
        }
    }
    const updateRequest = (inputTokens: number, outputTokens: number) => {
        setTotalInputTokens(prev => prev + inputTokens);
        setTotalOutputTokens(prev => prev + outputTokens);
        setTotalRequests(prev => prev + 1);
    }

    const handleReadGsmTest = () => {
        readTSVFile('gsm_test.tsv')
        .then(async data => {
            setTotalQuestions(data.length);
            setCorrectCount(0);
            setInCorrectCount(0);
            await Score("Hãy giải bài toán sau: ", data, 0, 'gemini-2.0-flash-lite', updateProgress, updateRequest);
            console.log("DONE");
        })
        .catch(error => {
            console.error('Error reading gsm_test:', error);
        });
    };

    return (
        <div>
            <p>Correct: {correctCount}</p>
            <p>Incorrect: {inCorrectCount}</p>
            <p>Progress: {totalQuestions > 0 ? ((correctCount + inCorrectCount) / totalQuestions * 100).toFixed(2) : 0}%</p>
            <p>Accuracy: {correctCount + inCorrectCount > 0 ? ((correctCount) / (correctCount + inCorrectCount) * 100).toFixed(2) : 0}%</p>
            <p>Total input tokens: {totalInputTokens}</p>
            <p>Total output tokens: {totalOutputTokens}</p>
            <p>Total requests: {totalRequests}</p>
            <p>Total cost: {totalInputTokens / 1000000 * 0.1 + totalOutputTokens / 1000000 * 0.4}</p>
            <button onClick={handleReadGsmTest}>Read gsm_test</button>
        </div>
    );
}

export default App;