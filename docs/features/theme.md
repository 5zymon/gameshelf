---
type: Feature
title: Theme (light/dark/system)
description: A per-user UI theme (light/dark/system) persisted server-side, carried to the web app in the NEXT_THEME cookie, applied class-based (Tailwind v4 `dark` variant) with a no-flash bootstrap script, and editable in the same Preferences view as the language.
tags: [web, api, settings, theme]
status: draft
generated: { by: opencode/home-model, at: 2026-10-08T10:36:54Z }
---

# Overview

The GameShelf UI supports three themes — **light**, **dark**, and **system**
(ticket 7.3). The theme is a **per-user preference persisted server-side**
(`users.theme`), mirroring the per-user [language](/i18n.md) preference
end to end: it follows the account across sessions and devices, and an
unauthenticated visitor (login/setup screens) follows the OS preference.

- **Default**: `system` (DB column default; also the fallback for a
  missing/invalid cookie or a corrupt stored row).
- **`system` is a real option**: resolved client-side against
  `prefers-color-scheme` and tracked live while selected.
- **Rendering**: Tailwind v4 class-based dark mode — a `dark` class on
  `<html>` flips the `--color-*` tokens; components carry no per-theme
  variants.
- **No FOUC**: a `beforeInteractive` bootstrap script in the root layout sets
  the class before hydration/first paint.
- **UI**: a theme `<select>` in the same Preferences form as the language
  select on `/settings`.

# Theme set and persistence

`apps/api/src/settings/theme.ts` defines the closed set:

```ts
export const SUPPORTED_THEMES = ['light', 'dark', 'system'] as const;
export const DEFAULT_THEME: Theme = 'system';
```

- The `users.theme` column (`VarChar(8)`, default `system`) stores the
  preference; the migration backfills existing rows with `system`.
- `PUT /settings/preferences` validates the body with
  `@IsIn(SUPPORTED_THEMES)`, so a typo can never reach the database.
- Every read path coerces the stored value with `toTheme()` (an invalid or
  legacy row falls back to `system`), so a corrupt value can never reach the
  cookie or a response body.

# NEXT_THEME cookie

`apps/api/src/settings/theme-cookie.ts` is the bridge between the API (which
owns the per-user theme) and the web app (which reads the cookie in the root
layout to pick the theme for the first paint). Same contract as
`NEXT_LOCALE`:

| Event                                   | Cookie action                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `POST /auth/login`                      | set to the user's stored theme (heals a stale/missing cookie — login is the one reliable server-render hook) |
| `POST /setup` (first account)           | set to the new account's theme (`system`, the default)                                                       |
| `PUT /settings/preferences`             | re-set to the new theme                                                                                      |
| `POST /auth/logout`                     | cleared                                                                                                      |
| passive session expiry (`SessionGuard`) | cleared                                                                                                      |

Flags: `httpOnly` (only the web app's server components read it, via
`cookies()`; JavaScript never reads the cookie), `SameSite=Lax`, `path=/`,
`maxAge` one year (a durable preference, not a session signal), `secure` when
`SESSION_COOKIE_SECURE` is set.

Clearing on logout/expiry matters on shared devices: without it the login
screen would keep the previous user's theme; with the cookie gone the web app
falls back to the `system` default.

# First-paint theme (no FOUC)

`apps/web/src/app/layout.tsx` (a server component) reads the `NEXT_THEME`
cookie, validates it with `isTheme` (missing/invalid → `system`), and emits a
`next/script` with `strategy="beforeInteractive"` whose body sets the `dark`
class on `document.documentElement` before hydration:

- `dark` → class on; `light` → class off; `system` → resolved against
  `window.matchMedia('(prefers-color-scheme: dark)')`.
- The script body is a string (the value is inlined via `JSON.stringify` of
  the validated value — no injection); it is ES5 and runs before first paint.
- The strict CSP in `apps/web/src/middleware.ts` sets the nonce'd policy on
  the request headers; Next.js extracts that nonce and stamps it onto its
  inline scripts, so the bootstrap script passes CSP with no middleware
  change.
- The `dark` class is **never in the React tree** — the script and
  `ThemeProvider` own it on `document.documentElement` — so React hydration
  cannot strip it. `suppressHydrationWarning` on `<html>` silences the
  dev-only diff warning.

`apps/web/src/components/theme-provider.tsx` (client) keeps the class in sync
after first paint: it re-applies the stored preference on mount (and whenever
the server re-renders with a new one, e.g. after a preferences PUT +
`router.refresh()`) and, while the preference is `system`, listens to the
`prefers-color-scheme` `change` event so an OS switch flips the UI live. It
also exposes `useTheme()` — the Preferences form calls `setTheme` so a
change is visible immediately, before the PUT round-trip.

# Color tokens (Tailwind v4)

`apps/web/src/app/globals.css` uses the CSS-first Tailwind v4 setup (no
`tailwind.config.js`):

- `@custom-variant dark (&:where(.dark, .dark *));` switches the `dark:`
  variant to the class strategy.
- `@theme` declares the **light** palette as the default `--color-*` tokens;
  an unlayered `.dark { … }` block on `<html>` overrides the same tokens with
  the **dark** palette (the original GameShelf design, unchanged). Utilities
  compile to `var(--color-*)`, so every `bg-ink`/`text-fog`/`border-edge`
  (and opacity modifiers via `color-mix`) flips with the theme — no
  per-component `dark:` variants are needed.
- `color-scheme: light|dark` makes native `<select>` popups and scrollbars
  match the theme.

| Token                   | Light     | Dark      |
| ----------------------- | --------- | --------- |
| `--color-ink`           | `#f4f5f7` | `#0b0d10` |
| `--color-shelf`         | `#ffffff` | `#15181d` |
| `--color-edge`          | `#d9dde3` | `#262b33` |
| `--color-fog`           | `#1a1d23` | `#e7e9ee` |
| `--color-muted`         | `#5b6472` | `#9aa3b2` |
| `--color-accent`        | `#b45309` | `#f5a524` |
| `--color-accent-strong` | `#92400e` | `#ffc14d` |
| `--color-danger`        | `#b91c1c` | `#f87171` |
| `--color-on-accent`     | `#ffffff` | `#0b0d10` |
| `--color-on-danger`     | `#ffffff` | `#0b0d10` |

`on-accent`/`on-danger` exist because one amber/red cannot be WCAG-AA both as
text on a light surface **and** as a button background with dark text (the
dark palette's amber works for both; the light one cannot). Buttons therefore
use the explicit "on" tokens (`text-on-accent`, `text-on-danger`) instead of
`text-ink`.

Contrast (computed, all pairs ≥ 4.5:1 — WCAG AA for normal text):

| Pair                               | Light  | Dark  |
| ---------------------------------- | ------ | ----- |
| fog / ink (primary text on page)   | 15.5:1 | ~16:1 |
| fog / shelf (text on surface)      | 16.9:1 | ~15:1 |
| muted / ink (secondary text)       | 5.5:1  | 7.6:1 |
| muted / shelf                      | 6.0:1  | ~7:1  |
| accent / ink (as text)             | 4.6:1  | 9.5:1 |
| accent / shelf (as text)           | 5.0:1  | ~10:1 |
| accent-strong / ink (as text)      | 6.5:1  | ~11:1 |
| danger / ink (error text)          | 5.9:1  | 7.0:1 |
| danger / shelf                     | 6.5:1  | ~8:1  |
| on-accent / accent (button)        | 5.0:1  | 9.5:1 |
| on-accent / accent-strong (hover)  | 7.1:1  | ~10:1 |
| on-danger / danger (delete button) | 6.5:1  | 7.0:1 |

The one structural (non-token) difference between themes is the auth card's
elevation halo: `ring-black/5 dark:ring-white/5`.

# Preferences API and switcher

- `GET /settings/preferences` → `{ language, theme }`.
- `PUT /settings/preferences` with `{ language, theme }` (both required — the
  global validation pipe is `whitelist` + `forbidNonWhitelisted`, so the body
  is total) → persists `users.language` + `users.theme` and **re-writes both
  the `NEXT_LOCALE` and `NEXT_THEME` cookies** on the response.
- The web switcher is `components/preferences-form.tsx` on `/settings` — the
  same form as the language select: a `light`/`dark`/`system` select
  preselected from the server-fetched preference, a Save button (disabled
  while saving or when unchanged), `setTheme` for an immediate visual switch,
  `router.refresh()` after a successful PUT, a `role="status"` saved note,
  and a `401` → `/login` redirect. The catalogs gained `preferences.theme`
  and `preferences.themeName.{light,dark,system}` (PL/EN, parity-tested).

# Acceptance

- The app follows the system preference by default (no stored preference →
  `system`) and can be overridden to `light` or `dark`.
- Light, dark, and system are all selectable on `/settings` and correctly
  applied; `system` tracks the OS live (DevTools "Emulate CSS
  prefers-color-scheme" toggles the UI without a reload).
- The preference persists per user across sessions **and devices**: it is the
  account's stored value, healed into `NEXT_THEME` on every login.
- Language and theme live in the same preferences view.
- No flash of the wrong theme on first paint (bootstrap script sets the class
  before hydration).
- Contrast is adequate in both themes (all token pairs ≥ 4.5:1); catalog,
  forms, and import views render correctly in both (all token-based).

# Related

- [Internationalization (PL default, EN)](/i18n.md) — the mirrored
  per-user-language feature; same Preferences view, same cookie pattern.
- [Auth API](/auth-api.md) — login/logout set/clear the theme cookie, and the
  user model carries `theme`.
- [First-run Setup](/first-run-setup.md) — setup sets the theme cookie for
  the first account.
- [LLM Settings UI](/llm-settings-ui.md) — the `/settings` screen that hosts
  the Preferences section.
- [Single-Origin Frontend & API with Strict CSP](/single-origin-frontend-api.md)
  — the nonce'd CSP the bootstrap script passes.

# Out of scope

- Per-page or per-component theme overrides.
- Theme-aware cover image treatment (covers are photographic and identical in
  both themes — only the frame/placeholder tokens flip).
- Reduced-motion theming (existing `motion-reduce` classes untouched).
