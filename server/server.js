import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import OpenAI from 'openai'
import sqlite from 'sqlite3'
import { open } from 'sqlite'
const app = express()

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

app.use(cors())
app.use(express.json())

// Khởi tạo và mở database SQLite
let db;
(async () => {
  db = await open({
    filename: './chat_results.db',
    driver: sqlite.Database
  });

  // Tạo bảng nếu chưa tồn tại
  await db.run(`
    CREATE TABLE IF NOT EXISTS chat_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT,
      answer TEXT,
      solve TEXT,
      tokenInput INTEGER,
      tokenOutput INTEGER,
      tokenTotal INTEGER,
      moneyEstimate REAL,
      raw_result TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
})();

app.post('/api/chat', async (req, res) => {
  try {
    const now = new Date();
    console.log('start process:', now);
    const response = await openai.responses.create(req.body);
    console.log('time to process:', now, new Date() - now + 'ms');
    let result = {};
    if (
      response &&
      response.output !== undefined &&
      response.output[0] !== undefined &&
      response.output[0].content !== undefined &&
      response.output[0].content[0] !== undefined &&
      response.output[0].content[0].text !== undefined
    ) {
      let resData = JSON.parse(response.output[0].content[0].text);
      result = {
        question: req.body.input[0].content[0].text,
        answer: resData.answer,
        solve: resData.solve,
        tokenInput: response.usage.input_tokens,
        tokenOutput: response.usage.output_tokens,
        tokenTotal: response.usage.total_tokens,
        moneyEstimate:
          response.usage.input_tokens * 0.0000001 +
          response.usage.output_tokens * 0.0000004,
      };

      // Lưu vào database
      if (db) {
        await db.run(
          `INSERT INTO chat_results 
            (question, answer, solve, tokenInput, tokenOutput, tokenTotal, moneyEstimate, raw_result) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            result.question,
            result.answer,
            result.solve,
            result.tokenInput,
            result.tokenOutput,
            result.tokenTotal,
            result.moneyEstimate,
            JSON.stringify(result),
          ]
        );

        // Truy vấn tổng các trường
        const totals = await db.get(`
          SELECT 
            COUNT(*) as totalAnswer,
            SUM(tokenInput) as totalTokenInput,
            SUM(tokenOutput) as totalTokenOutput,
            SUM(tokenTotal) as totalTokenTotal,
            SUM(moneyEstimate) as totalMoneyEstimate
          FROM chat_results
        `);

        // Thêm vào result
        result.totalAnswer = totals.totalAnswer || 0;
        result.totalTokenInput = totals.totalTokenInput || 0;
        result.totalTokenOutput = totals.totalTokenOutput || 0;
        result.totalTokenTotal = totals.totalTokenTotal || 0;
        result.totalMoneyEstimate = totals.totalMoneyEstimate*26500 || 0;
      }
    } else {
      result = response;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat/bulk', async (req, res) => {
  try {
    const { count = 200, requestBody } = req.body;
    const results = [];
    
    console.log(`Starting bulk process: ${count} requests`);
    const startTime = new Date();
    
    // Xử lý song song với Promise.all
    const promises = Array(count).fill(null).map(async (_, index) => {
      try {
        const response = await openai.responses.create(requestBody);
        
        let result = {};
        if (
          response?.output?.[0]?.content?.[0]?.text
        ) {
          let resData = JSON.parse(response.output[0].content[0].text);
          result = {
            index: index + 1,
            question: requestBody.input[0].content[0].text,
            answer: resData.answer,
            solve: resData.solve,
            tokenInput: response.usage.input_tokens,
            tokenOutput: response.usage.output_tokens,
            tokenTotal: response.usage.total_tokens,
            moneyEstimate:
              response.usage.input_tokens * 0.0000001 +
              response.usage.output_tokens * 0.0000004,
          };

          // Lưu vào database
          if (db) {
            await db.run(
              `INSERT INTO chat_results 
                (question, answer, solve, tokenInput, tokenOutput, tokenTotal, moneyEstimate, raw_result) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                result.question,
                result.answer,
                result.solve,
                result.tokenInput,
                result.tokenOutput,
                result.tokenTotal,
                result.moneyEstimate,
                JSON.stringify(result),
              ]
            );
          }
        }
        return result;
      } catch (error) {
        console.error(`Error in request ${index + 1}:`, error.message);
        return { index: index + 1, error: error.message };
      }
    });

    const allResults = await Promise.all(promises);
    
    // Tính tổng
    if (db) {
      const totals = await db.get(`
        SELECT 
          COUNT(*) as totalAnswer,
          SUM(tokenInput) as totalTokenInput,
          SUM(tokenOutput) as totalTokenOutput,
          SUM(tokenTotal) as totalTokenTotal,
          SUM(moneyEstimate) as totalMoneyEstimate
        FROM chat_results
      `);

      const endTime = new Date();
      const duration = endTime - startTime;

      res.json({
        success: true,
        count: allResults.length,
        duration: `${duration}ms`,
        results: allResults,
        totals: {
          totalAnswer: totals.totalAnswer || 0,
          totalTokenInput: totals.totalTokenInput || 0,
          totalTokenOutput: totals.totalTokenOutput || 0,
          totalTokenTotal: totals.totalTokenTotal || 0,
          totalMoneyEstimate: (totals.totalMoneyEstimate * 26500) || 0,
        }
      });
    } else {
      res.json({
        success: true,
        count: allResults.length,
        results: allResults
      });
    }
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chat/bulk-stream', async (req, res) => {
  const { count = 200, requestBody } = req.body;
  
  // Thiết lập SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  console.log(`Starting bulk process: ${count} requests`);
  const startTime = new Date();
  let completedCount = 0;
  
  try {
    // Xử lý song song với Promise.all
    const promises = Array(count).fill(null).map(async (_, index) => {
      try {
        const response = await openai.responses.create(requestBody);
        if(!response) throw new Error('No response from OpenAI');
        let result = {};
        if (response?.output?.[0]?.content?.[0]?.text) {
          let resData = JSON.parse(response.output[0].content[0].text);
          result = {
            index: index + 1,
            question: requestBody.input[0].content[0].text,
            answer: resData.answer,
            solve: resData.solve,
            tokenInput: response.usage.input_tokens,
            tokenOutput: response.usage.output_tokens,
            tokenTotal: response.usage.total_tokens,
            moneyEstimate:
              response.usage.input_tokens * 0.0000001 +
              response.usage.output_tokens * 0.0000004,
          };

          // Lưu vào database
          if (db) {
            await db.run(
              `INSERT INTO chat_results 
                (question, answer, solve, tokenInput, tokenOutput, tokenTotal, moneyEstimate, raw_result) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                result.question,
                result.answer,
                result.solve,
                result.tokenInput,
                result.tokenOutput,
                result.tokenTotal,
                result.moneyEstimate,
                JSON.stringify(result),
              ]
            );
          }
        }
        
        completedCount++;
        
        // Gửi progress update đến client
        res.write(`data: ${JSON.stringify({
          type: 'progress',
          completed: completedCount,
          total: count,
          result: result
        })}\n\n`);
        
        return result;
      } catch (error) {
        console.error(`Error in request ${index + 1}:`, error.message);
        
        res.write(`data: ${JSON.stringify({
          type: 'error',
          index: index + 1,
          error: error.message
        })}\n\n`);
        
        return { index: index + 1, error: error.message };
      }
    });

    const allResults = await Promise.all(promises);
    
    // Tính tổng và gửi kết quả cuối cùng
    if (db) {
      const totals = await db.get(`
        SELECT 
          COUNT(*) as totalAnswer,
          SUM(tokenInput) as totalTokenInput,
          SUM(tokenOutput) as totalTokenOutput,
          SUM(tokenTotal) as totalTokenTotal,
          SUM(moneyEstimate) as totalMoneyEstimate
        FROM chat_results
      `);

      const endTime = new Date();
      const duration = endTime - startTime;

      res.write(`data: ${JSON.stringify({
        type: 'complete',
        success: true,
        count: allResults.length,
        duration: `${duration}ms`,
        totals: {
          totalAnswer: totals.totalAnswer || 0,
          totalTokenInput: totals.totalTokenInput || 0,
          totalTokenOutput: totals.totalTokenOutput || 0,
          totalTokenTotal: totals.totalTokenTotal || 0,
          totalMoneyEstimate: (totals.totalMoneyEstimate * 26500) || 0,
        }
      })}\n\n`);
    }
    
    res.end();
    
  } catch (error) {
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message
    })}\n\n`);
    res.end();
  }
});

app.listen(3001, () => console.log('Proxy server running on port 3001'))