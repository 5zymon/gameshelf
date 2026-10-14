---
type: Feature
title: Theme (light/dark/system)
description: A per-user UI theme (light/dark/system) persisted server-side, carried to the web app in the NEXT_THEME cookie, applied class-based (Tailwind v4 `dark` variant) with a no-flash bootstrap script, and editable in the same Preferences view as the language.
tags: [web, api, settings, theme]
status: draft
generated: { by: opencode/deepseek-v4.1-flash, at: 2026-10-08T22:16:06Z }
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
- `@theme` declares the **Nocturne light** palette as the default `--color-*`
  tokens; an unlayered `.dark { … }` block on `<html>` overrides the same
  tokens with the **Nocturne dark** palette ("warm light, premium dark").
  Utilities compile to `var(--color-*)`, so every `bg-surface`/`text-ink`/
  `border-edge` (and opacity modifiers via `color-mix`) flips with the theme;
  `src/` contains **zero `dark:` variants**, and components carry no
  per-theme branches.
- Fonts: `--font-sans` (Manrope, body) and `--font-display` (Sora, headings
  and wordmark) are `@theme` tokens fed by the `next/font` CSS variables (see
  [Single-Origin Frontend & API with Strict CSP](/single-origin-frontend-api.md)).
- `color-scheme: light|dark` makes native `<select>` popups and scrollbars
  match the theme.

| Token                   | Light                | Dark                   |
| ----------------------- | -------------------- | ---------------------- |
| `--color-canvas`        | `#F5F3EE`            | `#0F1116`              |
| `--color-surface`       | `#FFFFFF`            | `#171B22`              |
| `--color-surface-2`     | `#FAF8F3`            | `#20252F`              |
| `--color-field`         | `#FAF8F3`            | `#12151B`              |
| `--color-edge`          | `#E5E1D7`            | `#2A313C`              |
| `--color-edge-soft`     | `#EDEAE1`            | `#232933`              |
| `--color-edge-strong`   | `#D5D0C3`            | `#39414E`              |
| `--color-ink`           | `#1C1A16`            | `#ECE8DE`              |
| `--color-muted`         | `#6B675D`            | `#8B93A2`              |
| `--color-faint`         | `#9A958A`            | `#5C6472`              |
| `--color-accent`        | `#B45309`            | `#F2B23E`              |
| `--color-accent-strong` | `#92400E`            | `#F7C155`              |
| `--color-accent-soft`   | `rgba(180,83,9,.10)` | `rgba(242,178,62,.14)` |
| `--color-accent-ink`    | `#FFFFFF`            | `#201607`              |
| `--color-accent-text`   | `#92400E`            | `#F2B23E`              |
| `--color-danger`        | `#B42318`            | `#F0705A`              |
| `--color-danger-ink`    | `#FFFFFF`            | `#201607`              |

`accent`/`accent-strong`/`danger` are fill tokens (buttons, light borders,
focus outlines); `accent-text` is the accent **as text on a surface** (links,
active nav, counts); and `accent-ink`/`danger-ink` are the text colours placed
**on** an accent/danger fill. Buttons therefore use `text-accent-ink` /
`text-danger-ink` instead of `text-ink`: one amber/red cannot be WCAG-AA both
as text on a light surface **and** as a button background with dark text, so
the fill and the on-fill text are separate tokens.

Contrast (computed, all listed pairs ≥ 4.5:1 — WCAG AA for normal text):

| Pair                                | Light  | Dark   |
| ----------------------------------- | ------ | ------ |
| ink / canvas (primary text on page) | 15.7:1 | 15.4:1 |
| ink / surface (text on surface)     | 17.4:1 | 14.1:1 |
| muted / canvas (secondary text)     | 5.1:1  | 6.1:1  |
| muted / surface                     | 5.6:1  | 5.6:1  |
| muted / field                       | 5.3:1  | 5.9:1  |
| accent-text / canvas (accent text)  | 6.4:1  | 10.1:1 |
| accent-text / surface               | 7.1:1  | 9.2:1  |
| danger / canvas (error text)        | 5.9:1  | 6.5:1  |
| danger / surface                    | 6.6:1  | 5.9:1  |
| accent-ink / accent (button)        | 5.0:1  | 9.5:1  |
| accent-ink / accent-strong (hover)  | 7.1:1  | 10.8:1 |
| danger-ink / danger (delete)        | 6.6:1  | 6.1:1  |

# Theme-varying literals

Values that are not `@theme` tokens; each is defined for light in `:root` and
overridden in `.dark`. These are the only places where the theme appears
outside the `--color-*` tokens:

- **Text selection** — `::selection` light `rgba(180,83,9,.18)` → dark
  `rgba(242,178,62,.28)`.
- **Glow** — `.nocturne-glow`'s radial gradient: light `rgba(180,83,9,.07)`
  → dark `rgba(242,178,62,.13)` (with softer inner stops), top-centre only.
- **Card shadows** — `--shadow-card` / `--shadow-card-hover`: warm-tinted in
  light, pure black in dark; consumed as `shadow-[var(--shadow-card)]` /
  `shadow-[var(--shadow-card-hover)]`.
- **Cover placeholder** — `--cover-bottom` (`#14100b` / `#0b0d11`) and
  `--cover-scrim` (`rgba(20,15,8,.5)` / `rgba(9,10,13,.55)`) inside
  `.cover-placeholder`.
- **Select chevron** — `.select-field`'s same-origin SVG asset
  (`/select-chevron.svg`, `/select-chevron-dark.svg` for dark), stroked
  `#6B675D` (light) / `#8B93A2` (dark), i.e. the muted colour per theme.
- **Nav hover** — the inactive main-nav links' `hover:bg-ink/5` (5% ink via
  `color-mix`, so it flips with the ink token).

The former structural exception — the auth card's
`ring-black/5 dark:ring-white/5` halo — is gone; no per-theme component
variants remain.

# Motion

Interactive controls use a 140 ms colour transition
(`transition-colors duration-[140ms] ease-[ease]`); the catalog card's
transform/shadow transition runs 160 ms
(`transition-[transform,box-shadow,border-color] duration-[160ms]`). The card
lift is gated behind `motion-safe:hover:-translate-y-1`, and every transition
carries `motion-reduce:transition-none`, so reduced-motion users get instant
state changes.

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
- Contrast is adequate in both themes (all listed token pairs ≥ 4.5:1);
  catalog, forms, and import views render correctly in both (all token-based).

# Related

- [Internationalization (EN default, PL)](/i18n.md) — the mirrored
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
- A dedicated reduced-motion theme; the redesign's motion is already gated
  (`motion-safe:` for the card lift, `motion-reduce:transition-none` on every
  transition).
