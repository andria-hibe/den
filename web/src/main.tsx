import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { WorkDataProvider } from "./WorkData.tsx";
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkDataProvider>
      <App />
    </WorkDataProvider>
  </StrictMode>,
);
