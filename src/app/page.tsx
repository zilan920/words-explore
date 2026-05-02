"use client";

import type { ChangeEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  Brain,
  CheckCircle2,
  Database,
  Download,
  Gauge,
  History,
  ListChecks,
  Loader2,
  Palette,
  PencilLine,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  UserRound
} from "lucide-react";
import {
  getLearningGoalShortLabel,
  learningGoalOptions,
  type LearningGoal
} from "@/lib/learningGoals";
import type { RecommendationWordInput, UserState, WordAction, WordRecordRow } from "@/lib/types";

type Tab = "study" | "history" | "settings";
type AppTheme = "focus" | "sketch";

interface AssessmentQuestionView {
  id: string;
  word: string;
  difficulty: number;
  options: string[];
}

interface AssessmentView {
  sessionId: string;
  questions: AssessmentQuestionView[];
}

interface SubmitResult {
  score: number;
  estimatedLevel: string;
  targetDifficulty: number;
}

interface SseEvent {
  event: string;
  data: string;
}

interface RecommendationStreamPayload {
  word?: RecommendationWordInput;
  words?: WordRecordRow[];
  state?: UserState;
  error?: string;
}

interface GenerateRecommendationsOptions {
  replaceCurrent?: boolean;
  count?: number;
}

const usernameKey = "words-explore.username";
const accessTokenKey = "words-explore.accessToken";
const themeKey = "words-explore.theme";
const unknownAnswer = "我不认识";
const singleRecommendationCount = 1;
const studyQueueTargetSize = 3;
const swipeExitMs = 260;
const recommendationRetryFallbackMs = 10_000;

const themeOptions: Array<{
  id: AppTheme;
  label: string;
  description: string;
}> = [
  {
    id: "focus",
    label: "专注",
    description: "清爽卡片与稳定学习节奏"
  },
  {
    id: "sketch",
    label: "手绘",
    description: "彩色贴纸、涂鸦边框与动感按钮"
  }
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const accessToken = getStoredAccessToken();

  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(path, {
    ...init,
    headers
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "请求失败");
  }

  return payload as T;
}

function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(accessTokenKey);
}

function clearStoredSession(): void {
  window.localStorage.removeItem(usernameKey);
  window.localStorage.removeItem(accessTokenKey);
}

function storeSession(username: string, accessToken: string): void {
  window.localStorage.setItem(usernameKey, username);
  window.localStorage.setItem(accessTokenKey, accessToken);
}

function readStoredTheme(): AppTheme {
  if (typeof window === "undefined") {
    return "focus";
  }

  const stored = window.localStorage.getItem(themeKey);
  return stored === "sketch" ? "sketch" : "focus";
}

function storeTheme(theme: AppTheme): void {
  window.localStorage.setItem(themeKey, theme);
}

function consumeSseEvents(buffer: string): { events: SseEvent[]; remainder: string } {
  const events: SseEvent[] = [];
  let remainder = buffer;
  let boundaryIndex = remainder.indexOf("\n\n");

  while (boundaryIndex >= 0) {
    const rawEvent = remainder.slice(0, boundaryIndex);
    remainder = remainder.slice(boundaryIndex + 2);
    boundaryIndex = remainder.indexOf("\n\n");

    if (!rawEvent.trim()) {
      continue;
    }

    let eventName = "message";
    const dataLines: string[] = [];

    for (const line of rawEvent.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
        continue;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    events.push({
      event: eventName,
      data: dataLines.join("\n")
    });
  }

  return { events, remainder };
}

function parseRecommendationStreamPayload(event: SseEvent): RecommendationStreamPayload {
  if (!event.data) {
    return {};
  }

  return JSON.parse(event.data) as RecommendationStreamPayload;
}

function getRecommendationRetryDelayMs(message: string): number | null {
  const match = message.match(/(\d+)\s*秒后/);
  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return recommendationRetryFallbackMs;
  }

  return seconds * 1000;
}

function appendUniqueWords(current: WordRecordRow[], next: WordRecordRow[]): WordRecordRow[] {
  const seen = new Set(current.map((word) => word.id));
  return [...current, ...next.filter((word) => !seen.has(word.id))];
}

function applyWordUpdates(current: WordRecordRow[], nextState: UserState): WordRecordRow[] {
  const updates = new Map(nextState.history.map((word) => [word.id, word]));
  return current.map((word) => updates.get(word.id) ?? word);
}

function getStudyWordsFromState(nextState: UserState): WordRecordRow[] {
  return nextState.history
    .filter((word) => word.status === "new")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export default function Home() {
  const [username, setUsername] = useState<string | null>(null);
  const [state, setState] = useState<UserState | null>(null);
  const [selectedLearningGoal, setSelectedLearningGoal] = useState<LearningGoal>("cet4");
  const [tab, setTab] = useState<Tab>("study");
  const [assessment, setAssessment] = useState<AssessmentView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [theme, setTheme] = useState<AppTheme>("focus");
  const [busy, setBusy] = useState<string | null>("boot");
  const [error, setError] = useState<string | null>(null);
  const [studyWords, setStudyWords] = useState<WordRecordRow[]>([]);
  const [recommendationBusy, setRecommendationBusy] = useState(false);
  const [recommendationRetryAt, setRecommendationRetryAt] = useState<number | null>(null);
  const [discardingWord, setDiscardingWord] = useState<{
    id: string;
    action: WordAction;
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const recommendationRequestRef = useRef(false);

  const currentQuestion = assessment?.questions[questionIndex] ?? null;
  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);
  const displayedStudyWords = studyWords;
  const queuedStudyWords = useMemo(
    () => studyWords.filter((word) => word.status === "new").slice(0, studyQueueTargetSize),
    [studyWords]
  );

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  const loadState = useCallback(async (nextUsername: string) => {
    try {
      setBusy("state");
      setError(null);
      setRecommendationRetryAt(null);
      setDiscardingWord(null);
      const payload = await api<{ state: UserState }>("/api/users/state", {
        method: "POST",
        body: JSON.stringify({ username: nextUsername })
      });
      setState(payload.state);
      setStudyWords(getStudyWordsFromState(payload.state));
    } catch (loadError) {
      clearStoredSession();
      setUsername(null);
      setState(null);
      setStudyWords([]);
      setError(loadError instanceof Error ? loadError.message : "无法载入数据");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(usernameKey);
    const accessToken = window.localStorage.getItem(accessTokenKey);
    if (!stored || !accessToken) {
      clearStoredSession();
      setBusy(null);
      return;
    }

    setUsername(stored);
    void loadState(stored);
  }, [loadState]);

  async function beginLearning() {
    try {
      setBusy("create");
      setError(null);
      setStudyWords([]);
      setRecommendationBusy(false);
      setRecommendationRetryAt(null);
      setDiscardingWord(null);
      const payload = await api<{ username: string; accessToken: string; state: UserState }>("/api/users/random", {
        method: "POST",
        body: JSON.stringify({ learningGoal: selectedLearningGoal })
      });
      const assessmentPayload = await api<AssessmentView>("/api/assessment/start", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${payload.accessToken}`
        },
        body: JSON.stringify({ username: payload.username })
      });

      storeSession(payload.username, payload.accessToken);
      setUsername(payload.username);
      setState(payload.state);
      setStudyWords(getStudyWordsFromState(payload.state));
      setResult(null);
      setAnswers({});
      setQuestionIndex(0);
      setAssessment(assessmentPayload);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "启动失败");
    } finally {
      setBusy(null);
    }
  }

  async function startAssessment() {
    if (!username) {
      return;
    }

    try {
      setBusy("assessment");
      setError(null);
      setRecommendationBusy(false);
      setRecommendationRetryAt(null);
      setDiscardingWord(null);
      const payload = await api<AssessmentView>("/api/assessment/start", {
        method: "POST",
        body: JSON.stringify({ username })
      });
      setAssessment(payload);
      setAnswers({});
      setQuestionIndex(0);
      setResult(null);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "初测启动失败");
    } finally {
      setBusy(null);
    }
  }

  async function submitAssessment() {
    if (!username || !assessment || answeredCount !== assessment.questions.length) {
      return;
    }

    try {
      setBusy("submit");
      setError(null);
      setStudyWords([]);
      setRecommendationBusy(false);
      setRecommendationRetryAt(null);
      setDiscardingWord(null);
      const payload = await api<{
        score: number;
        estimatedLevel: string;
        targetDifficulty: number;
        state: UserState;
      }>("/api/assessment/submit", {
        method: "POST",
        body: JSON.stringify({
          username,
          sessionId: assessment.sessionId,
          answers: assessment.questions.map((question) => ({
            questionId: question.id,
            selectedAnswer: answers[question.id]
          }))
        })
      });
      setResult({
        score: payload.score,
        estimatedLevel: payload.estimatedLevel,
        targetDifficulty: payload.targetDifficulty
      });
      setState(payload.state);
      setStudyWords(getStudyWordsFromState(payload.state));
      setAssessment(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交失败");
    } finally {
      setBusy(null);
    }
  }

  const generateRecommendations = useCallback(async (options?: GenerateRecommendationsOptions) => {
    if (!username) {
      return;
    }

    if (recommendationRequestRef.current) {
      return;
    }

    const replaceCurrent = options?.replaceCurrent === true;
    const requestedCount = options?.count ?? singleRecommendationCount;
    recommendationRequestRef.current = true;

    try {
      setRecommendationBusy(true);
      setRecommendationRetryAt(null);
      setError(null);
      if (replaceCurrent) {
        setStudyWords([]);
      }
      const accessToken = getStoredAccessToken();
      const response = await fetch("/api/recommendations/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({ username, count: requestedCount })
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "推荐失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completedState: UserState | null = null;

      try {
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const parsed = consumeSseEvents(buffer);
          buffer = parsed.remainder;

          for (const event of parsed.events) {
            const payload = parseRecommendationStreamPayload(event);

            if (event.event === "fallback") {
              continue;
            }

            if (event.event === "thinking" || event.event === "word") {
              continue;
            }

            if (event.event === "complete" && payload.state) {
              completedState = payload.state;
              const completedWords = payload.words ?? payload.state.latestWords;
              setState(payload.state);
              setStudyWords((current) =>
                replaceCurrent ? completedWords : appendUniqueWords(current, completedWords)
              );
              continue;
            }

            if (event.event === "error") {
              throw new Error(payload.error ?? "推荐失败");
            }
          }

          if (done) {
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (!completedState) {
        throw new Error("推荐流结束但没有完成事件");
      }

      setTab("study");
    } catch (recommendError) {
      const message = recommendError instanceof Error ? recommendError.message : "推荐失败";
      const retryDelayMs = getRecommendationRetryDelayMs(message);
      setRecommendationRetryAt(Date.now() + (retryDelayMs ?? recommendationRetryFallbackMs));
      setError(retryDelayMs ? null : message);
    } finally {
      recommendationRequestRef.current = false;
      setRecommendationBusy(false);
    }
  }, [username]);

  useEffect(() => {
    if (recommendationRetryAt === null) {
      return;
    }

    const retryInMs = recommendationRetryAt - Date.now();
    if (retryInMs <= 0) {
      setRecommendationRetryAt(null);
      return;
    }

    const timer = window.setTimeout(() => {
      setRecommendationRetryAt(null);
    }, retryInMs);

    return () => window.clearTimeout(timer);
  }, [recommendationRetryAt]);

  useEffect(() => {
    const systemBusy =
      busy === "boot" ||
      busy === "state" ||
      busy === "create" ||
      busy === "assessment" ||
      busy === "submit" ||
      busy === "import" ||
      busy === "reset" ||
      busy === "rename" ||
      busy === "export" ||
      Boolean(busy?.startsWith("goal:"));

    if (
      !username ||
      !state?.user.assessmentCompletedAt ||
      assessment ||
      tab !== "study" ||
      systemBusy ||
      recommendationBusy ||
      (recommendationRetryAt !== null && recommendationRetryAt > Date.now()) ||
      recommendationRequestRef.current ||
      queuedStudyWords.length >= studyQueueTargetSize
    ) {
      return;
    }

    void generateRecommendations({ count: singleRecommendationCount });
  }, [
    assessment,
    busy,
    generateRecommendations,
    queuedStudyWords.length,
    recommendationBusy,
    recommendationRetryAt,
    state?.user.assessmentCompletedAt,
    tab,
    username
  ]);

  async function actOnWord(
    wordId: string,
    action: WordAction,
    options?: { skipStudyWordsUpdate?: boolean }
  ): Promise<boolean> {
    if (!username) {
      return false;
    }

    try {
      setBusy(wordId);
      setError(null);
      const payload = await api<{ state: UserState }>("/api/words/action", {
        method: "POST",
        body: JSON.stringify({ username, wordId, action })
      });
      setState(payload.state);
      if (!options?.skipStudyWordsUpdate) {
        setStudyWords((current) => applyWordUpdates(current, payload.state));
      }
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "记录失败");
      return false;
    } finally {
      setBusy(null);
    }
  }

  function actOnStudyWord(word: WordRecordRow, action: WordAction) {
    if (busy === word.id || discardingWord) {
      return;
    }

    setDiscardingWord({ id: word.id, action });
    const removalTimer = window.setTimeout(() => {
      setStudyWords((current) => current.filter((currentWord) => currentWord.id !== word.id));
    }, swipeExitMs);

    void (async () => {
      const success = await actOnWord(word.id, action, { skipStudyWordsUpdate: true });
      if (!success) {
        window.clearTimeout(removalTimer);
        setStudyWords((current) =>
          current.some((currentWord) => currentWord.id === word.id) ? current : [word, ...current]
        );
      }

      window.setTimeout(() => {
        setDiscardingWord((current) => (current?.id === word.id ? null : current));
      }, swipeExitMs);
    })();
  }

  async function importDatabase(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !username) {
      return;
    }

    try {
      setBusy("import");
      setError(null);
      setStudyWords([]);
      setRecommendationBusy(false);
      setRecommendationRetryAt(null);
      setDiscardingWord(null);
      const formData = new FormData();
      formData.append("username", username);
      formData.append("file", file);
      const payload = await api<{ username: string; state: UserState }>("/api/db/import", {
        method: "POST",
        body: formData
      });
      window.localStorage.setItem(usernameKey, payload.username);
      setUsername(payload.username);
      setState(payload.state);
      setStudyWords(getStudyWordsFromState(payload.state));
      setTab("study");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "导入失败");
    } finally {
      setBusy(null);
      event.target.value = "";
    }
  }

  async function resetUserData() {
    if (!username) {
      return;
    }

    try {
      setBusy("reset");
      setError(null);
      setStudyWords([]);
      setRecommendationBusy(false);
      setRecommendationRetryAt(null);
      setDiscardingWord(null);
      const payload = await api<{ state: UserState }>("/api/users/reset", {
        method: "POST",
        body: JSON.stringify({ username })
      });
      setState(payload.state);
      setStudyWords(getStudyWordsFromState(payload.state));
      setAssessment(null);
      setAnswers({});
      setQuestionIndex(0);
      setResult(null);
      setTab("study");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "重置失败");
    } finally {
      setBusy(null);
    }
  }

  async function renameUser(nextUsernameInput: string) {
    if (!username) {
      return;
    }

    const nextUsername = nextUsernameInput.trim().toLowerCase();

    if (!nextUsername || nextUsername === username) {
      return;
    }

    try {
      setBusy("rename");
      setError(null);
      setRecommendationRetryAt(null);
      setDiscardingWord(null);
      const payload = await api<{ username: string; state: UserState }>("/api/users/rename", {
        method: "POST",
        body: JSON.stringify({ username, newUsername: nextUsername })
      });
      window.localStorage.setItem(usernameKey, payload.username);
      setUsername(payload.username);
      setState(payload.state);
      setStudyWords(getStudyWordsFromState(payload.state));
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "修改失败");
    } finally {
      setBusy(null);
    }
  }

  async function updateLearningGoal(nextLearningGoal: LearningGoal) {
    if (!username || state?.user.learningGoal === nextLearningGoal) {
      return;
    }

    try {
      setBusy(`goal:${nextLearningGoal}`);
      setError(null);
      setRecommendationBusy(false);
      setRecommendationRetryAt(null);
      setDiscardingWord(null);
      const payload = await api<{ state: UserState }>("/api/users/learning-goal", {
        method: "POST",
        body: JSON.stringify({ username, learningGoal: nextLearningGoal })
      });
      setState(payload.state);
      setStudyWords(getStudyWordsFromState(payload.state));
      setAssessment(null);
      setAnswers({});
      setQuestionIndex(0);
      setResult(null);
    } catch (goalError) {
      setError(goalError instanceof Error ? goalError.message : "目标修改失败");
    } finally {
      setBusy(null);
    }
  }

  async function exportDatabase() {
    if (!username) {
      return;
    }

    try {
      setBusy("export");
      setError(null);
      const accessToken = getStoredAccessToken();
      const response = await fetch(`/api/db/export?username=${encodeURIComponent(username)}`, {
        headers: accessToken
          ? {
              Authorization: `Bearer ${accessToken}`
            }
          : undefined
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "导出失败");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${username}.sqlite`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "导出失败");
    } finally {
      setBusy(null);
    }
  }

  function pickAnswer(questionId: string, option: string) {
    setAnswers((current) => ({ ...current, [questionId]: option }));
  }

  function nextQuestion() {
    if (!assessment) {
      return;
    }

    if (questionIndex < assessment.questions.length - 1) {
      setQuestionIndex((index) => index + 1);
      return;
    }

    void submitAssessment();
  }

  function changeTheme(nextTheme: AppTheme) {
    setTheme(nextTheme);
    storeTheme(nextTheme);
  }

  return (
    <main className="mobile-shell flex flex-col" data-theme={theme}>
      <header className="safe-pad sticky top-0 z-10 bg-mist/90 py-3 backdrop-blur-xl">
        {username && state ? (
          <div className="control-card app-header-card flex min-h-[60px] items-center gap-3 px-3 py-2 shadow-press">
            <div className="brand-mark flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-iris text-white">
              <BookOpenCheck size={21} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-normal text-steel">Words Explore</p>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm font-black text-ink">
                <UserRound className="shrink-0 text-leaf" size={15} aria-hidden />
                <span className="truncate">{username}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="rounded-md bg-lilac px-2 py-1 text-[11px] font-black text-iris">
                {getLearningGoalShortLabel(state.user.learningGoal)}
              </span>
              <span className="rounded-md bg-leaf/10 px-2 py-1 text-[11px] font-black text-leaf">
                {state.user.estimatedLevel ?? "初测"}
              </span>
              <WordQueueDots readyCount={queuedStudyWords.length} total={studyQueueTargetSize} />
            </div>
          </div>
        ) : (
          <div className="flex min-h-[60px] items-center gap-3">
            <div className="brand-mark flex h-10 w-10 items-center justify-center rounded-lg bg-iris text-white shadow-press">
              <BookOpenCheck size={21} aria-hidden />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-normal text-steel">Words Explore</p>
              <h1 className="text-xl font-black leading-tight text-ink">词汇探索</h1>
            </div>
          </div>
        )}
      </header>

      {error ? (
        <div className="safe-pad mt-4">
          <div className="rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-sm font-bold text-coral">
            {error}
          </div>
        </div>
      ) : null}

      <section className="safe-pad flex-1 pb-28 pt-3">
        {busy === "boot" ? (
          <CenteredLoader label="载入中" />
        ) : !username || !state ? (
          <CreateUser
            busy={busy === "create"}
            theme={theme}
            selectedGoal={selectedLearningGoal}
            onThemeChange={changeTheme}
            onGoalChange={setSelectedLearningGoal}
            onCreate={beginLearning}
          />
        ) : tab === "study" ? (
          <StudyView
            state={state}
            busy={busy}
            result={result}
            assessment={assessment}
            currentQuestion={currentQuestion}
            questionIndex={questionIndex}
            answers={answers}
            answeredCount={answeredCount}
            latestWords={displayedStudyWords}
            recommendationBusy={recommendationBusy}
            recommendationRetryAt={recommendationRetryAt}
            queueTargetSize={studyQueueTargetSize}
            exitingWord={discardingWord}
            onStartAssessment={startAssessment}
            onPickAnswer={pickAnswer}
            onNextQuestion={nextQuestion}
            onGenerate={generateRecommendations}
            onAct={actOnStudyWord}
          />
        ) : tab === "history" ? (
          <HistoryView words={state.history} busy={busy} onAct={actOnWord} />
        ) : (
          <SettingsView
            username={username}
            state={state}
            theme={theme}
            busy={busy}
            onThemeChange={changeTheme}
            onRename={renameUser}
            onReset={resetUserData}
            onLearningGoalChange={updateLearningGoal}
            onExport={exportDatabase}
            onImport={() => importInputRef.current?.click()}
          />
        )}
      </section>

      {username ? (
        <nav className="safe-pad fixed bottom-0 left-1/2 z-40 w-full max-w-[520px] -translate-x-1/2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
          <div className="bottom-nav grid grid-cols-3 rounded-lg border border-line bg-white/95 p-1 shadow-soft backdrop-blur-xl">
          <TabButton active={tab === "study"} label="学习" icon={<Sparkles size={19} />} onClick={() => setTab("study")} />
          <TabButton active={tab === "history"} label="记录" icon={<History size={19} />} onClick={() => setTab("history")} />
          <TabButton active={tab === "settings"} label="设置" icon={<Settings size={19} />} onClick={() => setTab("settings")} />
          </div>
        </nav>
      ) : null}

      <input
        ref={importInputRef}
        className="hidden"
        type="file"
        accept=".sqlite,.db,application/vnd.sqlite3,application/octet-stream"
        onChange={importDatabase}
      />
    </main>
  );
}

function WordQueueDots({
  readyCount,
  total
}: {
  readyCount: number;
  total: number;
}) {
  return (
    <div
      className="word-queue-dots flex items-center gap-1 pt-0.5"
      aria-label={`单词准备状态：${Math.min(readyCount, total)}/${total}`}
      role="img"
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={`queue-dot h-1.5 w-1.5 rounded-full transition-colors duration-200 ${
            index < readyCount ? "bg-leaf" : "bg-line"
          }`}
          aria-hidden
        />
      ))}
    </div>
  );
}

function CreateUser({
  busy,
  theme,
  selectedGoal,
  onThemeChange,
  onGoalChange,
  onCreate
}: {
  busy: boolean;
  theme: AppTheme;
  selectedGoal: LearningGoal;
  onThemeChange: (theme: AppTheme) => void;
  onGoalChange: (goal: LearningGoal) => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex min-h-[calc(100dvh-150px)] flex-col justify-center gap-5">
      <section className="surface-card hero-card overflow-hidden">
        <div className="border-b border-line bg-lilac/70 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-iris text-white shadow-press">
              <Brain size={22} aria-hidden />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-normal text-iris">10 题初测</p>
              <h2 className="mt-1 text-2xl font-black leading-tight text-ink">先定位你的词汇区间</h2>
            </div>
          </div>
        </div>

        <div className="px-5 py-5">
          <div className="grid grid-cols-3 gap-2">
            <OnboardingSignal icon={<Target size={17} aria-hidden />} label="目标" value="可切换" />
            <OnboardingSignal icon={<Gauge size={17} aria-hidden />} label="难度" value="自动估计" />
            <OnboardingSignal icon={<ListChecks size={17} aria-hidden />} label="单词" value="分批推荐" />
          </div>

          <div className="theme-picker mt-5">
            <p className="text-sm font-black text-ink">主题</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {themeOptions.map((option) => (
                <ThemeChoice
                  key={option.id}
                  option={option}
                  active={theme === option.id}
                  onClick={() => onThemeChange(option.id)}
                />
              ))}
            </div>
          </div>

          <div className="mt-5">
            <p className="text-sm font-black text-ink">学习目标</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
            {learningGoalOptions.map((goal) => {
              const active = selectedGoal === goal.id;

              return (
                <button
                  key={goal.id}
                  className={`goal-choice min-h-[82px] cursor-pointer rounded-lg border px-3 py-3 text-left transition duration-200 ${
                    active
                      ? "is-active border-iris bg-lilac text-iris shadow-press"
                      : "border-line bg-white text-ink hover:border-iris/35 hover:bg-lilac/40"
                  }`}
                  disabled={busy}
                  onClick={() => onGoalChange(goal.id)}
                >
                  <span className="block text-base font-black">{goal.shortLabel}</span>
                  <span className="mt-1 block text-xs font-semibold leading-5 text-steel">
                    {goal.description}
                  </span>
                </button>
              );
            })}
            </div>
          </div>

          <button
            className="button-base start-button mt-6 w-full bg-leaf px-4 text-white shadow-press"
            disabled={busy}
            onClick={onCreate}
          >
            {busy ? <Loader2 className="animate-spin" size={20} aria-hidden /> : <ArrowRight size={20} aria-hidden />}
            开始
          </button>
        </div>
      </section>
    </div>
  );
}

function OnboardingSignal({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="signal-card rounded-lg border border-line bg-paper px-2.5 py-3 text-center">
      <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-leaf/10 text-leaf">
        {icon}
      </div>
      <p className="mt-2 text-[11px] font-black text-steel">{label}</p>
      <p className="mt-0.5 truncate text-xs font-black text-ink">{value}</p>
    </div>
  );
}

function StudyView({
  state,
  busy,
  result,
  assessment,
  currentQuestion,
  questionIndex,
  answers,
  answeredCount,
  latestWords,
  recommendationBusy,
  recommendationRetryAt,
  queueTargetSize,
  exitingWord,
  onStartAssessment,
  onPickAnswer,
  onNextQuestion,
  onGenerate,
  onAct
}: {
  state: UserState;
  busy: string | null;
  result: SubmitResult | null;
  assessment: AssessmentView | null;
  currentQuestion: AssessmentQuestionView | null;
  questionIndex: number;
  answers: Record<string, string>;
  answeredCount: number;
  latestWords: WordRecordRow[];
  recommendationBusy: boolean;
  recommendationRetryAt: number | null;
  queueTargetSize: number;
  exitingWord: { id: string; action: WordAction } | null;
  onStartAssessment: () => void;
  onPickAnswer: (questionId: string, option: string) => void;
  onNextQuestion: () => void;
  onGenerate: (options?: GenerateRecommendationsOptions) => void;
  onAct: (word: WordRecordRow, action: WordAction) => void;
}) {
  const queuedWords = useMemo(
    () => latestWords.filter((word) => word.status === "new").slice(0, queueTargetSize),
    [latestWords, queueTargetSize]
  );
  const currentWord = queuedWords[0] ?? null;
  const exitAction = currentWord && exitingWord?.id === currentWord.id ? exitingWord.action : null;
  const waitingForRetry = recommendationRetryAt !== null && recommendationRetryAt > Date.now();
  const preparingWords = recommendationBusy || waitingForRetry;

  if (!state.user.assessmentCompletedAt && !assessment) {
    return (
      <div className="surface-card stage-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber/15 text-amber">
            <Gauge size={22} aria-hidden />
          </div>
          <div>
            <p className="text-sm font-black text-amber">10 题初测</p>
            <h2 className="mt-1 text-2xl font-black leading-tight text-ink">先定位词汇难度</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-steel">
              完成后会直接进入贴近当前水平的学习节奏。
            </p>
          </div>
        </div>
        <button
          className="button-base assessment-button mt-6 w-full bg-ink px-4 text-white shadow-press"
          disabled={busy === "assessment"}
          onClick={onStartAssessment}
        >
          {busy === "assessment" ? (
            <Loader2 className="animate-spin" size={20} aria-hidden />
          ) : (
            <ArrowRight size={20} aria-hidden />
          )}
          开始初测
        </button>
      </div>
    );
  }

  if (assessment && currentQuestion) {
    const picked = answers[currentQuestion.id];
    const isLast = questionIndex === assessment.questions.length - 1;
    const progress = `${((questionIndex + 1) / assessment.questions.length) * 100}%`;

    return (
      <div className="surface-card quiz-card p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-black text-steel">
            {questionIndex + 1} / {assessment.questions.length}
          </span>
          <span className="rounded-md bg-amber/15 px-2 py-1 text-xs font-black text-amber">
            难度 {currentQuestion.difficulty}
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-iris transition-[width] duration-300 ease-out" style={{ width: progress }} />
        </div>
        <h2 className="mt-6 break-words text-4xl font-black leading-tight text-ink">{currentQuestion.word}</h2>
        <div className="mt-6 grid gap-3">
          {[...currentQuestion.options, unknownAnswer].map((option) => (
            <button
              key={option}
              className={`answer-choice min-h-12 cursor-pointer rounded-lg border px-4 text-left text-base font-bold transition duration-200 ${
                picked === option
                  ? "is-selected border-iris bg-lilac text-iris shadow-press"
                  : "border-line bg-white text-ink hover:border-iris/35 hover:bg-lilac/40"
              }`}
              onClick={() => onPickAnswer(currentQuestion.id, option)}
            >
              {option}
            </button>
          ))}
        </div>
        <button
          className="button-base next-button mt-6 w-full bg-leaf px-4 text-white shadow-press"
          disabled={!picked || busy === "submit"}
          onClick={onNextQuestion}
        >
          {busy === "submit" ? (
            <Loader2 className="animate-spin" size={20} aria-hidden />
          ) : (
            <ArrowRight size={20} aria-hidden />
          )}
          {isLast ? `提交 ${answeredCount}/${assessment.questions.length}` : "下一题"}
        </button>
      </div>
    );
  }

  if (result && !currentWord && state.stats.totalWords === 0) {
    return (
      <ResultPanel
        result={result}
        busy={preparingWords}
        recommendationRetryAt={recommendationRetryAt}
        onGenerate={onGenerate}
      />
    );
  }

  if (!currentWord) {
    return (
      <div className="surface-card stage-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-leaf/10 text-leaf">
            <Sparkles size={22} aria-hidden />
          </div>
          <div>
            <p className="text-sm font-black text-leaf">等级 {state.user.estimatedLevel}</p>
            <h2 className="mt-1 text-2xl font-black leading-tight text-ink">正在准备下一个单词</h2>
          </div>
        </div>
        {preparingWords ? <GenerationStatus recommendationRetryAt={recommendationRetryAt} /> : null}
        <button
          className="button-base generate-button mt-6 w-full bg-leaf px-4 text-white shadow-press"
          disabled={preparingWords}
          onClick={() => onGenerate({ count: singleRecommendationCount })}
        >
          {preparingWords ? (
            <Loader2 className="animate-spin" size={20} aria-hidden />
          ) : (
            <Sparkles size={20} aria-hidden />
          )}
          开始学习
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        <Metric label="已学会" value={state.stats.learned} tone="leaf" />
        <Metric label="太简单" value={state.stats.tooEasy} tone="amber" />
        <Metric label="继续学" value={state.stats.learning} tone="steel" />
      </div>
      <div className="single-card-stage">
        <StudyWordCard
          word={currentWord}
          busy={busy === currentWord.id}
          exitAction={exitAction}
          onAct={onAct}
        />
      </div>
    </div>
  );
}

function ResultPanel({
  result,
  busy,
  recommendationRetryAt,
  onGenerate
}: {
  result: SubmitResult;
  busy: boolean;
  recommendationRetryAt: number | null;
  onGenerate: (options?: GenerateRecommendationsOptions) => void;
}) {
  const levelSummary = getEstimatedLevelSummary(result.estimatedLevel, result.targetDifficulty);

  return (
    <div className="surface-card result-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-leaf/10 text-leaf">
          <ShieldCheck size={22} aria-hidden />
        </div>
        <div>
          <p className="text-sm font-black text-leaf">初测完成</p>
          <h2 className="mt-1 text-2xl font-black leading-tight text-ink">你的大概程度：{result.estimatedLevel}</h2>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-leaf/20 bg-leaf/10 px-3 py-3 text-sm leading-6 text-ink">
        <p className="mt-1 font-semibold text-steel">{levelSummary}</p>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <Metric label="得分" value={result.score} tone="leaf" />
        <Metric label="等级" value={result.estimatedLevel} tone="steel" />
        <Metric label="目标" value={result.targetDifficulty} tone="amber" />
      </div>
      {busy ? <GenerationStatus recommendationRetryAt={recommendationRetryAt} /> : null}
      <button
        className="button-base generate-button mt-6 w-full bg-leaf px-4 text-white shadow-press"
        disabled={busy}
        onClick={() => onGenerate({ count: singleRecommendationCount })}
      >
        {busy ? <Loader2 className="animate-spin" size={20} aria-hidden /> : <Sparkles size={20} aria-hidden />}
        开始学习
      </button>
    </div>
  );
}

function getEstimatedLevelSummary(level: string, targetDifficulty: number): string {
  const base =
    level === "入门"
      ? "适合先巩固高频基础词和核心释义。"
      : level === "进阶"
        ? "常用词基础已经建立，适合扩展考试和阅读场景词。"
        : level === "熟练"
          ? "基础较扎实，可以挑战更细的语义辨析和中高难场景词。"
          : "词汇基础较强，适合高阶学术词、抽象词和近义辨析。";

  return `${base} 后续推荐会从难度 ${targetDifficulty} 附近开始。`;
}

function GenerationStatus({
  recommendationRetryAt
}: {
  recommendationRetryAt?: number | null;
}) {
  const retrySeconds =
    recommendationRetryAt && recommendationRetryAt > Date.now()
      ? Math.max(1, Math.ceil((recommendationRetryAt - Date.now()) / 1000))
      : null;

  return (
    <div className="mt-4 flex min-h-11 items-center gap-2 rounded-lg border border-amber/25 bg-amber/10 px-3 text-sm font-bold text-amber">
      <Loader2 className="shrink-0 animate-spin" size={16} aria-hidden />
      <span>
        {retrySeconds
          ? `正在等待服务恢复，约 ${retrySeconds} 秒`
          : "正在准备下一个单词"}
      </span>
    </div>
  );
}

function StudyWordCard({
  word,
  busy,
  exitAction,
  onAct
}: {
  word: WordRecordRow;
  busy: boolean;
  exitAction: WordAction | null;
  onAct: (word: WordRecordRow, action: WordAction) => void;
}) {
  const disabled = busy || Boolean(exitAction);
  const exitClass =
    exitAction === "learned"
      ? "swipe-exit-right"
      : exitAction === "too_easy"
        ? "swipe-exit-up"
        : exitAction === "learning"
          ? "swipe-exit-left"
          : "";

  return (
    <article
      className={`word-card single-word-card rounded-lg border border-line bg-white p-4 shadow-soft ${exitClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-4xl font-black leading-tight text-ink">{word.word}</h3>
          <p className="mt-1 text-sm font-bold text-steel">
            {word.partOfSpeech} · 难度 {word.difficulty}
          </p>
        </div>
        <StatusBadge status={word.status} />
      </div>
      <p className="definition-chip mt-5 rounded-lg border border-leaf/20 bg-leaf/10 px-3 py-2 text-lg font-black leading-7 text-leaf">
        {word.definitionZh}
      </p>
      <p className="example-chip mt-3 rounded-lg bg-mist px-3 py-3 text-sm font-semibold leading-6 text-ink">
        {word.exampleEn}
      </p>
      <p className="mt-2 px-1 text-sm font-semibold leading-6 text-steel">{word.exampleZh}</p>
      <p className="reason-note mt-3 border-l-4 border-amber/60 bg-amber/10 px-3 py-2 text-sm font-semibold leading-6 text-steel">
        {word.difficultyReason}
      </p>
      <div className="mt-5 grid grid-cols-3 gap-2">
        <ActionButton
          label="会了"
          icon={<CheckCircle2 size={18} aria-hidden />}
          disabled={disabled}
          active={false}
          onClick={() => onAct(word, "learned")}
        />
        <ActionButton
          label="简单"
          icon={<TrendingUp size={18} aria-hidden />}
          disabled={disabled}
          active={false}
          onClick={() => onAct(word, "too_easy")}
        />
        <ActionButton
          label="继续"
          icon={<RotateCcw size={18} aria-hidden />}
          disabled={disabled}
          active={false}
          onClick={() => onAct(word, "learning")}
        />
      </div>
    </article>
  );
}

function HistoryView({
  words,
  busy,
  onAct
}: {
  words: WordRecordRow[];
  busy: string | null;
  onAct: (wordId: string, action: WordAction) => void;
}) {
  if (words.length === 0) {
    return <EmptyState title="暂无记录" />;
  }

  const learning = words.filter((word) => word.status === "learning");
  const learned = words.filter((word) => word.status === "learned");
  const tooEasy = words.filter((word) => word.status === "too_easy");
  const fresh = words.filter((word) => word.status === "new");

  return (
    <div className="space-y-5">
      <div className="control-card page-heading flex items-center justify-between px-3 py-3">
        <div>
          <p className="text-sm font-bold text-steel">学习记录</p>
          <h2 className="text-2xl font-black text-ink">{words.length} 个词</h2>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-lilac text-iris">
          <History size={22} aria-hidden />
        </div>
      </div>
      <HistorySection
        title="继续学生词本"
        words={learning}
        emptyTitle="暂无继续学习词"
        actionLabel="学会了"
        busy={busy}
        onAction={(wordId) => onAct(wordId, "learned")}
      />
      <HistorySection title="已学会" words={learned} emptyTitle="暂无已学会词" busy={busy} />
      <HistorySection title="太简单" words={tooEasy} emptyTitle="暂无太简单词" busy={busy} />
      {fresh.length > 0 ? (
        <HistorySection title="未标记" words={fresh} emptyTitle="暂无未标记词" busy={busy} />
      ) : null}
    </div>
  );
}

function HistorySection({
  title,
  words,
  emptyTitle,
  actionLabel,
  busy,
  onAction
}: {
  title: string;
  words: WordRecordRow[];
  emptyTitle: string;
  actionLabel?: string;
  busy: string | null;
  onAction?: (wordId: string) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-black text-ink">{title}</h3>
        <span className="rounded-md bg-lilac px-2 py-1 text-xs font-black text-iris">{words.length}</span>
      </div>
      {words.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-white/80 px-4 py-5 text-sm font-semibold text-steel">
          {emptyTitle}
        </div>
      ) : (
        <div className="space-y-3">
          {words.map((word) => (
            <HistoryWordRow
              key={word.id}
              word={word}
              actionLabel={actionLabel}
              busy={busy === word.id}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryWordRow({
  word,
  actionLabel,
  busy,
  onAction
}: {
  word: WordRecordRow;
  actionLabel?: string;
  busy: boolean;
  onAction?: (wordId: string) => void;
}) {
  return (
    <div className="history-row rounded-lg border border-line bg-white p-4 shadow-[0_8px_20px_rgba(21,21,40,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-black text-ink">{word.word}</p>
          <p className="mt-1 text-sm leading-6 text-steel">{word.definitionZh}</p>
        </div>
        <StatusBadge status={word.status} />
      </div>
      {actionLabel && onAction ? (
        <button
          className="button-base mt-3 w-full bg-leaf px-4 text-white shadow-press"
          disabled={busy}
          onClick={() => onAction(word.id)}
        >
          {busy ? <Loader2 className="animate-spin" size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function SettingsView({
  username,
  state,
  theme,
  busy,
  onThemeChange,
  onRename,
  onReset,
  onLearningGoalChange,
  onExport,
  onImport
}: {
  username: string;
  state: UserState;
  theme: AppTheme;
  busy: string | null;
  onThemeChange: (theme: AppTheme) => void;
  onRename: (nextUsername: string) => void;
  onReset: () => void;
  onLearningGoalChange: (goal: LearningGoal) => void;
  onExport: () => void;
  onImport: () => void;
}) {
  const activeGoal = state.user.learningGoal;
  const [usernameDraft, setUsernameDraft] = useState(username);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const normalizedUsernameDraft = usernameDraft.trim().toLowerCase();
  const usernameChanged = normalizedUsernameDraft.length > 0 && normalizedUsernameDraft !== username;

  useEffect(() => {
    setUsernameDraft(username);
  }, [username]);

  useEffect(() => {
    if (busy !== "reset") {
      return;
    }

    setConfirmingReset(false);
  }, [busy]);

  return (
    <div className="space-y-5">
      <div className="control-card page-heading flex items-center justify-between px-3 py-3">
        <div>
          <p className="text-sm font-bold text-steel">账户与数据</p>
          <h2 className="text-2xl font-black text-ink">设置</h2>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-lilac text-iris">
          <Settings size={22} aria-hidden />
        </div>
      </div>

      <section className="surface-card theme-picker space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Palette size={18} aria-hidden />
          <p className="text-sm font-black text-ink">主题</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {themeOptions.map((option) => (
            <ThemeChoice
              key={option.id}
              option={option}
              active={theme === option.id}
              onClick={() => onThemeChange(option.id)}
            />
          ))}
        </div>
      </section>

      <section className="surface-card settings-panel space-y-4 p-4">
        <div className="border-b border-line pb-4">
          <div className="min-w-0">
            <p className="text-xs font-black text-steel">用户 ID</p>
            <div className="mt-2 flex gap-2">
              <input
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm font-black text-ink outline-none transition focus:border-iris"
                value={usernameDraft}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-label="用户 ID"
                disabled={busy === "rename"}
                onChange={(event) => setUsernameDraft(event.target.value)}
              />
              <button
                className="button-base save-button min-h-11 shrink-0 border border-line bg-white px-3 text-sm text-ink"
                disabled={busy === "rename" || !usernameChanged}
                onClick={() => onRename(usernameDraft)}
              >
                {busy === "rename" ? (
                  <Loader2 className="animate-spin" size={16} aria-hidden />
                ) : (
                  <PencilLine size={16} aria-hidden />
                )}
                保存
              </button>
            </div>
            <p className="mt-1 text-xs font-semibold text-steel">小写字母、数字或连字符，3-40 位</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-black text-steel">学习目标</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {learningGoalOptions.map((goal) => {
              const active = activeGoal === goal.id;
              const updating = busy === `goal:${goal.id}`;

              return (
                <button
                  key={goal.id}
                  className={`goal-choice min-h-14 cursor-pointer rounded-lg border px-3 py-2 text-left transition duration-200 ${
                    active
                      ? "is-active border-iris bg-lilac text-iris shadow-press"
                      : "border-line bg-white text-ink hover:border-iris/35 hover:bg-lilac/40"
                  }`}
                  disabled={active || busy?.startsWith("goal:")}
                  onClick={() => onLearningGoalChange(goal.id)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black">{goal.shortLabel}</span>
                    {updating ? <Loader2 className="shrink-0 animate-spin" size={14} aria-hidden /> : null}
                  </span>
                  <span className="mt-1 block truncate text-xs font-semibold text-steel">
                    {goal.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {confirmingReset ? (
          <div className="rounded-lg border border-coral/25 bg-coral/10 p-3">
            <p className="text-sm font-semibold leading-5 text-coral">
              将清空当前 user id 下的初测、推荐和学习记录。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                className="button-base cancel-button border border-line bg-white px-3 text-sm text-ink"
                disabled={busy === "reset"}
                onClick={() => setConfirmingReset(false)}
              >
                取消
              </button>
              <button
                className="button-base reset-button bg-coral px-3 text-sm text-white"
                disabled={busy === "reset"}
                onClick={() => {
                  setConfirmingReset(false);
                  onReset();
                }}
              >
                {busy === "reset" ? (
                  <Loader2 className="animate-spin" size={18} aria-hidden />
                ) : (
                  <RotateCcw size={18} aria-hidden />
                )}
                确认重置
              </button>
            </div>
          </div>
        ) : (
          <button
            className="button-base reset-button w-full border border-coral/25 bg-coral/10 px-4 text-coral"
            disabled={busy === "reset"}
            onClick={() => setConfirmingReset(true)}
          >
            {busy === "reset" ? (
              <Loader2 className="animate-spin" size={20} aria-hidden />
            ) : (
              <RotateCcw size={20} aria-hidden />
            )}
            重置学习数据
          </button>
        )}
      </section>

      <section className="surface-card data-panel space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2.5">
          <Metric label="单词" value={state.stats.totalWords} tone="steel" />
          <Metric label="等级" value={state.user.estimatedLevel ?? "-"} tone="leaf" />
        </div>
        <button
          className="button-base export-button w-full bg-ink px-4 text-white shadow-press"
          disabled={busy === "export"}
          onClick={onExport}
        >
          {busy === "export" ? (
            <Loader2 className="animate-spin" size={20} aria-hidden />
          ) : (
            <Download size={20} aria-hidden />
          )}
          导出数据库
        </button>
        <button
          className="button-base import-button w-full border border-line bg-white px-4 text-ink"
          disabled={busy === "import"}
          onClick={onImport}
        >
          {busy === "import" ? (
            <Loader2 className="animate-spin" size={20} aria-hidden />
          ) : (
            <Upload size={20} aria-hidden />
          )}
          导入数据库
        </button>
      </section>
    </div>
  );
}

function ThemeChoice({
  option,
  active,
  onClick
}: {
  option: (typeof themeOptions)[number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`theme-choice min-h-[84px] cursor-pointer rounded-lg border px-3 py-3 text-left transition duration-200 ${
        active
          ? "is-active border-iris bg-lilac text-iris shadow-press"
          : "border-line bg-white text-ink hover:border-iris/35 hover:bg-lilac/40"
      }`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="block text-base font-black">{option.label}</span>
      <span className="mt-1 block text-xs font-semibold leading-5 text-steel">
        {option.description}
      </span>
    </button>
  );
}

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: number | string;
  tone: "leaf" | "amber" | "steel";
}) {
  const toneClass =
    tone === "leaf"
      ? "border-leaf/20 bg-leaf/10 text-leaf"
      : tone === "amber"
        ? "border-amber/25 bg-amber/15 text-amber"
        : "border-steel/15 bg-white text-steel";
  return (
    <div className={`metric-card metric-${tone} min-h-20 rounded-lg border px-3 py-3 shadow-[0_8px_20px_rgba(21,21,40,0.04)] ${toneClass}`}>
      <p className="text-xs font-black">{label}</p>
      <p className="mt-2 truncate text-2xl font-black">{value}</p>
    </div>
  );
}

function StatusBadge({
  status,
  compact = false
}: {
  status: WordRecordRow["status"];
  compact?: boolean;
}) {
  const label =
    status === "learned" ? "已学会" : status === "too_easy" ? "太简单" : status === "learning" ? "继续学" : "新词";
  const style =
    status === "learned"
      ? "bg-leaf/10 text-leaf"
      : status === "too_easy"
        ? "bg-amber/15 text-amber"
        : status === "learning"
          ? "bg-lilac text-iris"
          : "bg-mist text-ink";

  return (
    <span
      className={`status-badge status-${status} shrink-0 rounded-md font-black ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"} ${style}`}
    >
      {label}
    </span>
  );
}

function ActionButton({
  label,
  icon,
  active,
  disabled,
  onClick
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const actionClass =
    label === "会了" ? "action-learned" : label === "简单" ? "action-easy" : "action-learning";

  return (
    <button
      className={`button-base word-action ${actionClass} min-w-0 px-2 text-sm ${
        active ? "bg-leaf text-white shadow-press" : "border border-line bg-mist text-ink"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function TabButton({
  active,
  label,
  icon,
  onClick
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`tab-button flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-lg text-xs font-black transition duration-200 ${
        active ? "bg-lilac text-iris shadow-[inset_0_-2px_0_rgba(79,70,229,0.12)]" : "text-steel hover:bg-mist"
      }`}
      onClick={onClick}
    >
      {icon}
      <span className="mt-1">{label}</span>
    </button>
  );
}

function CenteredLoader({ label }: { label: string }) {
  return (
    <div className="flex min-h-[48dvh] flex-col items-center justify-center gap-3 text-steel">
      <Loader2 className="animate-spin" size={26} aria-hidden />
      <p className="text-sm font-bold">{label}</p>
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="surface-card p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-lilac text-iris">
        <Database size={22} aria-hidden />
      </div>
      <p className="mt-3 font-black text-steel">{title}</p>
    </div>
  );
}
