# JS Guild Sync

Небольшой сервис для JavaScript-гильдии:

- тянет состав участников из Outline
- публикует актуальный список в `GitHub Pages`
- дает быстрые кнопки для копирования ФИО и всех email
- запускается вручную через `GitHub Actions`

## Links

- Site: https://torushelm.github.io/js-guild-stg/
- Actions: https://github.com/TorusHelm/js-guild-stg/actions
- Mattermost report: https://torushelm.github.io/js-guild-stg/mattermost.html

## Что уже есть

- `Preact + TypeScript + Vite`
- workflow `Sync guild roster` для ручной синхронизации
- workflow `Sync Mattermost report` для ручной синхронизации Mattermost
- workflow `Deploy Pages` для публикации статической страницы
- sync-скрипт `scripts/sync-outline.mjs`
- sync-скрипт `scripts/sync-mattermost.mjs`

## Что нужно заполнить в GitHub Secrets

Создай в репозитории эти секреты:

- `OUTLINE_BASE_URL=https://outline.gospodaprogrammisty.ru`
- `OUTLINE_API_KEY=replace_me`
- `OUTLINE_DOCUMENT_URL=https://outline.gospodaprogrammisty.ru/doc/javascript-FxjTgSQD6R#h-sostav-uchastnikov`
- `OUTLINE_DOCUMENT_ID=FxjTgSQD6R`
- `SITE_ACCESS_PASSWORD=replace_me`
- `MATTERMOST_TOKEN=replace_me`

Создай в репозитории эти variables:

- `MATTERMOST_BASE_URL=https://mattermost.example.com`
- `MATTERMOST_TEAM_SLUG=replace_me`
- `MATTERMOST_CHANNEL_SLUG=replace_me`
- `MATTERMOST_CHANNEL_ID=`
- `MATTERMOST_LOOKBACK_DAYS=90`
- `MATTERMOST_THRESHOLD_PERCENT=20`
- `MATTERMOST_DEFAULT_PERIOD_DAYS=30`
- `MATTERMOST_COUNT_MODE=unique_reactors`
- `MATTERMOST_INCLUDE_REPLIES=false`
- `MATTERMOST_INCLUDE_BOTS=false`
- `MATTERMOST_COUNT_AUTHOR_REACTIONS=false`

Если позже дойдем до записи в Яндекс Календарь, добавим еще:

- `YANDEX_LOGIN=replace_me`
- `YANDEX_APP_PASSWORD=replace_me`
- `YANDEX_CALENDAR_ID=replace_me`

## Ожидаемый формат таблицы в Outline

Лучший вариант:

| № | ФИО | Email |
| --- | --- | --- |
| 1 | Иван Иванов | ivan@example.com |
| 2 | Петр Петров | petr@example.com |

Сейчас скрипт ориентируется на markdown-представление таблицы в тексте документа. Если Outline отдает контент в другом виде, парсер нужно будет чуть подправить под реальный payload.

## Как запускать локально

```bash
npm install
npm run dev
```

Для ручной синхронизации:

```bash
OUTLINE_BASE_URL=https://outline.gospodaprogrammisty.ru \
OUTLINE_API_KEY=replace_me \
OUTLINE_DOCUMENT_ID=FxjTgSQD6R \
npm run sync:outline
```

## Как работать через GitHub

1. Заполни `GitHub Secrets`.
2. Включи `GitHub Pages` для workflow deployment.
3. Запусти `Actions -> Sync guild roster -> Run workflow`.
4. После коммита автоматически обновится страница.

## Что это решает сейчас

- один источник правды по составу гильдии в Outline
- одна кнопка синхронизации в GitHub
- один клик для копирования всех email перед созданием события в Яндекс Календаре

## Ограничение по защите страницы

Пароль на `GitHub Pages` в этом проекте является только защитой от случайного доступа. Это статический сайт без backend, поэтому полноценной серверной авторизации здесь нет.
