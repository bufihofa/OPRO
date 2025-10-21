# OPRO - Optimization by PROmpting

A web application for running OPRO (Optimization by PROmpting) experiments to automatically optimize prompts for Large Language Models using iterative feedback.

## Features

### 1. Session Management
- **Create New Sessions**: Start a new OPRO optimization session with configurable parameters
- **Delete Sessions**: Remove unwanted sessions
- **Resume Sessions**: Continue previous optimization sessions from where you left off
- Each session tracks:
  - Current step number
  - Configuration (k prompts per step, temperature, model)
  - All prompts and their scores across all steps

### 2. Prompt Generation & Scoring
- **Automatic Prompt Generation**: At each step, the Optimizer LLM generates k new prompts
- **Prompt States**: Each prompt has one of three states:
  - `pending`: Not yet scored
  - `scoring`: Currently being evaluated
  - `scored`: Evaluation complete with score
- **Score All Button**: Batch score all unscored prompts in the current step
- **Individual Scoring**: Score prompts one at a time
- Prompts are evaluated against the GSM8K test set for accuracy

### 3. Step Progression
- **Next Step**: After all prompts are scored, progress to the next optimization step
- The system automatically:
  - Sorts prompts by score (descending)
  - Generates a new meta-prompt including previous results
  - Calls the Optimizer LLM to generate k new prompts for the next step

### 4. Automation Options
- **Auto-Score**: Automatically score the next prompt after completing one
- **Auto-Next-Step**: Automatically progress to the next step when all prompts are scored

## Configuration Parameters

When creating a new session, you can configure:

- **k (Number of prompts per step)**: How many prompts to generate at each step (1-20)
- **Temperature**: LLM temperature for prompt generation (0-2)
- **Model**: Which Gemini model to use:
  - `gemini-2.0-flash-lite` (default)
  - `gemini-2.5-flash-lite`
  - `gemini-1.5-flash`
  - `gemini-1.5-pro`

## Meta-Prompt Structure

The application uses a structured meta-prompt that evolves with each step:

**Step 1 (Initial):**
```
Your task is to generate k different instructions <INS> for solving math word problems.

Below are some example problems:
[Example problems with ground truth answers]

Generate k different instructions that could help solve these types of math word problems.
Each instruction should begin with <INS> and end with </INS>.
```

**Step 2+ (With History):**
```
Your task is to generate k different instructions <INS> for solving math word problems.

Below are some previous instructions with their scores. The score ranges from 0 to 100.

text:
[Previous prompt 1]
score:
[Score 1]

text:
[Previous prompt 2]
score:
[Score 2]

[... more previous prompts sorted by score ...]

Below are some example problems:
[Example problems with ground truth answers]

Generate k instructions that are different from all the instructions <INS> above,
and have a higher score than all the instructions <INS> above.
Each instruction should begin with <INS> and end with </INS>.
```

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   Create a `.env.local` file in the root directory:
   ```
   VITE_GEMINI_API_KEY=your_gemini_api_key_here
   ```

3. **Run the development server:**
   ```bash
   npm run dev
   ```

4. **Open in browser:**
   Navigate to `http://localhost:5173/`

## Usage Workflow

1. **Create a Session**
   - Click "Create New Session"
   - Enter a session name
   - Configure k, temperature, and model
   - Click "Create"

2. **Generate Initial Prompts**
   - Click "Generate k Prompts" to create the first batch of prompts
   - The Optimizer LLM will generate k diverse prompts

3. **Score Prompts**
   - Click "Score All" to evaluate all prompts against the test set
   - Or click "Score" on individual prompts
   - Watch the progress as each prompt is evaluated

4. **Progress to Next Step**
   - Once all prompts are scored, click "Next Step"
   - The system generates a new meta-prompt with sorted results
   - New prompts are automatically generated for the next step

5. **Iterate**
   - Repeat steps 3-4 to continue optimizing
   - Each step builds on the best prompts from previous steps

## Architecture

### Data Models (`src/types/opro.ts`)
- `Session`: Complete OPRO session with configuration and steps
- `Step`: A single optimization step with prompts and meta-prompt
- `Prompt`: Individual prompt with text, score, and state
- `OPROConfig`: Configuration parameters (k, temperature, model)

### Storage (`src/utils/sessionStorage.ts`)
- Sessions stored in browser localStorage
- CRUD operations for sessions
- Step progression logic
- Meta-prompt generation

### API (`src/api/opro.ts`)
- `generatePrompts()`: Calls Optimizer LLM to generate new prompts
- `scorePrompt()`: Evaluates a prompt against test set
- Uses Google Gemini API

### Components
- `SessionManager`: Create, delete, and resume sessions
- `OPROWorkspace`: Main workspace for running OPRO experiments
  - Prompt generation
  - Scoring interface
  - Step progression
  - Automation controls
  - Statistics tracking

## Statistics Tracked

- Total API requests
- Input/output tokens
- Estimated cost
- Correct/incorrect answers during scoring
- Prompt scores (accuracy percentage)

## Technology Stack

- **React 19** with TypeScript
- **Vite** for build tooling
- **Google Gemini API** for LLM calls
- **localStorage** for session persistence
- **GSM8K dataset** for evaluation

## License

MIT

