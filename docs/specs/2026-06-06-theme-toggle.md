# Theme toggle — spec + plan

- **Date:** 2026-06-06
- **Status:** approved (design: 2-state, Anton)
- **Scope:** все страницы leaf.gundem.tech — Astro (BaseLayout + AuthLayout) **и** `/changelog*` (worker `leaf-contact/src/public.ts`, зеркало chrome). leaf-docs (mkdocs, отдельный домен) — out of scope. Admin-редактор changelog — out of scope (но `pageShell`-страницы worker'а — preview/410/404 — получают кнопку автоматически).

## 1. Decision

Кнопка-иконка sun/moon в nav (справа, перед Sign in / CTA). Два состояния:
клик переключает light↔dark. Стартовое состояние — системное
(`prefers-color-scheme`), явный выбор хранится в `localStorage['leaf-theme']`
(`'light' | 'dark'`; ключа нет = система). Origin один на оба рендера —
выбор автоматически шарится между главной и changelog.

## 2. Mechanics (нормативно)

### 2.1 Токены (leaf-web `src/styles/tokens.css` + зеркально `TOKENS_CSS` в worker)

- Текущий dark-блок `@media (prefers-color-scheme: dark) { :root { … } }` →
  селектор меняется на `:root:not([data-theme="light"])` (внутри той же media).
  Явный light побеждает системный dark; специфичность (0,2,0) > (0,1,0).
- Добавить ПОСЛЕ media-блока: `:root[data-theme="dark"] { <те же dark-токены>; color-scheme: dark; }`
  (дублирование dark-набора в соседнем блоке — осознанное, держать в синке).
- Добавить: `:root[data-theme="light"] { color-scheme: light; }`
- Иконки через токены (ноль лишних селекторов):
  в `:root` (light): `--theme-toggle-sun: none; --theme-toggle-moon: block;`
  в ОБОИХ dark-блоках: `--theme-toggle-sun: block; --theme-toggle-moon: none;`
- Без JS / без выбора всё работает как сейчас (media-дефолт).

### 2.2 Анти-FOUC скрипт — ПЕРВЫМ в `<head>` (оба layout'а + `pageShell` worker'а)

```html
<script>try{var t=localStorage.getItem('leaf-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>
```

### 2.3 Кнопка

Новый `src/components/LeafThemeToggle.astro` (с MIRRORED-маркером): `<button
class="theme-toggle" type="button" aria-label="Toggle color theme">` с двумя
инлайн-SVG (sun/moon, 16px, stroke=currentColor), видимость через
`display: var(--theme-toggle-sun|moon)`. Стиль — иконко-вариант btn-ghost:
28×28, radius-md, hover surface-raised. Клик: effective = `data-theme` либо
`matchMedia`; next = противоположная; setAttribute + localStorage.
Размещение: LeafNav после `.nav-links`, перед `.nav-cta` (виден и на мобиле);
если в AuthLayout свой header — туда же (исполнитель смотрит по месту и
репортит). Worker: тот же markup в `NAV_HTML` перед Sign in; toggle-JS
добавляется в `pageShell` перед `</body>`; стили в `BLOG_CSS`.

## 3. Verification

- leaf-web: `pnpm build` чистый; `astro preview` + playwright-core (cached
  chromium): клик переключает фон `<html>`, выбор переживает переход между
  страницами, нет FOUC (скрипт раньше CSS-ссылок), системный dark + явный
  light = light.
- worker: `wrangler dev --remote` + тот же интерактивный тест на /changelog;
  смарт-кавычки 0; tsc — только 5 известных ошибок waitlist-counter.
- Кросс-проверка: выбор, сделанный на главной, действует на /changelog (один
  localStorage).

## 4. Deploy / rollback

- ⚠️ Перед деплоем leaf-web разобраться с чужими незакоммиченными
  `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml` (сессия #2): build
  идёт из рабочей копии — посмотреть diff, согласовать или stash на время
  build.
- leaf-web: `scripts/deploy.sh` с Мака (build → backup на VPS → rsync →
  nginx reload → verify). Rollback: бэкап-tarball из /var/backups.
- worker: branch-check → `wrangler deploy --dry-run` → `wrangler deploy`.
  Rollback: redeploy предыдущего коммита.

## 5. Local vs VPS responsibilities (§14)

- **Local (Mac):** весь код в обоих репо, коммиты, оба деплоя запускаются с
  Мака (`deploy.sh` сам ходит по ssh на VPS: backup/rsync/reload).
- **VPS-сессия:** не нужна. Nginx-конфиг не меняется (только статика в
  /var/www/leaf через rsync).

## 6. Tasks

- **T1 leaf-web:** tokens.css реструктуризация + LeafThemeToggle.astro +
  head-скрипт в BaseLayout/AuthLayout + интеграция в LeafNav (+Auth header
  по месту). Build + интерактивная верификация. Commit.
- **T2 leaf-contact (зеркало):** TOKENS_CSS + head-скрипт в pageShell +
  кнопка в NAV_HTML + toggle-JS + стили в BLOG_CSS. Верификация. Commit.
- **T3:** spec+quality ревью обеих частей, разбор чужого diff в leaf-web,
  деплой обоих, прод-проверка (включая кросс-persistence).
