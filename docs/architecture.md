# Architecture

Planned; nothing is built yet.

Orbyn Notes will follow Orbyn Planner's shape: one web UI (React, Vite and TypeScript) shipped as a web app and as Tauri 2 apps for desktop and phone, on the device core from [orbyn-engine](https://github.com/orbyn-dev/orbyn-engine). Notes are records in their own zones, encrypted on the device before upload and synced through the engine. Each device keeps the whole library and works offline.

Rules that change go in this file with the change.
