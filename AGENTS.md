# Orbyn Notes: agent instructions

Orbyn Notes is being built; nothing has launched. Follow CONTRIBUTING.md, and these rules:

- **Designs:** the UI follows the private repository [orbyn-dev/orbyn-designs](https://github.com/orbyn-dev/orbyn-designs), the one source of truth: `artifacts/` holds the published designs, `artifacts.json` indexes them, and `briefs/` holds the design-match brief. Read it from a current clone (`git pull` first), never from a copy in a temp folder, and never edit `artifacts/` here. Match the designs exactly, in Light, Dark and Dim, including copy and motion; take every value from the design source. A UI change cites the artifact version and frame ids it builds, or links the design pull request there. Anything not designed or not in the plan goes to the Orbyn Product UI/UX Designer before it is built; never invent it. The repository is private, so a contributor without access gets the frames they need in their issue. Public files never link the private plan or the design artifact pages.
- **Claims:** never present a feature as available before it ships; mark it Planned.
- **Identity:** app and bundle IDs start with `com.kinqsradio.orbyn` (this app: `com.kinqsradio.orbyn.notes`). GitHub links use `orbyn-dev`. Contact is hello@orbyn.dev, and email is sent as Orbyn <hello@orbyn.dev>.
- **Licence:** PolyForm Strict 1.0.0 with "Required Notice: Copyright (c) 2026 Anh Dang". The engine is MIT OR Apache-2.0.
- **Commits:** no AI attribution trailers in commits, titles or branch names; record AI use in the pull request's AI usage section. Write merge messages by hand.
- **Security-sensitive changes** (keys, sync, sign-in, sharing) are reviewed at the lead tier on the exact head before merge.
- **Performance:** never slower than the measured baseline; animations at 60 fps; Largest Contentful Paint under 2.5 s; no layout shift.
