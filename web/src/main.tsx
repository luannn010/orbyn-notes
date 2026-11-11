import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/app.css";
import { applyInitialPreferences } from "./ui/primitives";
import { isDesktop } from "./desktop/window";
applyInitialPreferences();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/jetbrains-mono/400.css";
import { registerOfflineShell } from "./ui/offline";
if (!isDesktop()) registerOfflineShell();
