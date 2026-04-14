import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';

type QuestionType = 'multiple-choice' | 'fill-up' | 'true-false';

type QuestionDraft = {
  id: string;
  type: QuestionType;
  prompt: string;
  options: [string, string, string, string];
  correctIndex: number;
  correctText: string;
};

type QuizQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  options: string[];
  correctAnswer: string;
};

type ResultEntry = {
  questionId: string;
  type: QuestionType;
  prompt: string;
  chosen: string;
  correct: string;
  isCorrect: boolean;
};

type Phase = 'builder' | 'quiz' | 'summary';
type InputMode = 'manual' | 'csv' | 'gemini-file';

type ImportRow = Record<string, unknown>;

type QuizBuildResult = {
  quiz: QuizQuestion[];
  error: string;
};

type PatternSelection = Record<QuestionType, boolean>;

type GeminiProxyResponse = {
  text?: string;
  error?: string;
};

type ParseCsvResult = {
  data: ImportRow[];
  errors: string[];
};

const GEMINI_SUPPORTED_FILE_HINT = 'Upload a JPG, PNG, WEBP, or PDF file.';

const importedHeaders = {
  prompt: ['prompt', 'question', 'quiz question', 'question prompt'],
  type: ['type', 'question type', 'kind'],
  option1: ['option1', 'option 1', 'choice1', 'choice 1', 'answer1', 'answer 1'],
  option2: ['option2', 'option 2', 'choice2', 'choice 2', 'answer2', 'answer 2'],
  option3: ['option3', 'option 3', 'choice3', 'choice 3', 'answer3', 'answer 3'],
  option4: ['option4', 'option 4', 'choice4', 'choice 4', 'answer4', 'answer 4'],
  correctAnswer: ['correctanswer', 'correct answer', 'answer', 'correct', 'correct text', 'correcttext'],
  correctIndex: ['correctindex', 'correct index', 'answer index', 'correct choice', 'correct option', 'correctoption'],
};

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const toText = (value: unknown) => {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  return '';
};

const getRowValue = (row: ImportRow, aliases: string[]) => {
  const lookup = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));

  for (const alias of aliases) {
    const value = lookup.get(normalizeHeader(alias));
    if (value !== undefined && value !== null && toText(value)) {
      return value;
    }
  }

  return undefined;
};

const parseQuestionType = (value: unknown): QuestionType => {
  const normalized = normalizeAnswer(toText(value));

  if (normalized === 'multiplechoice' || normalized === 'multiple-choice' || normalized === 'multiple choice' || normalized === 'mcq') {
    return 'multiple-choice';
  }

  if (normalized === 'fillup' || normalized === 'fill-up' || normalized === 'fill up' || normalized === 'blank' || normalized === 'short answer') {
    return 'fill-up';
  }

  if (normalized === 'truefalse' || normalized === 'true-false' || normalized === 'true false' || normalized === 'boolean') {
    return 'true-false';
  }

  return 'multiple-choice';
};

const parseCorrectIndex = (value: unknown) => {
  const normalized = toText(value);
  if (!normalized) {
    return 0;
  }

  const numeric = Number(normalized);
  if (Number.isNaN(numeric)) {
    return 0;
  }

  if (numeric >= 1 && numeric <= 4) {
    return numeric - 1;
  }

  if (numeric >= 0 && numeric <= 3) {
    return numeric;
  }

  return 0;
};

const createQuestionFromRow = (row: ImportRow, index: number): QuestionDraft | null => {
  const prompt = toText(getRowValue(row, importedHeaders.prompt));
  if (!prompt) {
    return null;
  }

  const type = parseQuestionType(getRowValue(row, importedHeaders.type));

  if (type === 'fill-up') {
    const correctText = toText(getRowValue(row, importedHeaders.correctAnswer));
    if (!correctText) {
      return null;
    }

    return {
      id: `${makeId()}-${index}`,
      type,
      prompt,
      options: ['', '', '', ''],
      correctIndex: 0,
      correctText,
    };
  }

  const optionValues = [
    toText(getRowValue(row, importedHeaders.option1)),
    toText(getRowValue(row, importedHeaders.option2)),
    toText(getRowValue(row, importedHeaders.option3)),
    toText(getRowValue(row, importedHeaders.option4)),
  ] as [string, string, string, string];

  const correctAnswer = toText(getRowValue(row, importedHeaders.correctAnswer));
  const correctIndexValue = getRowValue(row, importedHeaders.correctIndex);
  const correctIndex = type === 'true-false' ? 0 : parseCorrectIndex(correctIndexValue);

  const options = type === 'true-false' ? (['True', 'False', '', ''] as [string, string, string, string]) : optionValues;

  let inferredIndex = -1;
  if (correctAnswer) {
    inferredIndex = options.slice(0, type === 'true-false' ? 2 : 4).findIndex((option) => normalizeAnswer(option) === normalizeAnswer(correctAnswer));
  }

  const finalCorrectIndex = inferredIndex >= 0 ? inferredIndex : correctIndex;

  if (type !== 'true-false' && options.every((option) => !option)) {
    return null;
  }

  if (type === 'true-false' && !correctAnswer && !correctIndexValue) {
    return null;
  }

  return {
    id: `${makeId()}-${index}`,
    type,
    prompt,
    options,
    correctIndex: finalCorrectIndex,
    correctText: '',
  };
};

const createQuizFromQuestions = (draftQuestions: QuestionDraft[]): QuizBuildResult => {
  const invalidQuestion = draftQuestions.find((question) => {
    const normalized = normalizeQuestion(question);
    if (!normalized.prompt) {
      return true;
    }

    if (normalized.type === 'fill-up') {
      return !normalized.correctText;
    }

    if (normalized.type === 'true-false') {
      return normalized.correctIndex !== 0 && normalized.correctIndex !== 1;
    }

    return normalized.options.some((option) => !option);
  });

  if (!draftQuestions.length) {
    return {
      quiz: [],
      error: 'Add at least one question before generating the quiz.',
    };
  }

  if (invalidQuestion) {
    return {
      quiz: [],
      error: 'Fill in every question prompt and the required answer fields for each question type before generating the quiz.',
    };
  }

  return {
    quiz: shuffle(
      draftQuestions.map((question) => {
        const normalized = normalizeQuestion(question);
        const correctAnswer = normalized.type === 'fill-up' ? normalized.correctText : normalized.options[normalized.correctIndex];

        return {
          id: question.id,
          type: normalized.type,
          prompt: normalized.prompt,
          options:
            normalized.type === 'fill-up'
              ? []
              : normalized.type === 'true-false'
                ? shuffle(['True', 'False'])
                : shuffle(normalized.options),
          correctAnswer,
        };
      }),
    ),
    error: '',
  };
};

const makeId = () => crypto.randomUUID();

const createBlankQuestion = (type: QuestionType = 'multiple-choice'): QuestionDraft => ({
  id: makeId(),
  type,
  prompt: '',
  options: ['', '', '', ''],
  correctIndex: 0,
  correctText: '',
});

const createSampleQuestions = (): QuestionDraft[] => [
  {
    id: makeId(),
    type: 'multiple-choice',
    prompt: 'Which planet is known as the Red Planet?',
    options: ['Earth', 'Mars', 'Saturn', 'Venus'],
    correctIndex: 1,
    correctText: '',
  },
  {
    id: makeId(),
    type: 'fill-up',
    prompt: 'The largest ocean on Earth is the ____ Ocean.',
    options: ['', '', '', ''],
    correctIndex: 0,
    correctText: 'Pacific',
  },
  {
    id: makeId(),
    type: 'true-false',
    prompt: 'The Earth is flat.',
    options: ['True', 'False', '', ''],
    correctIndex: 1,
    correctText: '',
  },
];

const shuffle = <T,>(items: T[]): T[] => {
  const cloned = [...items];

  for (let index = cloned.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [cloned[index], cloned[swapIndex]] = [cloned[swapIndex], cloned[index]];
  }

  return cloned;
};

const normalizeQuestion = (question: QuestionDraft) => ({
  type: question.type,
  prompt: question.prompt.trim(),
  options: question.options.map((option) => option.trim()),
  correctIndex: question.correctIndex,
  correctText: question.correctText.trim(),
});

const normalizeAnswer = (value: string) => value.trim().toLowerCase();

const resetQuestionByType = (question: QuestionDraft, type: QuestionType): QuestionDraft => {
  if (type === 'fill-up') {
    return {
      ...question,
      type,
      options: ['', '', '', ''],
      correctIndex: 0,
      correctText: '',
    };
  }

  if (type === 'true-false') {
    return {
      ...question,
      type,
      options: ['True', 'False', '', ''],
      correctIndex: 0,
      correctText: '',
    };
  }

  return {
    ...question,
    type,
    options: ['', '', '', ''],
    correctIndex: 0,
    correctText: '',
  };
};

const defaultPatternSelection: PatternSelection = {
  'multiple-choice': true,
  'fill-up': true,
  'true-false': true,
};

const applyPatternFilter = (draftQuestions: QuestionDraft[], patternSelection: PatternSelection) =>
  draftQuestions.filter((question) => patternSelection[question.type]);

const parseQuestionsFromRows = (rows: ImportRow[]) =>
  rows.map(createQuestionFromRow).filter((question): question is QuestionDraft => Boolean(question));

const parseCsvRows = (value: string): ParseCsvResult => {
  const result = Papa.parse<ImportRow>(value, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  });

  return {
    data: result.data.filter((row: ImportRow) => row && Object.keys(row).length > 0),
    errors: result.errors.map((entry: Papa.ParseError) => entry.message),
  };
};

const cellValueToText = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;

    if (typeof objectValue.text === 'string') {
      return objectValue.text.trim();
    }

    if (Array.isArray(objectValue.richText)) {
      return objectValue.richText
        .map((entry) => (typeof (entry as { text?: unknown }).text === 'string' ? String((entry as { text: string }).text) : ''))
        .join('')
        .trim();
    }

    if (objectValue.result !== undefined) {
      return cellValueToText(objectValue.result);
    }
  }

  return '';
};

const parseQuestionsFromXlsxBuffer = async (buffer: ArrayBuffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return [];
  }

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    headers[columnNumber - 1] = cellValueToText(cell.value);
  });

  if (!headers.length) {
    return [];
  }

  const rows: ImportRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const record: ImportRow = {};
    let hasValue = false;

    headers.forEach((header, index) => {
      if (!header) {
        return;
      }

      const value = cellValueToText(row.getCell(index + 1).value);
      record[header] = value;
      if (value) {
        hasValue = true;
      }
    });

    if (hasValue) {
      rows.push(record);
    }
  });

  return parseQuestionsFromRows(rows);
};

const extractJsonSegment = (value: string) => {
  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const arrayStart = value.indexOf('[');
  const arrayEnd = value.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return value.slice(arrayStart, arrayEnd + 1);
  }

  const objectStart = value.indexOf('{');
  const objectEnd = value.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    return value.slice(objectStart, objectEnd + 1);
  }

  return value.trim();
};

const parseQuestionsFromGeminiText = (value: string) => {
  const json = extractJsonSegment(value);
  try {
    const parsed = JSON.parse(json) as unknown;

    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { questions?: unknown }).questions)
        ? ((parsed as { questions: unknown[] }).questions)
        : [];

    return parseQuestionsFromRows(rows.filter((item): item is ImportRow => Boolean(item && typeof item === 'object')));
  } catch {
    const csv = parseCsvRows(value);
    return parseQuestionsFromRows(csv.data);
  }
};

const getGeminiMimeType = (file: File) => {
  if (file.type.startsWith('image/')) {
    return file.type;
  }

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return 'application/pdf';
  }

  return '';
};

function App() {
  const [questions, setQuestions] = useState<QuestionDraft[]>([createBlankQuestion()]);
  const [phase, setPhase] = useState<Phase>('builder');
  const [inputMode, setInputMode] = useState<InputMode>('manual');
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [score, setScore] = useState(0);
  const [results, setResults] = useState<ResultEntry[]>([]);
  const [error, setError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [patternSelection, setPatternSelection] = useState<PatternSelection>(defaultPatternSelection);
  const [geminiPrompt, setGeminiPrompt] = useState('');
  const [geminiFile, setGeminiFile] = useState<File | null>(null);
  const [isGeneratingWithGemini, setIsGeneratingWithGemini] = useState(false);
  const csvFileInputRef = useRef<HTMLInputElement>(null);
  const geminiFileInputRef = useRef<HTMLInputElement>(null);

  const currentQuestion = quiz[currentIndex];
  const totalQuestions = quiz.length;
  const progress = totalQuestions > 0 ? ((currentIndex + (phase === 'summary' ? 1 : 0)) / totalQuestions) * 100 : 0;

  const readyQuestions = useMemo(
    () => questions.filter((question) => question.prompt.trim().length > 0),
    [questions],
  );

  const updateQuestion = (questionId: string, updater: (question: QuestionDraft) => QuestionDraft) => {
    setQuestions((currentQuestions) => currentQuestions.map((question) => (question.id === questionId ? updater(question) : question)));
  };

  const changeQuestionType = (questionId: string, type: QuestionType) => {
    updateQuestion(questionId, (question) => resetQuestionByType(question, type));
  };

  const addQuestion = () => {
    setQuestions((currentQuestions) => [...currentQuestions, createBlankQuestion()]);
  };

  const removeQuestion = (questionId: string) => {
    setQuestions((currentQuestions) => {
      if (currentQuestions.length === 1) {
        return [createBlankQuestion()];
      }

      return currentQuestions.filter((question) => question.id !== questionId);
    });
  };

  const loadSampleQuiz = () => {
    setQuestions(createSampleQuestions());
    setPhase('builder');
    setError('');
  };

  const startQuiz = (draftQuestions: QuestionDraft[] = questions) => {
    const filteredQuestions = applyPatternFilter(draftQuestions, patternSelection);

    if (!Object.values(patternSelection).some(Boolean)) {
      setError('Select at least one question pattern before generating the quiz.');
      return;
    }

    if (!filteredQuestions.length) {
      setError('No questions match the selected pattern. Enable more patterns or add matching questions.');
      return;
    }

    const result = createQuizFromQuestions(filteredQuestions);

    if (result.error) {
      setError(result.error);
      return;
    }

    setQuiz(result.quiz);
    setCurrentIndex(0);
    setSelectedAnswer('');
    setScore(0);
    setResults([]);
    setPhase('quiz');
    setError('');
  };

  const openCsvImportDialog = () => {
    csvFileInputRef.current?.click();
  };

  const openGeminiFileDialog = () => {
    geminiFileInputRef.current?.click();
  };

  const togglePattern = (type: QuestionType) => {
    setPatternSelection((currentSelection) => ({
      ...currentSelection,
      [type]: !currentSelection[type],
    }));
  };

  const importQuizFromText = () => {
    if (!bulkInput.trim()) {
      setError('Paste CSV text before generating a quiz from text input.');
      return;
    }

    try {
      const parsed = parseCsvRows(bulkInput);
      const importedQuestions = parseQuestionsFromRows(parsed.data);

      if (!importedQuestions.length) {
        setError('No valid questions were found in the pasted text. Check headers and row values.');
        return;
      }

      setQuestions(importedQuestions);
      startQuiz(importedQuestions);
    } catch {
      setError('Could not parse the pasted text. Keep the CSV header and values in a table format.');
    }
  };

  const importQuizFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setIsImporting(true);

    try {
      const isCsv = file.name.toLowerCase().endsWith('.csv');
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx');

      let importedQuestions: QuestionDraft[] = [];

      if (isCsv) {
        const parsed = parseCsvRows(await file.text());
        importedQuestions = parseQuestionsFromRows(parsed.data);
      } else if (isXlsx) {
        importedQuestions = await parseQuestionsFromXlsxBuffer(await file.arrayBuffer());
      } else {
        setError('Could not read that file. Use a CSV or XLSX file with supported question columns.');
        return;
      }

      if (!importedQuestions.length) {
        setError('No valid questions were found. Make sure your file includes prompt and answer columns.');
        return;
      }

      setQuestions(importedQuestions);
      startQuiz(importedQuestions);
    } catch {
      setError('Could not read that file. Use a CSV or XLSX file with supported question columns.');
    } finally {
      setIsImporting(false);
    }
  };

  const pickGeminiFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';

    if (!file) {
      return;
    }

    const mimeType = getGeminiMimeType(file);
    if (!mimeType) {
      setGeminiFile(null);
      setError(`Unsupported file type. ${GEMINI_SUPPORTED_FILE_HINT}`);
      return;
    }

    setGeminiFile(file);
    setError('');
  };

  const generateQuizFromGeminiFile = async () => {
    if (!geminiFile) {
      setError(`Choose an image or PDF before using Gemini. ${GEMINI_SUPPORTED_FILE_HINT}`);
      return;
    }

    const mimeType = getGeminiMimeType(geminiFile);
    if (!mimeType) {
      setError(`Unsupported file type. ${GEMINI_SUPPORTED_FILE_HINT}`);
      return;
    }

    setIsGeneratingWithGemini(true);

    try {
      const formData = new FormData();
      formData.append('file', geminiFile);
      formData.append('prompt', geminiPrompt);

      const response = await fetch('/api/gemini/quiz-from-file', {
        method: 'POST',
        body: formData,
      });

      const payload = (await response.json()) as GeminiProxyResponse;

      if (!response.ok) {
        const message = payload.error ?? 'Gemini request failed. Please try again.';
        setError(message);
        return;
      }

      const modelText = payload.text?.trim() ?? '';

      if (!modelText) {
        setError('Gemini returned an empty response. Please try another file or instruction.');
        return;
      }

      const generatedQuestions = parseQuestionsFromGeminiText(modelText);

      if (!generatedQuestions.length) {
        setError('Could not extract valid questions from the uploaded file. Ensure each question includes a clear answer and try another image/PDF.');
        return;
      }

      setQuestions(generatedQuestions);
      setBulkInput('');
      setGeminiFile(null);
      setError('');
      startQuiz(generatedQuestions);
    } catch {
      setError('Could not generate questions with Gemini. Check network access, file quality, and response format.');
    } finally {
      setIsGeneratingWithGemini(false);
    }
  };

  const submitAnswer = () => {
    if (!currentQuestion || !selectedAnswer) {
      return;
    }

    const isCorrect = normalizeAnswer(selectedAnswer) === normalizeAnswer(currentQuestion.correctAnswer);
    const entry: ResultEntry = {
      questionId: currentQuestion.id,
      type: currentQuestion.type,
      prompt: currentQuestion.prompt,
      chosen: selectedAnswer,
      correct: currentQuestion.correctAnswer,
      isCorrect,
    };

    setScore((currentScore) => currentScore + (isCorrect ? 1 : 0));
    setResults((currentResults) => [...currentResults, entry]);

    if (currentIndex === quiz.length - 1) {
      setPhase('summary');
    } else {
      setCurrentIndex((value) => value + 1);
    }

    setSelectedAnswer('');
  };

  const restartBuilder = () => {
    setPhase('builder');
    setQuiz([]);
    setCurrentIndex(0);
    setSelectedAnswer('');
    setScore(0);
    setResults([]);
    setError('');
  };

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">quizzes</p>
          <h1>Turn your questions into a playable quiz in seconds.</h1>
          <p className="hero-description">
            Choose how to build your quiz: manual questions, CSV import, or Gemini extraction from photo/PDF.
          </p>
          <div className="hero-actions">
            <button className="secondary-button" onClick={loadSampleQuiz} type="button">
              Load sample quiz
            </button>
            {inputMode === 'manual' ? (
              <button className="primary-button" onClick={addQuestion} type="button">
                Add question
              </button>
            ) : null}
            {inputMode === 'csv' ? (
              <button className="secondary-button" onClick={openCsvImportDialog} type="button">
                {isImporting ? 'Importing...' : 'Import CSV / Excel'}
              </button>
            ) : null}
            {inputMode === 'gemini-file' ? (
              <button className="secondary-button" onClick={openGeminiFileDialog} type="button">
                {geminiFile ? `Selected: ${geminiFile.name}` : 'Select photo / PDF'}
              </button>
            ) : null}
          </div>
        </div>

        <div className="stats-grid">
          <article className="stat-card">
            <span>Questions ready</span>
            <strong>{readyQuestions.length}</strong>
          </article>
          <article className="stat-card">
            <span>Quiz state</span>
            <strong>{phase === 'builder' ? 'Editing' : phase === 'quiz' ? 'Playing' : 'Complete'}</strong>
          </article>
          <article className="stat-card">
            <span>Score</span>
            <strong>
              {score}/{totalQuestions || readyQuestions.length || 0}
            </strong>
          </article>
        </div>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}

      {phase === 'builder' ? (
        <section className="content-grid">
          <div className="panel builder-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Question editor</p>
                <h2>Write the quiz</h2>
              </div>
              <button className="secondary-button" onClick={() => startQuiz()} type="button">
                Generate quiz
              </button>
            </div>

            <div className="source-mode-row">
              <label className="field-label" htmlFor="source-mode">
                Question source mode
              </label>
              <select
                id="source-mode"
                className="text-input"
                value={inputMode}
                onChange={(event) => {
                  setInputMode(event.target.value as InputMode);
                  setError('');
                }}
              >
                <option value="manual">Manually frame questions one by one</option>
                <option value="csv">CSV questions</option>
                <option value="gemini-file">Generate questions from Gemini photo/PDF</option>
              </select>
            </div>

            {inputMode === 'csv' ? (
              <div className="bulk-entry-card">
                <label className="field-label" htmlFor="bulk-quiz-input">
                  Paste CSV text (prompt, type, option1 to option4, correctAnswer, correctIndex)
                </label>
                <textarea
                  id="bulk-quiz-input"
                  className="text-input bulk-textarea"
                  placeholder={
                    'prompt,type,option1,option2,option3,option4,correctAnswer,correctIndex\nWhich planet is called the Red Planet?,multiple-choice,Earth,Mars,Jupiter,Venus,Mars,\nThe largest ocean is the ____ Ocean.,fill-up,,,,,Pacific,\nThe earth is flat.,true-false,,,,,False,'
                  }
                  value={bulkInput}
                  onChange={(event) => setBulkInput(event.target.value)}
                  rows={6}
                />
                <div className="bulk-actions">
                  <button className="secondary-button" onClick={importQuizFromText} type="button">
                    Generate from CSV text
                  </button>
                  <button className="secondary-button" onClick={openCsvImportDialog} type="button">
                    {isImporting ? 'Importing...' : 'Upload CSV / Excel file'}
                  </button>
                  <button className="ghost-button" onClick={() => setBulkInput('')} type="button">
                    Clear text
                  </button>
                </div>
              </div>
            ) : null}

            {inputMode === 'gemini-file' ? (
              <div className="ai-entry-card">
                <label className="field-label" htmlFor="gemini-file-prompt">
                  Optional extraction instructions
                </label>
                <textarea
                  id="gemini-file-prompt"
                  className="text-input gemini-textarea"
                  rows={4}
                  placeholder="Optional: tell Gemini to focus on specific sections, language, or question style."
                  value={geminiPrompt}
                  onChange={(event) => setGeminiPrompt(event.target.value)}
                />

                <div className="bulk-actions">
                  <button className="secondary-button" onClick={openGeminiFileDialog} type="button">
                    {geminiFile ? `Selected: ${geminiFile.name}` : 'Choose photo or PDF'}
                  </button>
                  <button className="secondary-button" onClick={() => void generateQuizFromGeminiFile()} type="button" disabled={isGeneratingWithGemini}>
                    {isGeneratingWithGemini ? 'Generating...' : 'Generate quiz from Gemini file'}
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => {
                      setGeminiPrompt('');
                      setGeminiFile(null);
                    }}
                    type="button"
                  >
                    Clear Gemini inputs
                  </button>
                </div>
                <p className="type-note">
                  Gemini reads your uploaded photo/PDF through a secure backend endpoint. Configure GEMINI_API_KEY in your server env file.
                </p>
              </div>
            ) : null}

            {inputMode === 'manual' ? (
              <div className="question-list">
                {questions.map((question, questionIndex) => (
                  <article className="question-card" key={question.id}>
                  <div className="question-card-header">
                    <div>
                      <p className="question-index">Question {questionIndex + 1}</p>
                      <label className="field-label" htmlFor={`prompt-${question.id}`}>
                        Prompt
                      </label>
                    </div>
                    <button className="ghost-button" onClick={() => removeQuestion(question.id)} type="button">
                      Remove
                    </button>
                  </div>

                  <textarea
                    id={`prompt-${question.id}`}
                    className="text-input prompt-input"
                    placeholder="Type the question prompt"
                    value={question.prompt}
                    onChange={(event) =>
                      updateQuestion(question.id, (currentQuestion) => ({
                        ...currentQuestion,
                        prompt: event.target.value,
                      }))
                    }
                    rows={3}
                  />

                  <div className="question-type-row">
                    <label className="field-label" htmlFor={`type-${question.id}`}>
                      Question type
                    </label>
                    <select
                      id={`type-${question.id}`}
                      className="text-input type-input"
                      value={question.type}
                      onChange={(event) => changeQuestionType(question.id, event.target.value as QuestionType)}
                    >
                      <option value="multiple-choice">Multiple choice</option>
                      <option value="fill-up">Fill up</option>
                      <option value="true-false">True / false</option>
                    </select>
                  </div>

                  {question.type === 'fill-up' ? (
                    <div className="fillup-section">
                      <label className="field-label" htmlFor={`fill-${question.id}`}>
                        Correct answer
                      </label>
                      <input
                        id={`fill-${question.id}`}
                        className="text-input"
                        placeholder="Type the accepted answer"
                        value={question.correctText}
                        onChange={(event) =>
                          updateQuestion(question.id, (currentQuestion) => ({
                            ...currentQuestion,
                            correctText: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ) : (
                    <div className="options-grid">
                      {(question.type === 'true-false' ? question.options.slice(0, 2) : question.options).map((option, optionIndex) => (
                        <label className="option-row" key={`${question.id}-${optionIndex}`}>
                          <input
                            checked={question.correctIndex === optionIndex}
                            className="option-radio"
                            name={`correct-${question.id}`}
                            onChange={() =>
                              updateQuestion(question.id, (currentQuestion) => ({
                                ...currentQuestion,
                                correctIndex: optionIndex,
                              }))
                            }
                            type="radio"
                          />
                          <span className="option-number">{optionIndex + 1}</span>
                          <input
                            className="text-input option-input"
                            disabled={question.type === 'true-false'}
                            placeholder={question.type === 'true-false' ? (optionIndex === 0 ? 'True' : 'False') : `Answer option ${optionIndex + 1}`}
                            value={option}
                            onChange={(event) =>
                              question.type === 'true-false'
                                ? undefined
                                : updateQuestion(question.id, (currentQuestion) => {
                                    const nextOptions = [...currentQuestion.options] as [string, string, string, string];
                                    nextOptions[optionIndex] = event.target.value;
                                    return {
                                      ...currentQuestion,
                                      options: nextOptions,
                                    };
                                  })
                            }
                          />
                        </label>
                      ))}
                      {question.type === 'true-false' ? <p className="type-note">True / false questions use the fixed choices above.</p> : null}
                    </div>
                  )}
                  </article>
                ))}
              </div>
            ) : null}
          </div>

          <aside className="panel preview-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Preview</p>
                <h2>What the quiz will do</h2>
              </div>
            </div>

            <div className="preview-card">
              <p>
                Generated quizzes are shuffled on launch, scored automatically, and shown with a final review screen.
              </p>
              <p className="field-label">Pattern selector</p>
              <div className="pattern-grid" role="group" aria-label="Quiz pattern selector">
                <label className="pattern-chip">
                  <input
                    type="checkbox"
                    checked={patternSelection['multiple-choice']}
                    onChange={() => togglePattern('multiple-choice')}
                  />
                  <span>MCQ</span>
                </label>
                <label className="pattern-chip">
                  <input
                    type="checkbox"
                    checked={patternSelection['fill-up']}
                    onChange={() => togglePattern('fill-up')}
                  />
                  <span>Fill ups</span>
                </label>
                <label className="pattern-chip">
                  <input
                    type="checkbox"
                    checked={patternSelection['true-false']}
                    onChange={() => togglePattern('true-false')}
                  />
                  <span>True / False</span>
                </label>
              </div>
              <ul>
                <li>Source mode dropdown for manual / CSV / Gemini</li>
                <li>One question at a time</li>
                <li>Instant score tracking</li>
                <li>Review of correct and wrong answers</li>
              </ul>
              <p className="type-note">
                Import CSV/XLSX files with columns like prompt, type, option1 to option4, correctAnswer, or correctIndex.
              </p>
            </div>

            <button className="primary-button launch-button" onClick={() => startQuiz()} type="button">
              Build my quiz
            </button>

            <input
              ref={csvFileInputRef}
              accept=".csv,.xlsx"
              aria-label="Import quiz file"
              className="file-input"
              onChange={importQuizFile}
              type="file"
            />

            <input
              ref={geminiFileInputRef}
              accept="image/*,.pdf"
              aria-label="Upload photo or PDF for Gemini"
              className="file-input"
              onChange={pickGeminiFile}
              type="file"
            />
          </aside>
        </section>
      ) : null}

      {phase === 'quiz' && currentQuestion ? (
        <section className="quiz-stage panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Quiz mode</p>
              <h2>Answer the questions</h2>
            </div>
            <button className="secondary-button" onClick={restartBuilder} type="button">
              Edit questions
            </button>
          </div>

          <div className="progress-shell" aria-hidden="true">
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>

          <div className="quiz-meta">
            <span>
              Question {currentIndex + 1} of {totalQuestions}
            </span>
            <span>
              Score {score}/{totalQuestions}
            </span>
          </div>

          <article className="quiz-card">
            <h3>{currentQuestion.prompt}</h3>
            {currentQuestion.type === 'fill-up' ? (
              <div className="fillup-answer">
                <label className="field-label" htmlFor={`answer-${currentQuestion.id}`}>
                  Your answer
                </label>
                <input
                  id={`answer-${currentQuestion.id}`}
                  className="text-input"
                  placeholder="Type your answer"
                  value={selectedAnswer}
                  onChange={(event) => setSelectedAnswer(event.target.value)}
                />
              </div>
            ) : (
              <div className="answer-grid">
                {currentQuestion.options.map((option) => (
                  <button
                    className={`answer-button ${selectedAnswer === option ? 'selected' : ''}`}
                    key={`${currentQuestion.id}-${option}`}
                    onClick={() => setSelectedAnswer(option)}
                    type="button"
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </article>

          <div className="quiz-actions">
            <button className="primary-button" disabled={!selectedAnswer} onClick={submitAnswer} type="button">
              {currentIndex === totalQuestions - 1 ? 'Finish quiz' : 'Next question'}
            </button>
          </div>
        </section>
      ) : null}

      {phase === 'summary' ? (
        <section className="summary-stage panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Quiz complete</p>
              <h2>
                You scored {score}/{totalQuestions}
              </h2>
            </div>
            <button className="secondary-button" onClick={restartBuilder} type="button">
              Build another quiz
            </button>
          </div>

          <div className="summary-grid">
            <article className="summary-card highlight">
              <span>Accuracy</span>
              <strong>{totalQuestions ? Math.round((score / totalQuestions) * 100) : 0}%</strong>
            </article>
            <article className="summary-card">
              <span>Questions answered</span>
              <strong>{results.length}</strong>
            </article>
            <article className="summary-card">
              <span>Correct answers</span>
              <strong>{score}</strong>
            </article>
          </div>

          <div className="review-list">
            {results.map((result, index) => (
              <article className={`review-card ${result.isCorrect ? 'correct' : 'incorrect'}`} key={`${result.questionId}-${index}`}>
                <div className="review-header">
                  <p>Question {index + 1}</p>
                  <strong>{result.isCorrect ? 'Correct' : 'Wrong'}</strong>
                </div>
                <p className="review-type">{result.type === 'fill-up' ? 'Fill up' : result.type === 'true-false' ? 'True / false' : 'Multiple choice'}</p>
                <h3>{result.prompt}</h3>
                <p>
                  Your answer: <span>{result.chosen}</span>
                </p>
                <p>
                  Correct answer: <span>{result.correct}</span>
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default App;
