# OPRO Usage Guide

This guide provides detailed instructions on how to use the OPRO application effectively.

## Getting Started

### Prerequisites
- Node.js installed (v18 or higher recommended)
- A Google Gemini API key
- Basic understanding of prompt engineering

### Initial Setup

1. Clone the repository and navigate to the project directory
2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env.local` file in the root directory:
   ```
   VITE_GEMINI_API_KEY=your_actual_api_key_here
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open your browser to `http://localhost:5173/`

## Creating Your First Session

1. **Click "Create New Session"** on the main page

2. **Configure your session:**
   - **Session Name**: Give it a descriptive name (e.g., "GSM8K Optimization Run 1")
   - **k (Number of prompts per step)**: Start with 3-5 for testing, use 8-10 for serious optimization
   - **Temperature**: 
     - Use 0.7-1.0 for diverse, creative prompts
     - Use 0.3-0.5 for more focused, conservative prompts
   - **Model**: 
     - `gemini-2.0-flash-lite`: Fast and cost-effective (recommended for testing)
     - `gemini-1.5-pro`: More capable but slower and more expensive

3. **Click "Create"** to initialize the session

## Running an Optimization Session

### Step 1: Generate Initial Prompts

1. After creating a session, you'll see the workspace
2. Click **"Generate k Prompts"** to create the first batch
3. Wait for the LLM to generate prompts (usually 5-15 seconds)
4. Review the generated prompts - they should be diverse approaches to solving math problems

### Step 2: Score the Prompts

You have two options:

**Option A: Score All at Once**
1. Click **"Score All"** button
2. Watch the progress as each prompt is evaluated
3. This will take several minutes depending on:
   - Number of prompts (k)
   - Size of test set
   - Model speed

**Option B: Score Individually**
1. Click **"Score"** on individual prompts
2. Useful for testing or if you want to pause between evaluations
3. You can enable **"Auto-Score"** to automatically score the next prompt after each completion

### Step 3: Review Results

After scoring completes:
- Each prompt will show its accuracy score (0-100%)
- Green border indicates scored prompts
- Review which prompts performed best
- Check the statistics panel for token usage and costs

### Step 4: Progress to Next Step

1. Once all prompts are scored, the **"Next Step"** button becomes available
2. Click it to:
   - Create a new step
   - Generate a meta-prompt with previous results
   - Automatically generate k new prompts for the next step
3. The new prompts should be informed by the best-performing prompts from the previous step

### Step 5: Iterate

Repeat steps 2-4 for multiple iterations:
- Each step builds on previous results
- Prompts should generally improve over time
- Monitor the best scores across steps to track progress

## Automation Features

### Auto-Score
- **When to use**: When you want continuous scoring without manual intervention
- **How to enable**: Check the "Auto-Score" checkbox
- **Behavior**: After scoring a prompt, automatically starts scoring the next unscored prompt
- **Use case**: Overnight runs, batch processing

### Auto-Next-Step
- **When to use**: For fully automated multi-step optimization
- **How to enable**: Check the "Auto-Next-Step" checkbox
- **Behavior**: After all prompts are scored, automatically progresses to the next step
- **Use case**: Long-running experiments, exploring many iterations
- **Warning**: Can consume significant API credits if left running

### Combined Automation
Enable both checkboxes for fully automated optimization:
1. Scores all prompts in current step
2. Automatically progresses to next step
3. Generates new prompts
4. Repeats the cycle

**Important**: Monitor costs and set reasonable limits!

## Session Management

### Resuming a Session
1. From the main page, find your session in the "Existing Sessions" list
2. Click **"Resume"** to continue where you left off
3. All previous steps and scores are preserved

### Deleting a Session
1. Click **"Delete"** on any session
2. Confirm the deletion
3. **Warning**: This cannot be undone!

### Session Information
Each session card shows:
- Session name
- Current step number
- Configuration (k, temperature, model)
- Creation timestamp

## Understanding the Statistics

### During Scoring
- **Correct/Incorrect**: Real-time count of correct vs incorrect answers
- **Progress**: Shows how many questions have been evaluated

### Overall Statistics
- **Total Requests**: Number of API calls made
- **Input Tokens**: Tokens sent to the API
- **Output Tokens**: Tokens received from the API
- **Total Cost**: Estimated cost based on Gemini pricing
  - Input: $0.10 per 1M tokens
  - Output: $0.40 per 1M tokens

## Best Practices

### For Effective Optimization

1. **Start Small**: Use k=3-5 for your first session to understand the process
2. **Monitor Costs**: Check the cost statistics regularly
3. **Review Prompts**: Read the generated prompts to understand what the LLM is trying
4. **Multiple Sessions**: Run parallel sessions with different configurations
5. **Patience**: Good optimization takes multiple steps (5-10+ iterations)

### For Cost Management

1. **Use Lite Models**: Start with `gemini-2.0-flash-lite`
2. **Smaller k**: Fewer prompts per step = lower costs
3. **Test Set Size**: Consider using a smaller test set for initial experiments
4. **Manual Control**: Disable automation when testing

### For Best Results

1. **Higher k**: More prompts per step = better exploration (but higher cost)
2. **Multiple Steps**: Run at least 5-10 steps to see meaningful improvement
3. **Temperature Tuning**: Experiment with different temperatures
4. **Diverse Initial Prompts**: The first step sets the foundation

## Troubleshooting

### "Test data not loaded yet"
- Wait a few seconds after opening the workspace
- Check browser console for errors
- Ensure `gsm_test.tsv` is in the `public/` folder

### Prompts not generating
- Check your API key in `.env.local`
- Verify you have API quota remaining
- Check browser console for error messages
- Try a different model

### Scoring fails or returns -1
- API rate limits may be hit
- Network connectivity issues
- Invalid API key
- Check browser console for details

### High costs
- Reduce k (number of prompts per step)
- Use lighter models (flash-lite)
- Disable automation
- Use smaller test sets

## Advanced Tips

### Customizing the Meta-Prompt
Edit `src/utils/sessionStorage.ts`:
- `createInitialMetaPrompt()`: Modify the initial prompt template
- `createNextStep()`: Modify how previous results are incorporated

### Using Different Test Sets
1. Add your TSV file to `public/` folder
2. Modify `src/components/OPROWorkspace.tsx`
3. Change `readTSVFile('gsm_test.tsv')` to your file name

### Exporting Results
Sessions are stored in browser localStorage:
1. Open browser DevTools (F12)
2. Go to Application > Local Storage
3. Find `opro_sessions` key
4. Copy the JSON data
5. Save to a file for analysis

## Example Workflow

Here's a complete example workflow:

1. **Create session**: "Math Optimization v1", k=5, temp=0.8, model=gemini-2.0-flash-lite
2. **Generate prompts**: Wait for 5 initial prompts
3. **Score all**: Enable Auto-Score, click Score All
4. **Review**: Best prompt scores 45%
5. **Next step**: Click Next Step
6. **Score again**: New prompts generated, score them
7. **Review**: Best prompt now scores 52%
8. **Iterate**: Repeat for 5-10 steps
9. **Final result**: Best prompt reaches 60%+

## Getting Help

If you encounter issues:
1. Check the browser console (F12) for error messages
2. Review this guide and the README
3. Check your API key and quota
4. Verify all dependencies are installed
5. Try with a fresh session

## Next Steps

After mastering the basics:
- Experiment with different configurations
- Try different models
- Customize the meta-prompt templates
- Analyze which types of prompts work best
- Share your findings!

Happy optimizing! 🚀

