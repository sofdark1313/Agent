import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { StatusDashboardPage } from "./pages/StatusDashboardPage";
import "./index.css";
import "katex/dist/katex.min.css";
import "react-complex-tree/lib/style-modern.css";
import "streamdown/styles.css";
import "./styles.css";

document.documentElement.dataset.liveagentWebui = "gateway";

const dashboardPaths = new Set(["/dashboard", "/status-board", "/observatory"]);
const Root = dashboardPaths.has(window.location.pathname) ? StatusDashboardPage : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
