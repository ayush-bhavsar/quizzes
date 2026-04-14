# quizzes

A Vite + React + TypeScript app for building a quiz from your own questions.

## What it does

- Choose a question source mode from a dropdown:
	- Manual question framing
	- CSV/Excel question import
	- Gemini-based generation from uploaded photo/PDF
- Add questions and answer keys in the manual editor
- Parse questions from CSV text or CSV/XLSX files
- Send image/PDF files to Gemini and convert extracted questions into quiz format
- Take the quiz one question at a time
- Review your score and missed answers at the end

## Run locally

```bash
npm install
npm run dev
```

Create a local env file for the backend before using Gemini file generation:

```bash
copy .env.example .env
```

Then add your Gemini key in `.env`:

```env
GEMINI_API_KEY=your_real_key_here
PORT=8787
```

The frontend calls `/api/gemini/quiz-from-file`, and the backend forwards the request to Gemini using the server-side key.

## Build for production

```bash
npm run build
```