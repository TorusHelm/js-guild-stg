import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import "cally";
import "./styles.css";

type MattermostReaction = {
  emojiName: string;
  userId: string;
  createAt: number;
};

type MattermostPost = {
  id: string;
  createAt: number;
  userId: string;
  message: string;
  replyCount: number;
  rootId: string | null;
  isBot: boolean;
  permalink: string;
  reactions: MattermostReaction[];
};

type MattermostUser = {
  id: string;
  username: string;
  displayName: string;
  isBot?: boolean;
};

type MattermostReport = {
  generatedAt: string | null;
  source: {
    baseUrl: string;
    teamSlug: string;
    channelSlug: string;
    channelId: string;
  };
  settings: {
    lookbackDays: number;
    thresholdPercent: number;
    defaultPeriodDays: number;
    countMode: "unique_reactors" | "all_reactions";
    includeReplies: boolean;
    includeBots: boolean;
    countAuthorReactions: boolean;
  };
  channel: {
    id: string;
    name: string;
    displayName: string;
    memberCount: number;
  };
  warnings: string[];
  users: Record<string, MattermostUser>;
  posts: MattermostPost[];
};

type SummaryPost = {
  id: string;
  createAt: number;
  authorName: string;
  message: string;
  permalink: string;
  replies: number;
  reactionsCount: number;
  engagedUsersCount: number;
  thresholdPercent: number;
};

function startOfQuarter(date: Date) {
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(Date.UTC(date.getFullYear(), quarterStartMonth, 1));
}

function Header() {
  return (
    <header class="site-header">
      <a class="brand-link" href="./">
        JS Guild Hub
      </a>
      <nav class="header-nav">
        <a class="header-nav-link" href="./">
          Состав
        </a>
        <a class="header-nav-link active" href="./mattermost.html">
          Mattermost
        </a>
      </nav>
    </header>
  );
}

const reportUrl = "./data/mattermost-report.json";
const accessStorageKey = "js-guild-stg-access";
const sitePasswordHash = import.meta.env.VITE_SITE_PASSWORD_HASH ?? "";
const passwordSalt = "js-guild-stg-site-access-v1";
const passwordIterations = 120000;

async function derivePasswordHash(password: string) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(passwordSalt),
      iterations: passwordIterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  return Array.from(new Uint8Array(derivedBits))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function formatDateTime(value: number | string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(typeof value === "number" ? new Date(value) : new Date(value));
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function summarizeMessage(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  if (compact.length <= 160) {
    return compact || "(без текста)";
  }

  return `${compact.slice(0, 157)}...`;
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
}

function subtractDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() - days);
  return next;
}

function formatDateLabel(value: string) {
  if (!value) {
    return "Выбрать дату";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
  }).format(new Date(`${value}T00:00:00`));
}

function readCalendarValue(event: Event) {
  const target = event.currentTarget as HTMLElement & { value?: string };
  return target.value ?? "";
}

function MattermostApp() {
  const [report, setReport] = useState<MattermostReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [thresholdPercent, setThresholdPercent] = useState("20");
  const [countMode, setCountMode] = useState<"unique_reactors" | "all_reactions">(
    "unique_reactors",
  );
  const [includeReplies, setIncludeReplies] = useState(false);
  const [includeBots, setIncludeBots] = useState(false);
  const [countAuthorReactions, setCountAuthorReactions] = useState(false);

  useEffect(() => {
    const accessToken = window.localStorage.getItem(accessStorageKey);
    if (accessToken && accessToken === sitePasswordHash) {
      setIsUnlocked(true);
      return;
    }

    if (!sitePasswordHash) {
      setIsUnlocked(true);
    }
  }, []);

  useEffect(() => {
    if (!isUnlocked) {
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(reportUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`mattermost-report.json: ${response.status}`);
        }

        const nextReport = (await response.json()) as MattermostReport;
        setReport(nextReport);

        const generatedAt = nextReport.generatedAt ? new Date(nextReport.generatedAt) : new Date();
        const endDate = new Date(generatedAt);
        const startDate = startOfQuarter(generatedAt);

        setFromDate(toDateInputValue(startDate));
        setToDate(toDateInputValue(endDate));
        setThresholdPercent(String(nextReport.settings.thresholdPercent || 20));
        setCountMode(nextReport.settings.countMode || "unique_reactors");
        setIncludeReplies(nextReport.settings.includeReplies);
        setIncludeBots(nextReport.settings.includeBots);
        setCountAuthorReactions(nextReport.settings.countAuthorReactions);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Не удалось загрузить отчет");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [isUnlocked]);

  function applyPresetRange(preset: "quarter" | "month" | "30d" | "90d") {
    const anchor = report?.generatedAt ? new Date(report.generatedAt) : new Date();
    const endDate = new Date(anchor);
    let startDate = startOfQuarter(anchor);

    if (preset === "month") {
      startDate = startOfMonth(anchor);
    } else if (preset === "30d") {
      startDate = subtractDays(anchor, 30);
    } else if (preset === "90d") {
      startDate = subtractDays(anchor, 90);
    }

    setFromDate(toDateInputValue(startDate));
    setToDate(toDateInputValue(endDate));
  }

  async function handleUnlock(event: Event) {
    event.preventDefault();
    setPasswordBusy(true);
    setPasswordError(null);

    try {
      const hash = await derivePasswordHash(passwordInput);
      if (hash !== sitePasswordHash) {
        setPasswordError("Неверный пароль");
        return;
      }

      window.localStorage.setItem(accessStorageKey, hash);
      setIsUnlocked(true);
      setPasswordInput("");
    } finally {
      setPasswordBusy(false);
    }
  }

  const summary = useMemo(() => {
    if (!report || !fromDate || !toDate) {
      return { filteredPosts: [] as SummaryPost[], totalPosts: 0, matchedPosts: 0 };
    }

    const fromTs = new Date(`${fromDate}T00:00:00`).getTime();
    const toTs = new Date(`${toDate}T23:59:59.999`).getTime();
    const thresholdNumber = Number.parseFloat(thresholdPercent) || 20;
    const thresholdFraction = thresholdNumber / 100;

    const filteredPosts = report.posts
      .filter((post) => post.createAt >= fromTs && post.createAt <= toTs)
      .filter((post) => includeReplies || !post.rootId)
      .filter((post) => includeBots || !report.users[post.userId]?.isBot)
      .map((post) => {
        const filteredReactions = post.reactions.filter((reaction) => {
          if (!countAuthorReactions && reaction.userId === post.userId) {
            return false;
          }

          if (!includeBots && report.users[reaction.userId]?.isBot) {
            return false;
          }

          return true;
        });

        const uniqueReactorIds = new Set(filteredReactions.map((reaction) => reaction.userId));
        const engagedUsersCount = uniqueReactorIds.size;
        const reactionsCount = filteredReactions.length;
        const baseCount = countMode === "all_reactions" ? reactionsCount : engagedUsersCount;
        const thresholdPercent = report.channel.memberCount
          ? (baseCount / report.channel.memberCount) * 100
          : 0;

        return {
          id: post.id,
          createAt: post.createAt,
          authorName:
            report.users[post.userId]?.displayName ||
            report.users[post.userId]?.username ||
            post.userId,
          message: summarizeMessage(post.message),
          permalink: post.permalink,
          replies: post.replyCount,
          reactionsCount,
          engagedUsersCount,
          thresholdPercent,
          matched: report.channel.memberCount > 0 && baseCount / report.channel.memberCount >= thresholdFraction,
        };
      })
      .filter((post) => post.matched)
      .sort((left, right) => right.thresholdPercent - left.thresholdPercent);

    return {
      filteredPosts,
      totalPosts: report.posts
        .filter((post) => post.createAt >= fromTs && post.createAt <= toTs)
        .filter((post) => includeReplies || !post.rootId)
        .filter((post) => includeBots || !report.users[post.userId]?.isBot).length,
      matchedPosts: filteredPosts.length,
    };
  }, [
    countAuthorReactions,
    countMode,
    fromDate,
    includeBots,
    includeReplies,
    report,
    thresholdPercent,
    toDate,
  ]);

  if (!isUnlocked) {
    return (
      <main class="page-shell page-shell-centered">
        <section class="hero-card gate-card">
          <p class="eyebrow">JavaScript Guild</p>
          <h1>Вход на страницу</h1>
          <p class="hero-copy">
            Это мягкая защита от случайного доступа. Для просмотра страницы введи пароль.
          </p>

          <form class="gate-form" onSubmit={handleUnlock}>
            <label class="field-label" for="site-password">
              Пароль
            </label>
            <input
              id="site-password"
              class="text-input"
              type="password"
              value={passwordInput}
              onInput={(event) => {
                setPasswordInput((event.target as HTMLInputElement).value);
                setPasswordError(null);
              }}
              autoComplete="current-password"
            />
            {passwordError ? <p class="error-state">{passwordError}</p> : null}
            <button class="action-button" type="submit" disabled={!passwordInput || passwordBusy}>
              {passwordBusy ? "Проверка..." : "Войти"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main class="page-shell">
      <Header />

      <section class="hero-card">
        <p class="eyebrow">Mattermost Analytics</p>
        <h1>Реакции по каналу гильдии</h1>
        <p class="hero-copy">
          Данные подтягиваются через GitHub Actions из Mattermost API. Период ниже фильтруется уже
          в браузере по сохраненному окну данных.
        </p>

        <div class="stats-grid">
          <article class="stat-card">
            <span class="stat-label">Последнее обновление</span>
            <strong>{report ? formatDateTime(report.generatedAt) : "Загрузка..."}</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">Участников канала</span>
            <strong>{report ? report.channel.memberCount : "—"}</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">Порог</span>
            <strong>{thresholdPercent || "20"}%</strong>
          </article>
        </div>

        <div class="action-row">
          <a
            class="action-link"
            href="https://github.com/TorusHelm/js-guild-stg/actions/workflows/sync-mattermost-report.yml"
            target="_blank"
            rel="noreferrer"
          >
            Открыть Mattermost Sync
          </a>
        </div>
      </section>

      <section class="content-grid">
        <article class="panel">
          <div class="panel-header">
            <h2>Фильтр периода</h2>
          </div>

          {loading ? <p class="empty-state">Загрузка данных...</p> : null}
          {error ? <p class="error-state">{error}</p> : null}

          {!loading && !error && report ? (
            <>
              <div class="settings-surface">
                <div class="preset-row">
                  <button class="preset-chip" type="button" onClick={() => applyPresetRange("quarter")}>
                    Текущий квартал
                  </button>
                  <button class="preset-chip" type="button" onClick={() => applyPresetRange("month")}>
                    Текущий месяц
                  </button>
                  <button class="preset-chip" type="button" onClick={() => applyPresetRange("30d")}>
                    30 дней
                  </button>
                  <button class="preset-chip" type="button" onClick={() => applyPresetRange("90d")}>
                    90 дней
                  </button>
                </div>

                <form class="filter-grid">
                  <label class="field-card">
                    <span class="field-kicker">Период</span>
                    <span class="field-label">С даты</span>
                    <div class="calendar-picker">
                      <button
                        type="button"
                        class="calendar-trigger"
                        popovertarget="from-date-popover"
                        style={{ anchorName: "--from-date-trigger" }}
                      >
                        <span class="calendar-trigger-label">{formatDateLabel(fromDate)}</span>
                        <span class="calendar-trigger-icon" aria-hidden="true">
                          ▾
                        </span>
                      </button>
                      <div
                        popover="auto"
                        id="from-date-popover"
                        class="calendar-popover"
                        style={{ positionAnchor: "--from-date-trigger" }}
                      >
                        <calendar-date
                          class="cally-surface"
                          value={fromDate}
                          onChange={(event) => {
                            const nextValue = readCalendarValue(event);
                            if (nextValue) {
                              setFromDate(nextValue);
                            }
                          }}
                        >
                          <svg
                            aria-label="Previous"
                            class="calendar-nav-icon"
                            slot="previous"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                          >
                            <path fill="currentColor" d="M15.75 19.5 8.25 12l7.5-7.5" />
                          </svg>
                          <svg
                            aria-label="Next"
                            class="calendar-nav-icon"
                            slot="next"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                          >
                            <path fill="currentColor" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                          </svg>
                          <calendar-month />
                        </calendar-date>
                      </div>
                    </div>
                  </label>
                  <label class="field-card">
                    <span class="field-kicker">Период</span>
                    <span class="field-label">По дату</span>
                    <div class="calendar-picker">
                      <button
                        type="button"
                        class="calendar-trigger"
                        popovertarget="to-date-popover"
                        style={{ anchorName: "--to-date-trigger" }}
                      >
                        <span class="calendar-trigger-label">{formatDateLabel(toDate)}</span>
                        <span class="calendar-trigger-icon" aria-hidden="true">
                          ▾
                        </span>
                      </button>
                      <div
                        popover="auto"
                        id="to-date-popover"
                        class="calendar-popover"
                        style={{ positionAnchor: "--to-date-trigger" }}
                      >
                        <calendar-date
                          class="cally-surface"
                          value={toDate}
                          onChange={(event) => {
                            const nextValue = readCalendarValue(event);
                            if (nextValue) {
                              setToDate(nextValue);
                            }
                          }}
                        >
                          <svg
                            aria-label="Previous"
                            class="calendar-nav-icon"
                            slot="previous"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                          >
                            <path fill="currentColor" d="M15.75 19.5 8.25 12l7.5-7.5" />
                          </svg>
                          <svg
                            aria-label="Next"
                            class="calendar-nav-icon"
                            slot="next"
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                          >
                            <path fill="currentColor" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                          </svg>
                          <calendar-month />
                        </calendar-date>
                      </div>
                    </div>
                  </label>
                  <label class="field-card">
                    <span class="field-kicker">Порог популярности</span>
                    <span class="field-label">Минимальный процент</span>
                    <div class="number-input-wrap">
                      <input
                        class="text-input text-input-number"
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={thresholdPercent}
                        onInput={(event) => setThresholdPercent((event.target as HTMLInputElement).value)}
                      />
                      <span class="input-suffix">%</span>
                    </div>
                  </label>
                  <label class="field-card">
                    <span class="field-kicker">Метрика</span>
                    <span class="field-label">Режим подсчета</span>
                    <div class="select-shell">
                      <select
                        class="text-input select-input"
                        value={countMode}
                        onInput={(event) =>
                          setCountMode(
                            (event.target as HTMLSelectElement).value as
                              | "unique_reactors"
                              | "all_reactions",
                          )
                        }
                      >
                        <option value="unique_reactors">Уникальные реакторы</option>
                        <option value="all_reactions">Все реакции</option>
                      </select>
                      <span class="select-chevron" aria-hidden="true">
                        ▾
                      </span>
                    </div>
                  </label>
                </form>

                <div class="toggle-grid">
                  <label class="toggle-card">
                    <div class="toggle-copy">
                      <strong>Учитывать реплаи</strong>
                      <span>Добавлять ответы в тредах в общую выборку.</span>
                    </div>
                    <span class="switch">
                      <input
                        type="checkbox"
                        checked={includeReplies}
                        onInput={(event) => setIncludeReplies((event.target as HTMLInputElement).checked)}
                      />
                      <span class="switch-slider" />
                    </span>
                  </label>
                  <label class="toggle-card">
                    <div class="toggle-copy">
                      <strong>Учитывать ботов</strong>
                      <span>Считать посты и реакции, созданные ботами.</span>
                    </div>
                    <span class="switch">
                      <input
                        type="checkbox"
                        checked={includeBots}
                        onInput={(event) => setIncludeBots((event.target as HTMLInputElement).checked)}
                      />
                      <span class="switch-slider" />
                    </span>
                  </label>
                  <label class="toggle-card">
                    <div class="toggle-copy">
                      <strong>Реакции автора</strong>
                      <span>Не отбрасывать реакции автора на собственный пост.</span>
                    </div>
                    <span class="switch">
                      <input
                        type="checkbox"
                        checked={countAuthorReactions}
                        onInput={(event) =>
                          setCountAuthorReactions((event.target as HTMLInputElement).checked)
                        }
                      />
                      <span class="switch-slider" />
                    </span>
                  </label>
                </div>
              </div>

              <div class="stats-grid stats-grid-compact">
                <article class="stat-card">
                  <span class="stat-label">Постов в периоде</span>
                  <strong>{summary.totalPosts}</strong>
                </article>
                <article class="stat-card">
                  <span class="stat-label">Постов выше порога</span>
                  <strong>{summary.matchedPosts}</strong>
                </article>
                <article class="stat-card">
                  <span class="stat-label">Режим подсчета</span>
                  <strong>
                    {countMode === "unique_reactors" ? "Уникальные реакторы" : "Все реакции"}
                  </strong>
                </article>
              </div>
            </>
          ) : null}
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Параметры sync</h2>
          </div>

          <dl class="meta-list">
            <div>
              <dt>Команда / канал</dt>
              <dd>
                {report
                  ? `${report.source.teamSlug || "—"} / ${report.source.channelSlug || report.channel.name}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Окно загрузки из API</dt>
              <dd>{report ? `${report.settings.lookbackDays} дней` : "—"}</dd>
            </div>
          </dl>

          <h3>Предупреждения</h3>
          {report?.warnings.length ? (
            <ul class="warning-list">
              {report.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p class="empty-state">Предупреждений нет.</p>
          )}
        </article>
      </section>

      <section class="panel report-panel">
        <div class="panel-header">
          <h2>Посты выше порога</h2>
          <span>{summary.matchedPosts}</span>
        </div>

        {!loading && !error && !summary.filteredPosts.length ? (
          <p class="empty-state">За выбранный период постов выше порога не найдено.</p>
        ) : null}

        {summary.filteredPosts.length ? (
          <div class="post-list">
            {summary.filteredPosts.map((post) => (
              <article class="post-card" key={post.id}>
                <div class="post-card-header">
                  <strong>{post.authorName}</strong>
                  <span>{formatDateTime(post.createAt)}</span>
                </div>
                <p class="post-message">{post.message}</p>
                <div class="post-metrics">
                  <span>Уникальных реакторов: {post.engagedUsersCount}</span>
                  <span>Всего реакций: {post.reactionsCount}</span>
                  <span>Реплаев: {post.replies}</span>
                  <span>Доля канала: {formatPercent(post.thresholdPercent)}</span>
                </div>
                <a class="inline-link" href={post.permalink} target="_blank" rel="noreferrer">
                  Открыть пост
                </a>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

render(<MattermostApp />, document.getElementById("app")!);
