"use client";

import type { ChangeEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  CircleStop,
  Download,
  History,
  Loader2,
  PencilLine,
  RotateCcw,
  Settings,
  Sparkles,
  TrendingUp,
  Upload,
  UserRound
} from "lucide-react";
import { appConfig } from "@/lib/appConfig";
import type { RecommendationWordInput, UserState, WordAction, WordRecordRow } from "@/lib/types";

type Tab = "study" | "history" | "settings";

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

const usernameKey = "words-explore.username";
const accessTokenKey = "words-explore.accessToken";
const unknownAnswer = "我不认识";
const { wordBatchSize, autoNextSeconds } = appConfig;

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

function toStreamingWordRecord(
  username: string,
  word: RecommendationWordInput,
  index: number
): WordRecordRow {
  const now = new Date().toISOString();

  return {
    ...word,
    id: `stream-${index}-${word.word.toLowerCase().replace(/\s+/g, "-")}`,
    batchId: "streaming",
    username,
    status: "new",
    createdAt: now,
    updatedAt: now
  };
}

function appendUniqueWords(current: WordRecordRow[], next: WordRecordRow[]): WordRecordRow[] {
  const seen = new Set(current.map((word) => word.id));
  return [...current, ...next.filter((word) => !seen.has(word.id))];
}

function applyWordUpdates(current: WordRecordRow[], nextState: UserState): WordRecordRow[] {
  const updates = new Map(nextState.history.map((word) => [word.id, word]));
  return current.map((word) => updates.get(word.id) ?? word);
}

export default function Home() {
  const [username, setUsername] = useState<string | null>(null);
  const [state, setState] = useState<UserState | null>(null);
  const [tab, setTab] = useState<Tab>("study");
  const [assessment, setAssessment] = useState<AssessmentView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState<string | null>("boot");
  const [error, setError] = useState<string | null>(null);
  const [studyWords, setStudyWords] = useState<WordRecordRow[]>([]);
  const [streamWords, setStreamWords] = useState<WordRecordRow[]>([]);
  const [llmThinking, setLlmThinking] = useState(false);
  const [autoNextPending, setAutoNextPending] = useState(false);
  const [autoNextWordIds, setAutoNextWordIds] = useState<string[]>([]);
  const [autoNextArmed, setAutoNextArmed] = useState(false);
  const [autoNextRemaining, setAutoNextRemaining] = useState(autoNextSeconds);
  const importInputRef = useRef<HTMLInputElement>(null);

  const currentQuestion = assessment?.questions[questionIndex] ?? null;
  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);
  const displayedStudyWords = studyWords;

  const loadState = useCallback(async (nextUsername: string) => {
    try {
      setBusy("state");
      setError(null);
      setStreamWords([]);
      setLlmThinking(false);
      setAutoNextPending(false);
      setAutoNextWordIds([]);
      setAutoNextArmed(false);
      const payload = await api<{ state: UserState }>("/api/users/state", {
        method: "POST",
        body: JSON.stringify({ username: nextUsername })
      });
      setState(payload.state);
      setStudyWords(payload.state.latestWords);
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
      setStreamWords([]);
      setLlmThinking(false);
      setAutoNextPending(false);
      setAutoNextWordIds([]);
      setAutoNextArmed(false);
      const payload = await api<{ username: string; accessToken: string; state: UserState }>("/api/users/random", {
        method: "POST"
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
      setStudyWords(payload.state.latestWords);
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
      setStreamWords([]);
      setLlmThinking(false);
      setAutoNextPending(false);
      setAutoNextWordIds([]);
      setAutoNextArmed(false);
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
      setStreamWords([]);
      setLlmThinking(false);
      setAutoNextPending(false);
      setAutoNextWordIds([]);
      setAutoNextArmed(false);
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
      setStudyWords(payload.state.latestWords);
      setAssessment(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交失败");
    } finally {
      setBusy(null);
    }
  }

  const generateRecommendations = useCallback(async (options?: { replaceCurrent?: boolean }) => {
    if (!username) {
      return;
    }

    const replaceCurrent = options?.replaceCurrent === true;

    try {
      setBusy("recommend");
      setError(null);
      setStreamWords([]);
      setLlmThinking(false);
      setAutoNextPending(false);
      setAutoNextWordIds([]);
      setAutoNextArmed(false);
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
        body: JSON.stringify({ username })
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

            if (event.event === "thinking") {
              setLlmThinking(true);
              continue;
            }

            if (event.event === "fallback") {
              setLlmThinking(false);
              setStreamWords([]);
              continue;
            }

            if (event.event === "word" && payload.word) {
              const word = payload.word;
              setStreamWords((current) => [
                ...current,
                toStreamingWordRecord(username, word, current.length)
              ]);
              continue;
            }

            if (event.event === "complete" && payload.state) {
              completedState = payload.state;
              const completedWords = payload.words ?? payload.state.latestWords;
              setState(payload.state);
              setStudyWords((current) =>
                replaceCurrent ? completedWords : appendUniqueWords(current, completedWords)
              );
              setStreamWords([]);
              setLlmThinking(false);
              setAutoNextRemaining(autoNextSeconds);
              setAutoNextPending(completedWords.length >= wordBatchSize);
              setAutoNextWordIds(completedWords.map((word) => word.id));
              setAutoNextArmed(false);
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
      setStreamWords([]);
      setLlmThinking(false);
      setError(recommendError instanceof Error ? recommendError.message : "推荐失败");
    } finally {
      setBusy(null);
    }
  }, [username]);

  const startAutoNextCountdown = useCallback(() => {
    setAutoNextPending(false);
    setAutoNextRemaining(autoNextSeconds);
    setAutoNextArmed(true);
  }, []);

  const stopAutoNextCountdown = useCallback(() => {
    setAutoNextPending(false);
    setAutoNextWordIds([]);
    setAutoNextArmed(false);
  }, []);

  useEffect(() => {
    if (
      !autoNextPending ||
      autoNextArmed ||
      busy !== null ||
      tab !== "study" ||
      autoNextWordIds.length === 0
    ) {
      return;
    }

    const wordsById = new Map(displayedStudyWords.map((word) => [word.id, word]));
    const allPendingWordsClicked = autoNextWordIds.every((wordId) => {
      const word = wordsById.get(wordId);
      return Boolean(word && word.status !== "new");
    });

    if (allPendingWordsClicked) {
      startAutoNextCountdown();
    }
  }, [
    autoNextArmed,
    autoNextPending,
    autoNextWordIds,
    busy,
    displayedStudyWords,
    startAutoNextCountdown,
    tab
  ]);

  useEffect(() => {
    if (
      !autoNextArmed ||
      busy !== null ||
      tab !== "study" ||
      displayedStudyWords.length < wordBatchSize
    ) {
      return;
    }

    if (autoNextRemaining <= 0) {
      setAutoNextArmed(false);
      void generateRecommendations({ replaceCurrent: true });
      return;
    }

    const timer = window.setTimeout(() => {
      setAutoNextRemaining((remaining) => remaining - 1);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [
    autoNextArmed,
    autoNextRemaining,
    busy,
    displayedStudyWords.length,
    generateRecommendations,
    tab
  ]);

  async function actOnWord(wordId: string, action: WordAction) {
    if (!username) {
      return;
    }

    try {
      setBusy(wordId);
      setError(null);
      const payload = await api<{ state: UserState }>("/api/words/action", {
        method: "POST",
        body: JSON.stringify({ username, wordId, action })
      });
      setState(payload.state);
      setStudyWords((current) => applyWordUpdates(current, payload.state));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "记录失败");
    } finally {
      setBusy(null);
    }
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
      setStreamWords([]);
      setLlmThinking(false);
      setAutoNextPending(false);
      setAutoNextWordIds([]);
      setAutoNextArmed(false);
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
      setStudyWords(payload.state.latestWords);
      setTab("study");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "导入失败");
    } finally {
      setBusy(null);
      event.target.value = "";
    }
  }

  async function resetUserData() {
    if (!username || !window.confirm("重置后会清空当前 user id 下的初测、推荐和学习记录。")) {
      return;
    }

    try {
      setBusy("reset");
      setError(null);
      setStudyWords([]);
      setStreamWords([]);
      setLlmThinking(false);
      setAutoNextPending(false);
      setAutoNextWordIds([]);
      setAutoNextArmed(false);
      const payload = await api<{ state: UserState }>("/api/users/reset", {
        method: "POST",
        body: JSON.stringify({ username })
      });
      setState(payload.state);
      setStudyWords(payload.state.latestWords);
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

  async function renameUser() {
    if (!username) {
      return;
    }

    const nextUsername = window
      .prompt("输入新的 user id：小写字母、数字或连字符，3-40 位。", username)
      ?.trim()
      .toLowerCase();

    if (!nextUsername || nextUsername === username) {
      return;
    }

    try {
      setBusy("rename");
      setError(null);
      setStreamWords([]);
      setLlmThinking(false);
      setAutoNextPending(false);
      setAutoNextWordIds([]);
      setAutoNextArmed(false);
      const payload = await api<{ username: string; state: UserState }>("/api/users/rename", {
        method: "POST",
        body: JSON.stringify({ username, newUsername: nextUsername })
      });
      window.localStorage.setItem(usernameKey, payload.username);
      setUsername(payload.username);
      setState(payload.state);
      setStudyWords(payload.state.latestWords);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "修改失败");
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

  return (
    <main className="mobile-shell flex flex-col">
      <header className="safe-pad sticky top-0 z-10 border-b border-black/5 bg-[#fbfcfc]/95 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase text-leaf">Words Explore</p>
            <h1 className="mt-1 text-2xl font-black text-ink">词汇探索</h1>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-ink text-white">
            <BookOpen size={22} aria-hidden />
          </div>
        </div>
        {username ? (
          <div className="mt-3 flex min-h-9 items-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-sm text-steel">
            <UserRound size={16} aria-hidden />
            <span className="truncate font-semibold">{username}</span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button
                className="button-base min-h-8 rounded-md border border-black/10 bg-mist px-2 text-xs text-ink"
                disabled={busy === "rename"}
                onClick={renameUser}
                title="修改 user id"
              >
                {busy === "rename" ? (
                  <Loader2 className="animate-spin" size={14} aria-hidden />
                ) : (
                  <PencilLine size={14} aria-hidden />
                )}
                修改
              </button>
              <button
                className="button-base min-h-8 rounded-md border border-coral/25 bg-coral/10 px-2 text-xs text-coral"
                disabled={busy === "reset"}
                onClick={resetUserData}
                title="重置数据"
              >
                {busy === "reset" ? (
                  <Loader2 className="animate-spin" size={14} aria-hidden />
                ) : (
                  <RotateCcw size={14} aria-hidden />
                )}
                重置
              </button>
            </div>
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="safe-pad mt-4">
          <div className="rounded-lg border border-coral/30 bg-coral/10 px-3 py-2 text-sm font-semibold text-coral">
            {error}
          </div>
        </div>
      ) : null}

      <section className="safe-pad flex-1 pb-24 pt-4">
        {busy === "boot" ? (
          <CenteredLoader label="载入中" />
        ) : !username || !state ? (
          <CreateUser busy={busy === "create"} onCreate={beginLearning} />
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
            streamWords={streamWords}
            llmThinking={llmThinking}
            autoNextArmed={autoNextArmed}
            autoNextRemaining={autoNextRemaining}
            onStopAutoNext={stopAutoNextCountdown}
            onStartAssessment={startAssessment}
            onPickAnswer={pickAnswer}
            onNextQuestion={nextQuestion}
            onGenerate={generateRecommendations}
            onAct={actOnWord}
          />
        ) : tab === "history" ? (
          <HistoryView words={state.history} busy={busy} onAct={actOnWord} />
        ) : (
          <SettingsView
            username={username}
            state={state}
            busy={busy}
            onExport={exportDatabase}
            onImport={() => importInputRef.current?.click()}
          />
        )}
      </section>

      {username ? (
        <nav className="safe-pad fixed bottom-0 left-1/2 z-20 grid w-full max-w-[480px] -translate-x-1/2 grid-cols-3 border-t border-black/5 bg-white/95 py-2 backdrop-blur">
          <TabButton active={tab === "study"} label="学习" icon={<Sparkles size={19} />} onClick={() => setTab("study")} />
          <TabButton active={tab === "history"} label="记录" icon={<History size={19} />} onClick={() => setTab("history")} />
          <TabButton active={tab === "settings"} label="设置" icon={<Settings size={19} />} onClick={() => setTab("settings")} />
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

function CreateUser({ busy, onCreate }: { busy: boolean; onCreate: () => void }) {
  return (
    <div className="flex min-h-[58dvh] flex-col justify-center">
      <div className="border-y border-black/10 py-8">
        <p className="text-sm font-bold text-steel">移动端英语词汇学习</p>
        <h2 className="mt-3 text-4xl font-black leading-tight text-ink">开始词汇初测</h2>
        <button
          className="button-base mt-8 w-full bg-leaf px-4 text-white"
          disabled={busy}
          onClick={onCreate}
        >
          {busy ? <Loader2 className="animate-spin" size={20} aria-hidden /> : <ArrowRight size={20} aria-hidden />}
          开始
        </button>
      </div>
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
  streamWords,
  llmThinking,
  autoNextArmed,
  autoNextRemaining,
  onStopAutoNext,
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
  streamWords: WordRecordRow[];
  llmThinking: boolean;
  autoNextArmed: boolean;
  autoNextRemaining: number;
  onStopAutoNext: () => void;
  onStartAssessment: () => void;
  onPickAnswer: (questionId: string, option: string) => void;
  onNextQuestion: () => void;
  onGenerate: () => void;
  onAct: (wordId: string, action: WordAction) => void;
}) {
  const isGenerating = busy === "recommend";
  const displayedWords = useMemo(
    () => (streamWords.length > 0 ? [...latestWords, ...streamWords] : latestWords),
    [latestWords, streamWords]
  );
  const showAutoNext = autoNextArmed && !isGenerating && displayedWords.length >= wordBatchSize;
  const [collapsedWordIds, setCollapsedWordIds] = useState<Set<string>>(() => new Set());
  const allWordCardsCollapsed =
    !isGenerating &&
    displayedWords.length >= wordBatchSize &&
    displayedWords.every((word) => collapsedWordIds.has(word.id));

  useEffect(() => {
    const visibleIds = new Set(displayedWords.map((word) => word.id));
    setCollapsedWordIds((current) => {
      const next = new Set([...current].filter((wordId) => visibleIds.has(wordId)));
      return next.size === current.size ? current : next;
    });
  }, [displayedWords]);

  function setWordCollapsed(wordId: string, collapsed: boolean) {
    setCollapsedWordIds((current) => {
      const next = new Set(current);
      if (collapsed) {
        next.add(wordId);
      } else {
        next.delete(wordId);
      }
      return next;
    });
  }

  if (!state.user.assessmentCompletedAt && !assessment) {
    return (
      <div className="rounded-lg border border-black/10 bg-white p-5 shadow-soft">
        <p className="text-sm font-bold text-amber">10 题初测</p>
        <h2 className="mt-2 text-2xl font-black text-ink">先定位词汇难度</h2>
        <button
          className="button-base mt-6 w-full bg-ink px-4 text-white"
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

    return (
      <div className="rounded-lg border border-black/10 bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-steel">
            {questionIndex + 1} / {assessment.questions.length}
          </span>
          <span className="rounded-md bg-amber/15 px-2 py-1 text-xs font-black text-amber">
            难度 {currentQuestion.difficulty}
          </span>
        </div>
        <h2 className="mt-5 text-4xl font-black text-ink">{currentQuestion.word}</h2>
        <div className="mt-6 grid gap-3">
          {[...currentQuestion.options, unknownAnswer].map((option) => (
            <button
              key={option}
              className={`min-h-12 rounded-lg border px-4 text-left text-base font-bold transition ${
                picked === option
                  ? "border-leaf bg-leaf/10 text-leaf"
                  : "border-black/10 bg-mist text-ink"
              }`}
              onClick={() => onPickAnswer(currentQuestion.id, option)}
            >
              {option}
            </button>
          ))}
        </div>
        <button
          className="button-base mt-6 w-full bg-leaf px-4 text-white"
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

  if (result && displayedWords.length === 0) {
    return (
      <ResultPanel
        result={result}
        busy={isGenerating}
        streamCount={streamWords.length}
        llmThinking={llmThinking}
        onGenerate={onGenerate}
      />
    );
  }

  if (displayedWords.length === 0) {
    return (
      <div className="rounded-lg border border-black/10 bg-white p-5 shadow-soft">
        <p className="text-sm font-bold text-leaf">等级 {state.user.estimatedLevel}</p>
        <h2 className="mt-2 text-2xl font-black text-ink">生成下一批单词</h2>
        {isGenerating ? <GenerationStatus thinking={llmThinking} count={streamWords.length} /> : null}
        <button
          className="button-base mt-6 w-full bg-leaf px-4 text-white"
          disabled={isGenerating}
          onClick={onGenerate}
        >
          {isGenerating ? (
            <Loader2 className="animate-spin" size={20} aria-hidden />
          ) : (
            <Sparkles size={20} aria-hidden />
          )}
          生成 {wordBatchSize} 个词
        </button>
      </div>
    );
  }

  return (
    <div className={allWordCardsCollapsed ? "space-y-2" : "space-y-4"}>
      {allWordCardsCollapsed ? null : (
        <div className="grid grid-cols-3 gap-3">
          <Metric label="已学会" value={state.stats.learned} tone="leaf" />
          <Metric label="太简单" value={state.stats.tooEasy} tone="amber" />
          <Metric label="继续学" value={state.stats.learning} tone="steel" />
        </div>
      )}
      <div className={`flex items-center justify-between gap-3 ${allWordCardsCollapsed ? "min-h-9" : ""}`}>
        <div>
          <p className={allWordCardsCollapsed ? "text-xs font-bold text-steel" : "text-sm font-bold text-steel"}>
            学习列表
          </p>
          <h2 className={allWordCardsCollapsed ? "text-xl font-black text-ink" : "text-2xl font-black text-ink"}>
            {isGenerating ? `已接收 ${streamWords.length}/${wordBatchSize}` : `${displayedWords.length} 个词`}
          </h2>
        </div>
        <button
          className="button-base bg-ink px-3 text-sm text-white"
          disabled={isGenerating}
          onClick={onGenerate}
        >
          {isGenerating ? (
            <Loader2 className="animate-spin" size={18} aria-hidden />
          ) : (
            <RotateCcw size={18} aria-hidden />
          )}
          获取下一批
        </button>
      </div>
      {isGenerating ? <GenerationStatus thinking={llmThinking} count={streamWords.length} /> : null}
      <div className={allWordCardsCollapsed ? "space-y-1.5" : "space-y-3"}>
        {displayedWords.map((word) => (
          <WordCard
            key={word.id}
            word={word}
            busy={busy === word.id}
            actionsDisabled={isGenerating}
            collapsed={collapsedWordIds.has(word.id)}
            compact={allWordCardsCollapsed}
            onCollapsedChange={(collapsed) => setWordCollapsed(word.id, collapsed)}
            onAct={onAct}
          />
        ))}
      </div>
      {showAutoNext ? (
        <AutoNextCountdown remaining={autoNextRemaining} onStop={onStopAutoNext} />
      ) : null}
    </div>
  );
}

function ResultPanel({
  result,
  busy,
  streamCount,
  llmThinking,
  onGenerate
}: {
  result: SubmitResult;
  busy: boolean;
  streamCount: number;
  llmThinking: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-5 shadow-soft">
      <p className="text-sm font-bold text-leaf">初测完成</p>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Metric label="得分" value={result.score} tone="leaf" />
        <Metric label="等级" value={result.estimatedLevel} tone="steel" />
        <Metric label="目标" value={result.targetDifficulty} tone="amber" />
      </div>
      {busy ? <GenerationStatus thinking={llmThinking} count={streamCount} /> : null}
      <button className="button-base mt-6 w-full bg-leaf px-4 text-white" disabled={busy} onClick={onGenerate}>
        {busy ? <Loader2 className="animate-spin" size={20} aria-hidden /> : <Sparkles size={20} aria-hidden />}
        生成 {wordBatchSize} 个词
      </button>
    </div>
  );
}

function GenerationStatus({ thinking, count }: { thinking: boolean; count: number }) {
  const label = thinking
    ? "LLM 正在思考，单词生成后会逐个出现"
    : count > 0
      ? `已接收 ${count}/${wordBatchSize} 个词`
      : "正在连接 LLM";

  return (
    <div className="mt-4 flex min-h-11 items-center gap-2 rounded-lg border border-amber/25 bg-amber/10 px-3 text-sm font-bold text-amber">
      <Loader2 className="shrink-0 animate-spin" size={16} aria-hidden />
      <span>{label}</span>
    </div>
  );
}

function AutoNextCountdown({
  remaining,
  onStop
}: {
  remaining: number;
  onStop: () => void;
}) {
  const seconds = Math.max(remaining, 1);
  const progress = `${Math.min(100, Math.max(0, ((autoNextSeconds - remaining) / autoNextSeconds) * 100))}%`;

  return (
    <div className="safe-pad fixed bottom-20 left-1/2 z-30 w-full max-w-[480px] -translate-x-1/2">
      <div className="rounded-lg border border-black/10 bg-white p-3 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-ink">{seconds} 秒后获取下一批单词</p>
            <p className="mt-1 text-xs font-semibold text-steel">新单词会继续追加在当前列表下方</p>
          </div>
          <button
            className="button-base min-h-9 shrink-0 border border-coral/25 bg-coral/10 px-3 text-sm text-coral"
            onClick={onStop}
          >
            <CircleStop size={16} aria-hidden />
            停止
          </button>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/5">
          <div className="h-full rounded-full bg-leaf transition-[width] duration-1000" style={{ width: progress }} />
        </div>
      </div>
    </div>
  );
}

function WordCard({
  word,
  busy,
  actionsDisabled = false,
  collapsed,
  compact,
  onCollapsedChange,
  onAct
}: {
  word: WordRecordRow;
  busy: boolean;
  actionsDisabled?: boolean;
  collapsed: boolean;
  compact: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onAct: (wordId: string, action: WordAction) => void;
}) {
  const disabled = busy || actionsDisabled;
  const actAndCollapse = (action: WordAction) => {
    onCollapsedChange(true);
    onAct(word.id, action);
  };

  return (
    <article
      className={`border border-black/10 bg-white transition-[padding,box-shadow] duration-200 ${
        collapsed ? "rounded-md px-2.5 py-2 shadow-none" : "rounded-lg p-4 shadow-soft"
      }`}
    >
      <button
        className={`flex w-full justify-between gap-2 text-left ${collapsed ? "items-center" : "items-start"}`}
        aria-expanded={!collapsed}
        onClick={() => onCollapsedChange(!collapsed)}
      >
        <div className="min-w-0">
          <h3 className={`${collapsed ? "truncate text-base" : "text-2xl"} font-black text-ink`}>{word.word}</h3>
          <p className={`${collapsed ? "mt-0 truncate text-[11px]" : "mt-1 text-sm"} font-bold text-steel`}>
            {word.partOfSpeech} · 难度 {word.difficulty}
          </p>
        </div>
        <div className={`flex shrink-0 items-center ${compact ? "gap-1" : "gap-2"}`}>
          <StatusBadge status={word.status} compact={collapsed} />
          <span
            className={`flex items-center justify-center rounded-md bg-black/5 text-steel ${
              collapsed ? "h-6 w-6" : "h-7 w-7"
            }`}
          >
            {collapsed ? <ChevronDown size={14} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
          </span>
        </div>
      </button>
      <div
        className={`grid transition-[grid-template-rows,opacity,transform] duration-300 ease-out ${
          collapsed ? "grid-rows-[0fr] -translate-y-2 opacity-0" : "grid-rows-[1fr] translate-y-0 opacity-100"
        }`}
      >
        <div className="overflow-hidden">
          <p className="mt-4 text-lg font-black text-leaf">{word.definitionZh}</p>
          <p className="mt-3 text-sm leading-6 text-ink">{word.exampleEn}</p>
          <p className="mt-2 text-sm leading-6 text-steel">{word.exampleZh}</p>
          <p className="mt-3 border-l-4 border-amber/60 pl-3 text-sm font-semibold leading-6 text-steel">
            {word.difficultyReason}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <ActionButton
              label="会了"
              icon={<CheckCircle2 size={18} aria-hidden />}
              disabled={disabled}
              active={word.status === "learned"}
              onClick={() => actAndCollapse("learned")}
            />
            <ActionButton
              label="简单"
              icon={<TrendingUp size={18} aria-hidden />}
              disabled={disabled}
              active={word.status === "too_easy"}
              onClick={() => actAndCollapse("too_easy")}
            />
            <ActionButton
              label="继续"
              icon={<RotateCcw size={18} aria-hidden />}
              disabled={disabled}
              active={word.status === "learning"}
              onClick={() => actAndCollapse("learning")}
            />
          </div>
        </div>
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
      <h2 className="text-2xl font-black text-ink">学习记录</h2>
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
        <span className="rounded-md bg-black/5 px-2 py-1 text-xs font-black text-steel">{words.length}</span>
      </div>
      {words.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/10 bg-white px-4 py-5 text-sm font-semibold text-steel">
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
    <div className="rounded-lg border border-black/10 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-black text-ink">{word.word}</p>
          <p className="mt-1 text-sm leading-6 text-steel">{word.definitionZh}</p>
        </div>
        <StatusBadge status={word.status} />
      </div>
      {actionLabel && onAction ? (
        <button
          className="button-base mt-3 w-full bg-leaf px-4 text-white"
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
  busy,
  onExport,
  onImport
}: {
  username: string;
  state: UserState;
  busy: string | null;
  onExport: () => void;
  onImport: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-black text-ink">设置</h2>
        <p className="mt-1 break-all text-sm font-semibold text-steel">{username}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric label="单词" value={state.stats.totalWords} tone="steel" />
        <Metric label="等级" value={state.user.estimatedLevel ?? "-"} tone="leaf" />
      </div>
      <button
        className="button-base w-full bg-ink px-4 text-white"
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
        className="button-base w-full border border-black/10 bg-white px-4 text-ink"
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
    </div>
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
      ? "text-leaf bg-leaf/10"
      : tone === "amber"
        ? "text-amber bg-amber/15"
        : "text-steel bg-steel/10";
  return (
    <div className={`min-h-20 rounded-lg px-3 py-3 ${toneClass}`}>
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
          ? "bg-steel/10 text-steel"
          : "bg-black/5 text-ink";

  return (
    <span
      className={`shrink-0 rounded-md font-black ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"} ${style}`}
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
  return (
    <button
      className={`button-base min-w-0 px-2 text-sm ${
        active ? "bg-leaf text-white" : "border border-black/10 bg-mist text-ink"
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
      className={`mx-1 flex min-h-12 flex-col items-center justify-center rounded-lg text-xs font-black ${
        active ? "bg-leaf/10 text-leaf" : "text-steel"
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
    <div className="rounded-lg border border-dashed border-black/15 bg-white p-8 text-center">
      <p className="font-black text-steel">{title}</p>
    </div>
  );
}
