import { useMemo, useState } from 'react';

type QuestionDraft = {
  id: string;
  prompt: string;
  options: [string, string, string, string];
  correctIndex: number;
};

type QuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctAnswer: string;
};

type ResultEntry = {
  questionId: string;
  prompt: string;
  chosen: string;
  correct: string;
  isCorrect: boolean;
};

type Phase = 'builder' | 'quiz' | 'summary';

const makeId = () => crypto.randomUUID();

const createBlankQuestion = (): QuestionDraft => ({
  id: makeId(),
  prompt: '',
  options: ['', '', '', ''],
  correctIndex: 0,
});

const createSampleQuestions = (): QuestionDraft[] => [
  {
    id: makeId(),
    prompt: 'Which planet is known as the Red Planet?',
    options: ['Earth', 'Mars', 'Saturn', 'Venus'],
    correctIndex: 1,
  },
  {
    id: makeId(),
    prompt: 'What does HTML stand for?',
    options: [
      'HyperText Markup Language',
      'High Transfer Machine Language',
      'Hyperlink and Text Management Language',
      'Home Tool Markup Language',
    ],
    correctIndex: 0,
  },
  {
    id: makeId(),
    prompt: 'How many continents are there on Earth?',
    options: ['Five', 'Six', 'Seven', 'Eight'],
    correctIndex: 2,
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
  prompt: question.prompt.trim(),
  options: question.options.map((option) => option.trim()),
  correctIndex: question.correctIndex,
});

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
      return !normalized.prompt || normalized.options.some((option) => !option);
    });

    if (!readyQuestions.length) {
      setError('Add at least one question before generating the quiz.');
      return;
    }

    if (invalidQuestion) {
      setError('Fill in every question prompt and all four answer options before generating the quiz.');
      return;
    }

    const generatedQuiz = shuffle(
      questions.map((question) => {
        const normalized = normalizeQuestion(question);
        const correctAnswer = normalized.options[normalized.correctIndex];

        return {
          id: question.id,
          prompt: normalized.prompt,
          options: shuffle(normalized.options),
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

    const isCorrect = selectedAnswer === currentQuestion.correctAnswer;
    const entry: ResultEntry = {
      questionId: currentQuestion.id,
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
          <p className="eyebrow">Quiz Forge</p>
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

                  <div className="options-grid">
                    {question.options.map((option, optionIndex) => (
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
                          placeholder={`Answer option ${optionIndex + 1}`}
                          value={option}
                          onChange={(event) =>
                            updateQuestion(question.id, (currentQuestion) => {
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
                  </div>
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
