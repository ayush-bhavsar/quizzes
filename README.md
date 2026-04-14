# quizzes

A Vite + React + TypeScript app for building a quiz from your own questions.

## What it does

- Choose a question source mode from a dropdown:
	- Manual question framing
	- CSV/Excel question import
	- Gemini-based generation from uploaded photo/PDF
- Add questions and answer keys in the manual editor
- Parse questions from CSV text or CSV/XLS/XLSX files
- Send image/PDF files to Gemini and convert extracted questions into quiz format
- Take the quiz one question at a time
- Review your score and missed answers at the end

## Run locally

```bash
npm install
npm run dev
```

## Build for production

```bash
npm run build
```