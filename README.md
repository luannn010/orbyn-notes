# Orbyn Notes

Encrypted notes and pages that work offline and link to Orbyn Planner tasks.

**Status: being built. Nothing has launched, and there is nothing to install yet.**

Orbyn Notes is the second Everyday app in the Orbyn family, beside [Orbyn Planner](https://github.com/orbyn-dev/orbyn-planner). It runs on the open [orbyn-engine](https://github.com/orbyn-dev/orbyn-engine), so notes are encrypted on your device before they sync, and one Orbyn account signs in to every app.

## What it will do

- Notes and pages, offline first, encrypted before upload.
- Links between notes and Orbyn Planner tasks and events.
- Study, Clip and Journal inside the same app (Planned).

These are plans, not features you can use today. The product plan and designs are internal.

## Web beta implementation

The local web beta is implemented under `web/`; it is not a published release.
Its scope is a single-browser encrypted library with a rich-text editor, local
search, tags, Trash/restore and Markdown import/export. New accounts use shared
Orbyn invites. Notes do not sync in this beta, and clearing browser data removes
their local keys and content. Export a readable Markdown backup first.

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
