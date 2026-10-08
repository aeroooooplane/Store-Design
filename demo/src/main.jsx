import React from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import App from "./app/App.jsx";
import { ProjectRecovery } from "./ProjectRecovery.jsx";
createRoot(document.getElementById("root")).render(
  <ProjectRecovery>{(project, token) => <App initialProject={project} initialToken={token} />}</ProjectRecovery>
);
