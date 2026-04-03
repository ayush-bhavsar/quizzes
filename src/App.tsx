import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import * as XLSX from 'xlsx';

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

type ImportRow = Record<string, unknown>;

type QuizBuildResult = {
  quiz: QuizQuestion[];
  error: string;
};

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

function App() {
  const [questions, setQuestions] = useState<QuestionDraft[]>([createBlankQuestion()]);
  const [phase, setPhase] = useState<Phase>('builder');
  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [score, setScore] = useState(0);
  const [results, setResults] = useState<ResultEntry[]>([]);
  const [error, setError] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const result = createQuizFromQuestions(draftQuestions);

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

  const openImportDialog = () => {
    fileInputRef.current?.click();
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
      const workbook = isCsv
        ? XLSX.read(await file.text(), { type: 'string' })
        : XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheetName = workbook.SheetNames[0];

      if (!sheetName) {
        setError('The selected file does not contain any readable sheets or rows.');
        return;
      }

      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<ImportRow>(worksheet, { defval: '' });
      const importedQuestions = rows.map(createQuestionFromRow).filter((question): question is QuestionDraft => Boolean(question));

      if (!importedQuestions.length) {
        setError('No valid questions were found. Make sure your file includes prompt and answer columns.');
        return;
      }

      setQuestions(importedQuestions);
      startQuiz(importedQuestions);
    } catch {
      setError('Could not read that file. Use a CSV, XLS, or XLSX file with supported question columns.');
    } finally {
      setIsImporting(false);
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
            Add your questions, mark the correct answer, and generate an interactive quiz with scoring and review.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={addQuestion} type="button">
              Add question
            </button>
            <button className="secondary-button" onClick={openImportDialog} type="button">
              {isImporting ? 'Importing...' : 'Import CSV / Excel'}
            </button>
            <button className="secondary-button" onClick={loadSampleQuiz} type="button">
              Load sample quiz
            </button>
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
              <ul>
                <li>One question at a time</li>
                <li>Instant score tracking</li>
                <li>Review of correct and wrong answers</li>
              </ul>
              <p className="type-note">
                Import files with columns like prompt, type, option1 to option4, correctAnswer, or correctIndex.
              </p>
            </div>

            <button className="primary-button launch-button" onClick={() => startQuiz()} type="button">
              Build my quiz
            </button>

            <input
              ref={fileInputRef}
              accept=".csv,.xls,.xlsx"
              aria-label="Import quiz file"
              className="file-input"
              onChange={importQuizFile}
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
