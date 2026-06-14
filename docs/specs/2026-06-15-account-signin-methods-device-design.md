# Страница аккаунта — методы входа, наличие пароля, устройство — spec

- **Date:** 2026-06-15
- **Status:** approved (design, Anton)
- **Scope:** `/dashboard` на leaf.gundem.tech (Astro `dashboard.astro` + `src/scripts/dashboard.ts`) + один прод-RPC `has_password()` в проекте Supabase `jwxnhwyqjzjmjnmwpwyq`. macOS-приложение (`leaf`) — out of scope. Список активных сессий / revoke — out of scope (осознанно).

## 0. Проблема (зачем)

OAuth-юзер сделал «forgot password» → сменил пароль → вошёл по паролю, но карточка аккаунта по-прежнему показывает `Provider: google` и нудит «Set a password».

**Корень:** `dashboard.ts` берёт провайдера из `app_metadata.provider` — это **singular**-поле = *первый* способ входа, у OAuth-аккаунта навсегда `google`. Наличие пароля страница **не проверяет вообще**: блок «Set a password» показывается всем и переключается на «Change password» только при `provider === 'email'` (чего у OAuth-юзера не будет).

**Ключевой факт (подтверждён на проде, аккаунт Антона `ayeresell@gmail.com`):**
`providers = ["google","github"]`, `identities = ["google","github"]`, `has_email_identity: false`. То есть Supabase при `updateUser({ password })` для OAuth-аккаунта пишет хеш пароля **прямо в `auth.users`**, отдельную `email`-identity **не создаёт** (задокументированное поведение, не баг). Следствие: **факт наличия пароля с клиента не виден** ни в `providers`, ни в `identities`. Значит нужен серверный сигнал.

## 1. Decision

1. Методы входа показывать из `app_metadata.provider` (первый) + `app_metadata.providers` (текущие OAuth) — с клиента.
2. Факт наличия пароля брать из нового security-definer RPC **`has_password()`** (как существующий `delete_self_account()`), читающего `auth.users.encrypted_password IS NOT NULL` для `auth.uid()`.
3. Добавить строку **Device** — текущее устройство из `navigator.userAgentData` (fallback `userAgent`). Только текущее, без истории, без бэкенда сверх п.2.
4. Кнопку пароля переключать по `has_password()`: есть → «Change password»; нет → «Set a password». После успешной установки — оптимистично флипать на «Change» без перезагрузки.

Сценарий: пароль есть → сразу «Change»; зашёл через Google/GitHub без пароля → «Set»; поставил → мгновенно «Change». Работает для всех аккаунтов, включая старые.

## 2. RPC `has_password()` (нормативно)

Применяется к прод-проекту `jwxnhwyqjzjmjnmwpwyq`. Исходник миграций в клонах не хранится (как `delete_self_account`) — **этот блок и есть канон**.

```sql
create or replace function public.has_password()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select encrypted_password is not null
  from auth.users
  where id = auth.uid()
$$;

revoke all on function public.has_password() from public, anon;
grant execute on function public.has_password() to authenticated;
```

- Только своя строка (`id = auth.uid()`) → утечки нет, RLS не задействован (definer).
- Анонимный вызов: `auth.uid()` = NULL → строки нет → возвращает `NULL`. Клиент трактует `NULL`/`false`/ошибку как «пароля нет».
- На первой же загрузке функция **попутно** отвечает, сохранился ли ресет Антона: `true` = персистнулся (проблема была чисто косметической), `false` = ресет для OAuth-юзеров не сохраняет пароль (отдельный, более серьёзный баг — эскалировать).

## 3. UI (нормативно)

### 3.1 Разметка — `src/pages/dashboard.astro`

В `<dl class="kv">` добавить строку **Device** между «Member since» и «Plan»:

```html
<dt>Device</dt>         <dd data-field="device">-</dd>
```

Блок `data-set-password` остаётся; меняется только логика показа/копирайта (см. 3.2). Существующий дефолтный интро-текст «Want to sign in with email + password too? Set a password for your account.» остаётся как ветка «пароля нет».

### 3.2 Логика — `src/scripts/dashboard.ts`

Заменяет текущие строки 27, 31 и блок 37–48.

**(a) Методы входа.** Хелпер-лейблы: `google→Google`, `github→GitHub`, `gitlab→GitLab`, иначе — Capitalize первой буквы.

```
providers = app_metadata.providers ?? [provider]
oauth     = providers.filter(p => p !== 'email').map(label)
hasPwd    = (rpc has_password() === true) || providers.includes('email')
methods   = [...oauth, ...(hasPwd ? ['Password'] : [])]
first     = provider === 'email' ? 'Email' : label(provider)
field     = methods.length ? `${first} (${methods.join(' · ')})` : first
setField('provider', field)
```

Для Антона: `Google (Google · GitHub · Password)`. OAuth без пароля: `Google (Google · GitHub)`.

**(b) Наличие пароля.** Вызвать `await sb.rpc('has_password')`. `data === true` → `hasPwd = true`. Ошибку/`null` трактовать как `false` (не блокировать рендер). Реальный набор методов (3.2a) учитывает `hasPwd`.

**(c) Кнопка пароля.** Блок `data-set-password` раскрывать всегда (как сейчас). Дальше по `hasPwd`:
- `true` → кнопка-тоггл `textContent = 'Change password'`, интро `.set-password-head .muted` → «Change your account password.»
- `false` → кнопка «Set a password», дефолтный интро (оставить как в разметке).

Старую ветку `if (provider === 'email')` **удалить** — решение теперь по `hasPwd`, а не по singular-провайдеру.

**(d) Device.** Хелпер `describeDevice()` (чистый клиент):
- Если есть `navigator.userAgentData`: `os = platform`; `browser` = первый brand из `brands`, у которого brand не матчит `/Not.?A.?Brand/i` и не `Chromium`, в виде `"<brand без 'Google '> <version>"`.
- Fallback на `navigator.userAgent`: `os` ← `Mac OS X→macOS / Windows / Linux / iPhone|iPad→iOS / Android`; `browser` ← парс `Edg / Chrome / Firefox / Version…Safari` + мажорная версия.
- Результат: `[os, browser].filter(Boolean).join(' · ')` или `'Unknown device'`. Пример: `macOS · Chrome 142`.
- `setField('device', describeDevice())`.
- Примечание: UA даёт только `macOS`, не «MacBook» — показываем `macOS` (честно).

### 3.3 Реактивность — set-password форма (`dashboard.ts`, обработчик submit)

⚠️ **Структурно:** верхний async-IIFE (рендер) и нижний IIFE (set-password handler) — **разные замыкания**. `hasPwd` вынести в **общую модульную область** (`let hasPwd = false`), чтобы оба могли читать/менять. Текущее чтение `const prov = …[data-field="provider"]?.textContent` и сравнение `prov === 'email'` (стр. 125–128) **удалить** — после правки текст поля = `Google (… · Password)`, сравнение сломается. Решение о тексте — по `hasPwd`, не по тексту поля.

После успешного `sb.auth.updateUser({ password })` (там же, где сейчас выводится success):
- success-текст выбрать по `hasPwd` **до** мутации: был `false` → «Password set — you can now sign in with email + password too.»; был `true` → «Password changed.»;
- затем `hasPwd = true`;
- кнопка-тоггл `textContent = 'Change password'`, интро → «Change your account password.»;
- пересобрать строку методов (3.2a) с `hasPwd = true` → в поле появляется `· Password`.

## 4. Verification

- **RPC:** после применения — `select has_password();` как `authenticated` (через сессию Антона) возвращает `true`; ответ фиксирует, персистнулся ли ресет (см. 2). Из `anon` — не `true`.
- **Build:** `pnpm build` в leaf-web — чисто, `tsc` без новых ошибок.
- **Интерактив (`astro preview`):** на `/dashboard` под аккаунтом Антона —
  Provider = `Google (Google · GitHub · Password)`; Device = `macOS · Chrome <NNN>`;
  кнопка = «Change password» (раз `has_password()` = true). Открыть форму, сменить пароль → success + кнопка/поле без перезагрузки уже в состоянии «Change»/`· Password`.
- **Негатив (по возможности):** тест-OAuth-аккаунт без пароля → Provider без `· Password`, кнопка «Set a password»; после установки → флип на «Change».

## 5. Deploy / rollback

- **RPC:** применяется к проду через Management API (`api.supabase.com/v1/projects/jwxnhwyqjzjmjnmwpwyq/database/query`) с прод-токеном из волта. Токен закрыт классификатором → **шаг применения выполняет Антон через `!`** (SQL из §2 готовит Claude). Rollback: `drop function public.has_password();`. Идемпотентно (`create or replace`).
- **Front:** `scripts/deploy.sh` с Мака (build → backup на VPS → rsync → nginx reload → verify, ssh-алиас `leaf-vps`). Rollback: бэкап-tarball из `~/backups` на VPS. ⚠️ перед build — проверить чужие незакоммиченные `package.json`/lock (как в прошлой спеке).
- **Порядок:** сначала RPC в прод, потом фронт (фронт деградирует мягко, если RPC ещё нет: `has_password` вернёт ошибку → трактуется как `false` → «Set a password», без падения).

## 6. Local vs VPS responsibilities (§14)

- **Local (Mac):** весь код (`dashboard.astro`, `dashboard.ts`), коммит, `deploy.sh` (сам ходит по ssh на VPS — backup/rsync/reload). SQL §2 пишет Claude локально.
- **Прод-секрет-шаг:** применение SQL к проду — **Антон через `!`** (прод-токен Supabase закрыт классификатором).
- **VPS-сессия:** не нужна (nginx-конфиг не меняется, только статика через rsync).

## 7. Tasks

- **T1 — RPC:** финализировать SQL §2; Антон применяет к проду через `!`; проверить `has_password()` под сессией (зафиксировать, персистнулся ли ресет).
- **T2 — Front:** `dashboard.astro` (строка Device) + `dashboard.ts` (методы, `has_password`, кнопка, `describeDevice`, реактивность). Build + интерактивная верификация локально. Commit.
- **T3 — Deploy:** `deploy.sh` с Мака, прод-проверка на `/dashboard` (Provider/Device/кнопка + реактивный флип). Пересборка/релонч приложения не требуется (серверно-фронтовая правка).
```
