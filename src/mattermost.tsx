import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
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
  isBot: boolean;
  permalink: string;
  reactions: MattermostReaction[];
};

type MattermostUser = {
  id: string;
  username: string;
  displayName: string;
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
        const startDate = new Date(generatedAt);
        startDate.setDate(startDate.getDate() - nextReport.settings.defaultPeriodDays);

        setFromDate(toDateInputValue(startDate));
        setToDate(toDateInputValue(endDate));
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "Не удалось загрузить отчет");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [isUnlocked]);

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
    const thresholdFraction = report.settings.thresholdPercent / 100;

    const filteredPosts = report.posts
      .filter((post) => post.createAt >= fromTs && post.createAt <= toTs)
      .map((post) => {
        const filteredReactions = post.reactions.filter((reaction) => {
          if (!report.settings.countAuthorReactions && reaction.userId === post.userId) {
            return false;
          }

          return true;
        });

        const uniqueReactorIds = new Set(filteredReactions.map((reaction) => reaction.userId));
        const engagedUsersCount = uniqueReactorIds.size;
        const reactionsCount = filteredReactions.length;
        const baseCount =
          report.settings.countMode === "all_reactions" ? reactionsCount : engagedUsersCount;
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
      totalPosts: report.posts.filter((post) => post.createAt >= fromTs && post.createAt <= toTs).length,
      matchedPosts: filteredPosts.length,
    };
  }, [fromDate, report, toDate]);

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
            <strong>{report ? `${report.settings.thresholdPercent}%` : "—"}</strong>
          </article>
        </div>

        <div class="action-row">
          <a class="action-link" href="./">
            Состав гильдии
          </a>
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
              <form class="filter-grid">
                <label class="field-group">
                  <span class="field-label">С даты</span>
                  <input
                    class="text-input"
                    type="date"
                    value={fromDate}
                    min={report.generatedAt ? toDateInputValue(new Date(Date.parse(report.generatedAt) - report.settings.lookbackDays * 86400000)) : undefined}
                    max={toDate || undefined}
                    onInput={(event) => setFromDate((event.target as HTMLInputElement).value)}
                  />
                </label>
                <label class="field-group">
                  <span class="field-label">По дату</span>
                  <input
                    class="text-input"
                    type="date"
                    value={toDate}
                    min={fromDate || undefined}
                    max={report.generatedAt ? toDateInputValue(new Date(report.generatedAt)) : undefined}
                    onInput={(event) => setToDate((event.target as HTMLInputElement).value)}
                  />
                </label>
              </form>

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
                    {report.settings.countMode === "unique_reactors"
                      ? "Уникальные реакторы"
                      : "Все реакции"}
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
              <dt>Окно загрузки</dt>
              <dd>{report ? `${report.settings.lookbackDays} дней` : "—"}</dd>
            </div>
            <div>
              <dt>Учет реплаев</dt>
              <dd>{report?.settings.includeReplies ? "Да" : "Нет"}</dd>
            </div>
            <div>
              <dt>Учет ботов</dt>
              <dd>{report?.settings.includeBots ? "Да" : "Нет"}</dd>
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
