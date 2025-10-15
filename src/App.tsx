import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'

interface Result {
  index: number
  answer: number
  solve: string
  tokenInput: number
  tokenOutput: number
  tokenTotal: number
  moneyEstimate: number
}

function App() {
  const [count, setCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const [totals, setTotals] = useState<any>(null)
  const [duration, setDuration] = useState<string>('')

  const handleClick = async () => {
    setIsLoading(true)
    setCount(0)
    setTotal(200)
    setResults([])
    setTotals(null)
    setDuration('')
    
    try {
      const response = await fetch('http://localhost:3001/api/chat/bulk-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          count: 200,
          requestBody: {
            model: "gpt-4.1-nano",
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: "Peter plans to go to the movies this week. He always gets a ticket for $7 and popcorn for $7. If he has 42 dollars for the week, how many times can he go to the movies?"
                  }
                ]
              }
            ],
            text: {
              format: {
                type: "json_schema",
                name: "math_response",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    solve: {
                      type: "string"
                    },
                    answer: {
                      type: "number"
                    }
                  },
                  required: [
                    "solve",
                    "answer"
                  ],
                  additionalProperties: false
                }
              }
            },
            reasoning: {},
            tools: [],
            temperature: 0,
            max_output_tokens: 256,
            top_p: 0,
          }
        })
      })

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('No reader available')
      }

      while (true) {
        const { done, value } = await reader.read()
        
        if (done) {
          break
        }

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              
              if (data.type === 'progress') {
                setCount(data.completed)
                setResults(prev => [...prev, data.result])
              } else if (data.type === 'complete') {
                setTotals(data.totals)
                setDuration(data.duration)
              } else if (data.type === 'error') {
                console.error('Error:', data.error)
              }
            } catch (e) {
              console.error('Parse error:', e)
            }
          }
        }
      }
      
    } catch (error) {
      console.error('Error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <div>
        <a href="https://vite.dev" target="_blank">
          <img src={viteLogo} className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>Vite + React</h1>
      <div className="card">
        <button onClick={handleClick} disabled={isLoading}>
          {isLoading ? `Processing... ${count}/${total}` : `Send 200 Requests`}
        </button>
        
        {isLoading && (
          <div style={{ marginTop: '20px' }}>
            <progress value={count} max={total} style={{ width: '100%' }} />
            <p>{count}/{total} requests completed</p>
          </div>
        )}
        
        {totals && (
          <div style={{ marginTop: '20px', textAlign: 'left' }}>
            <p>✅ Completed: {count} requests</p>
            <p>⏱️ Duration: {duration}</p>
            <p>💰 Total Cost: {totals.totalMoneyEstimate.toFixed(2)} VND</p>
            <p>📊 Total Tokens: {totals.totalTokenTotal}</p>
          </div>
        )}
        
        {results.length > 0 && (
          <div style={{ marginTop: '20px', maxHeight: '300px', overflow: 'auto', textAlign: 'left' }}>
            <h3>Latest Results:</h3>
            {results.slice(-5).reverse().map((result, idx) => (
              <div key={idx} style={{ marginBottom: '10px', padding: '10px', border: '1px solid #ccc', borderRadius: '5px' }}>
                <p><strong>#{result.index}</strong> - Answer: {result.answer}</p>
                <p style={{ fontSize: '0.9em', color: '#666' }}>Tokens: {result.tokenTotal}</p>
              </div>
            ))}
          </div>
        )}
        
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
