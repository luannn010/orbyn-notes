# Orbyn Notes

Encrypted notes and pages that work offline and link to Orbyn Planner tasks.

**Status: being built. No public release is available.**

Orbyn Notes is the second Everyday app in the Orbyn family, beside [Orbyn Planner](https://github.com/orbyn-dev/orbyn-planner). It runs on the open [orbyn-engine](https://github.com/orbyn-dev/orbyn-engine), so notes are encrypted on your device before they sync, and one Orbyn account signs in to every app.

## What it will do

- Notes and pages, offline first, encrypted before upload.
- Links between notes and Orbyn Planner tasks and events.
- Study, Clips and Journal in the same app, with connected features planned.

These are product goals. The local beta below implements part of them; the
product plan and designs are internal.

## Web beta implementation

The local web beta is implemented under `web/`; it is not a published release.
The local implementation has a rich-text library, tags, pins, version history,
Trash/restore, Markdown transfer and encrypted Study, Journal and Clips data.
Study supports local reviews, CSV transfer and cards made from selected saved
note passages, with verified source jumps. Journal has its own passphrase,
entries, habits and readable export. Clips saves links and text you paste; page
fetching, browser capture and highlights remain unfinished. A local Windows shell
is built from the same UI; see [Windows instructions](docs/windows.md).

The local setup/search work adds optional Markdown setup and search across active
Notes, saved Clips (including archived items), and actual Study card directions.
Journal, Trash, review history and captured source quotes are excluded from search.
Large searches can pause for an explicit Continue; result pages keep exact totals.
These changes are still undergoing integration and native qualification.

Settings → Study edits the five existing local review preferences with explicit
Save and Cancel. Daily limits affect the next normal session; already queued
cards, repeat reviews and Study more can exceed them. Changing the study-day
start regroups totals without rescheduling cards. Reminders, Planner tasks,
card suggestions and agent setup remain planned.

Study reviews use two-dimensional card swaps, toast exits and delayed loading
feedback, with reduced-motion support. Grading waits for the answer entrance to
finish; presentation timers never record reviews or change scheduling.

New accounts use shared Orbyn invites. This beta does not sync, and clearing a
browser or WebView profile removes its local keys and content. Export each module
separately before removing data: Notes Markdown excludes Study, Journal and Clips.
Study CSV preserves rendered card text and tags; it does not restore scheduling,
card types or passage links. These exports are not a complete workspace backup.
Local implementation does not mean all design frames or release checks are done.

Use Node.js 24 and run these commands from `web/`:

```sh
npm ci
npm run check
npm test
npm run build
npm run dev
```

Set `VITE_ENGINE_URL` to a compatible local or staging engine before building to
enable account entry. Missing account configuration fails visibly; production
never opens a fixture library. An already-retained local library can reopen
offline. See [the architecture](docs/architecture.md) and
[staging preparation](docs/beta-staging.md) for the storage boundary, account
integration, invite operations and release checks.

## Principles

Private by design · Local first · One account · Agent ready.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Outside contributions need the contributor agreement described there (comment `/orbynAgree` once) before they can be merged.

## Security

Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes. Contact: hello@orbyn.dev.

## Licence

Source-available under the [PolyForm Strict License 1.0.0](LICENSE). Required Notice: Copyright (c) 2026 Anh Dang. The engine it builds on is open source under MIT or Apache-2.0.
