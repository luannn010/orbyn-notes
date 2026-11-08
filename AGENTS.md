# Orbyn Notes: agent instructions

Orbyn Notes is being built; nothing has launched. Follow CONTRIBUTING.md, and these rules:

- **Designs:** match the internal Orbyn designs exactly, in Light, Dark and Dim, including copy and motion. Take every value from the design source. Anything not designed or not in the plan goes to the Orbyn Product UI/UX Designer before it is built; never invent it. Public files never link the private plan or design artifacts.
- **Claims:** never present a feature as available before it ships; mark it Planned.
- **Identity:** app and bundle IDs start with `com.kinqsradio.orbyn` (this app: `com.kinqsradio.orbyn.notes`). GitHub links use `orbyn-dev`. Contact is hello@orbyn.dev, and email is sent as Orbyn <hello@orbyn.dev>.
- **Licence:** PolyForm Strict 1.0.0 with "Required Notice: Copyright (c) 2026 Anh Dang". The engine is MIT OR Apache-2.0.
- **Commits:** no AI attribution trailers in commits, titles or branch names; record AI use in the pull request's AI usage section. Write merge messages by hand.
- **Security-sensitive changes** (keys, sync, sign-in, sharing) are reviewed at the lead tier on the exact head before merge.
- **Performance:** never slower than the measured baseline; animations at 60 fps; Largest Contentful Paint under 2.5 s; no layout shift.
