# Documentation instructions (OKF)

Applies to everything under `docs/`. This file is agent guidance, not a knowledge concept: the OKF bundle is `docs/features/`, and this file sits outside it.

All feature documentation MUST use **Open Knowledge Format (OKF) v0.2**: plain markdown with YAML frontmatter, organized as a knowledge bundle.

- Spec: https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
- Bundle root: `docs/features/`
- Reserved filenames (never use for concept documents): `index.md`, `log.md`

## Bundle layout

```
docs/
  AGENTS.md             # this file (outside the bundle)
  features/
    index.md            # bundle root index (carries okf_version: "0.2")
    log.md              # update history, newest first
    <kebab-case-slug>.md
    references/         # external material, run instructions (optional)
```

## Writing a feature doc

One feature per concept document at `docs/features/<kebab-case-slug>.md`:

- REQUIRED: a YAML frontmatter block with a non-empty `type`; use `type: Feature` for product features.
- Recommended keys: `title`, `description`, `tags`, `status`, `generated`, `verified`, `sources`, `stale_after`.
- Use structured markdown in the body (headings, lists, tables, fenced code blocks).

```markdown
---
type: Feature
title: Library View
description: One-line summary of the feature.
tags: [ui, library]
status: draft
generated: { by: opencode/<model-id>, at: 2026-10-04T12:00:00Z }
---

# Overview

What the feature does and why it exists.

# Examples

...
```

## Conventions

- Actor values: `<producer>/<version>` for agents (e.g. `opencode/<model-id>`), `human:<id>` for people, `process:<id>` for automated processes.
- Timestamps are ISO 8601 with an explicit UTC offset (e.g. `2026-10-04T12:00:00Z`). `status` is one of `draft`, `stable`, `deprecated` (absent means `stable`).
- Cross-link concepts with standard relative markdown links, so they work in a local editor and on GitHub: `[Other Feature](other-feature.md)` from a bundle-root document, `[Configuration](references/configuration.md)` into a subdirectory, `[Other Feature](../other-feature.md)` from `references/`. Never write bundle-absolute links (`(/slug.md)`): GitHub resolves them against `github.com`, not the bundle root.
- Keep `docs/features/index.md` in sync: one entry per feature, `* [Title](<slug>.md) - short description`.
- Append an entry to `docs/features/log.md` when adding, updating, or deprecating docs (`## YYYY-MM-DD`, newest first).
- Conformance: every non-reserved `.md` file under `docs/features/` must have parseable YAML frontmatter with a non-empty `type`.
