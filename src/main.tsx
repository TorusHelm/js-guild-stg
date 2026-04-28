import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import "./styles.css";

type GuildMember = {
  number: number | null;
  fullName: string;
  email: string;
};

type SyncStatus = {
  source: {
    outlineBaseUrl: string;
    documentUrl: string;
    tableHint: string;
  };
  syncedAt: string | null;
  memberCount: number;
  warnings: string[];
};

const membersUrl = "./data/members.json";
const statusUrl = "./data/status.json";
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

function formatDate(value: string | null) {
  if (!value) {
    return "Еще не запускалось";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function copyText(text: string) {
  return navigator.clipboard.writeText(text);
}

function App() {
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"emails" | "names" | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

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
        const [membersResponse, statusResponse] = await Promise.all([
          fetch(membersUrl, { cache: "no-store" }),
          fetch(statusUrl, { cache: "no-store" }),
        ]);

        if (!membersResponse.ok) {
          throw new Error(`members.json: ${membersResponse.status}`);
        }

        if (!statusResponse.ok) {
          throw new Error(`status.json: ${statusResponse.status}`);
        }

        const nextMembers = (await membersResponse.json()) as GuildMember[];
        const nextStatus = (await statusResponse.json()) as SyncStatus;

        setMembers(nextMembers);
        setStatus(nextStatus);
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : "Не удалось загрузить данные",
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [isUnlocked]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const emails = useMemo(
    () =>
      members
        .map((member) => member.email.trim())
        .filter((email) => email.length > 0)
        .join(", "),
    [members],
  );

  const names = useMemo(() => members.map((member) => member.fullName).join("\n"), [members]);

  const canCopyEmails = emails.length > 0;

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
        <p class="eyebrow">JavaScript Guild</p>
        <h1>Синхронизация состава из Outline</h1>
        <p class="hero-copy">
          Данные публикуются из GitHub Actions. Ручной запуск синхронизации делается через
          workflow <code>Sync guild roster</code>.
        </p>

        <div class="stats-grid">
          <article class="stat-card">
            <span class="stat-label">Последняя синхронизация</span>
            <strong>{status ? formatDate(status.syncedAt) : "Загрузка..."}</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">Участников</span>
            <strong>{status ? status.memberCount : "—"}</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">Источник</span>
            <strong>Outline</strong>
          </article>
        </div>

        <div class="action-row">
          <button
            class="action-button"
            type="button"
            onClick={() => {
              void copyText(names);
              setCopied("names");
            }}
            disabled={!members.length}
          >
            {copied === "names" ? "Список скопирован" : "Скопировать ФИО"}
          </button>
          <button
            class="action-button secondary"
            type="button"
            onClick={() => {
              void copyText(emails);
              setCopied("emails");
            }}
            disabled={!canCopyEmails}
          >
            {copied === "emails" ? "Email скопированы" : "Скопировать все email"}
          </button>
          <a
            class="action-link"
            href="https://github.com/TorusHelm/js-guild-stg/actions/workflows/sync-guild-roster.yml"
            target="_blank"
            rel="noreferrer"
          >
            Открыть Actions
          </a>
        </div>
      </section>

      <section class="content-grid">
        <article class="panel">
          <div class="panel-header">
            <h2>Состав участников</h2>
            <span>{members.length} записей</span>
          </div>

          {loading ? <p class="empty-state">Загрузка данных...</p> : null}
          {error ? <p class="error-state">{error}</p> : null}

          {!loading && !error ? (
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>ФИО</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={`${member.number ?? "x"}-${member.fullName}`}>
                      <td>{member.number ?? "—"}</td>
                      <td>{member.fullName}</td>
                      <td>{member.email || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>

        <article class="panel">
          <div class="panel-header">
            <h2>Статус и заметки</h2>
          </div>

          <dl class="meta-list">
            <div>
              <dt>Outline URL</dt>
              <dd>
                <a href={status?.source.documentUrl} target="_blank" rel="noreferrer">
                  {status?.source.documentUrl ?? "—"}
                </a>
              </dd>
            </div>
            <div>
              <dt>Подсказка по таблице</dt>
              <dd>{status?.source.tableHint ?? "—"}</dd>
            </div>
          </dl>

          <h3>Предупреждения</h3>
          {status?.warnings.length ? (
            <ul class="warning-list">
              {status.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p class="empty-state">Предупреждений нет.</p>
          )}

          <h3>Как использовать</h3>
          <ol class="steps-list">
            <li>Обнови таблицу участников в Outline.</li>
            <li>Запусти workflow `Sync guild roster` в GitHub Actions.</li>
            <li>Скопируй email со страницы и вставь их в приглашение нового события.</li>
          </ol>
        </article>
      </section>
    </main>
  );
}

render(<App />, document.getElementById("app")!);
