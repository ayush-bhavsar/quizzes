import { useMemo, useState } from 'react';

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

  const startQuiz = () => {
    const invalidQuestion = questions.find((question) => {
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

    if (!readyQuestions.length) {
      setError('Add at least one question before generating the quiz.');
      return;
    }

    if (invalidQuestion) {
      setError('Fill in every question prompt and the required answer fields for each question type before generating the quiz.');
      return;
    }

    const generatedQuiz = shuffle(
      questions.map((question) => {
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
    );

    setQuiz(generatedQuiz);
    setCurrentIndex(0);
    setSelectedAnswer('');
    setScore(0);
    setResults([]);
    setPhase('quiz');
    setError('');
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
              <button className="secondary-button" onClick={startQuiz} type="button">
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
            </div>

            <button className="primary-button launch-button" onClick={startQuiz} type="button">
              Build my quiz
            </button>
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
