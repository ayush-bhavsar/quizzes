import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

const toGeminiTextPrompt = (extraInstruction = '') =>
  [
    'You are a quiz generator for student practice tests.',
    'Read the uploaded image or PDF and extract questions from it.',
    'Convert ONLY extracted questions into quiz rows. Do not create unrelated questions.',
    'Return JSON only with either an array of objects or {"questions": []}.',
    'Allowed types: multiple-choice, fill-up, true-false.',
    'Each object should use fields: prompt, type, option1, option2, option3, option4, correctAnswer, correctIndex.',
    'Infer type from extracted text: MCQ with choices => multiple-choice, true/false statements => true-false, otherwise fill-up.',
    'For true-false, use correctAnswer as True or False.',
    'For fill-up, provide prompt and correctAnswer.',
    'Extract answers from markers like Answer:, Correct:, Ans:, ->, or inline answer hints when present.',
    'If a question has no reliable answer, skip that question instead of guessing.',
    'Do not include markdown, comments, or extra keys.',
    extraInstruction.trim() ? `Extra user instruction: ${extraInstruction.trim()}` : 'No extra user instruction.',
  ].join('\n');

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.post('/api/gemini/quiz-from-file', upload.single('file'), async (request, response) => {
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiApiKey) {
    response.status(500).json({ error: 'Server is missing GEMINI_API_KEY.' });
    return;
  }

  const file = request.file;
  if (!file) {
    response.status(400).json({ error: 'Missing file upload.' });
    return;
  }

  const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
  const isImage = file.mimetype.startsWith('image/');
  if (!isPdf && !isImage) {
    response.status(400).json({ error: 'Unsupported file type. Upload an image or PDF.' });
    return;
  }

  const mimeType = isPdf ? 'application/pdf' : file.mimetype;
  const extraInstruction = typeof request.body.prompt === 'string' ? request.body.prompt : '';

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: toGeminiTextPrompt(extraInstruction),
                },
                {
                  inlineData: {
                    mimeType,
                    data: file.buffer.toString('base64'),
                  },
                },
              ],
            },
          ],
        }),
      },
    );

    const payload = await geminiResponse.json();

    if (!geminiResponse.ok) {
      response.status(geminiResponse.status).json({
        error: payload?.error?.message || 'Gemini request failed.',
      });
      return;
    }

    const text =
      payload?.candidates
        ?.flatMap((candidate) => candidate?.content?.parts || [])
        ?.map((part) => part?.text || '')
        ?.join('\n')
        ?.trim() || '';

    if (!text) {
      response.status(502).json({ error: 'Gemini returned an empty response.' });
      return;
    }

    response.json({ text });
  } catch {
    response.status(500).json({ error: 'Could not process the file with Gemini.' });
  }
});

app.listen(port, () => {
  console.log(`Gemini proxy server running on http://localhost:${port}`);
});
