import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders } from "./app/providers";
import "./styles/globals.css";

(window as unknown as { __HANGUP_REACT_SHELL__?: boolean }).__HANGUP_REACT_SHELL__ = true;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>
);
