import { api } from "./api.js";
import { h, mount, clear } from "./dom.js";
import { state, currentProject } from "./state.js";
import { route, startRouter, navigate, currentHash } from "./router.js";

import { renderAuth } from "./pages/auth.js";
import { renderProjectPicker } from "./pages/projects.js";
import { renderHome } from "./pages/home.js";
import { renderPlans } from "./pages/plans.js";
import { renderProgramme } from "./pages/programme.js";
import { renderLookahead } from "./pages/lookahead.js";
import { renderTrades } from "./pages/trades.js";
import { renderTradeDetail } from "./pages/tradeDetail.js";
import { renderDiary } from "./pages/diary.js";
import { renderReports } from "./pages/reports.js";

const appRoot = document.getElementById("app");

const TABS = [
  { key: "home", label: "Home", path: (id) => `/p/${id}/home` },
  { key: "plans", label: "Plans", path: (id) => `/p/${id}/plans` },
  { key: "programme", label: "Programme", path: (id) => `/p/${id}/programme` },
  { key: "lookahead", label: "Look-Ahead", path: (id) => `/p/${id}/lookahead` },
  { key: "trades", label: "Trades", path: (id) => `/p/${id}/trades` },
  { key: "diary", label: "Site Diary", path: (id) => `/p/${id}/diary` },
  { key: "reports", label: "Reports", path: (id) => `/p/${id}/reports` },
];

function shell(activeKey, projectId) {
  clear(appRoot);
  const proj = currentProject();
  const topbar = h("div", { class: "topbar" },
    h("div", { class: "wordmark" }, "SITE MANAGER ", h("span", {}, "OS")),
    proj ? h("div", { class: "project-name" }, "· " + proj.name) : null,
    h("div", { class: "spacer" }),
    proj ? h("a", { href: "#/projects", class: "user-chip", style: "text-decoration:none" }, "Switch project") : null,
    h("div", { class: "user-chip", onclick: doLogout }, (state.user ? state.user.name : "") + " · Log out")
  );
  const tabs = h("div", { class: "tabs" }, TABS.map((t) =>
    h("a", { href: `#${t.path(projectId)}`, class: t.key === activeKey ? "active" : "" }, t.label)
  ));
  const content = h("div", { class: "page" });
  appRoot.appendChild(topbar);
  appRoot.appendChild(tabs);
  appRoot.appendChild(content);
  return content;
}

async function doLogout() {
  await api.logout();
  state.user = null;
  navigate("/login");
}

function renderFullPage(node) {
  clear(appRoot);
  appRoot.appendChild(node);
}

async function ensureAuth() {
  if (state.user) return true;
  try {
    state.user = await api.me();
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureProjects() {
  state.projects = await api.projects();
}

async function guardedProjectRoute(projectId, renderFn) {
  const ok = await ensureAuth();
  if (!ok) { navigate("/login"); return; }
  if (!state.projects.length) await ensureProjects();
  state.currentProjectId = Number(projectId);
  if (!currentProject()) {
    try {
      const p = await api.project(projectId);
      state.projects.push(p);
    } catch (e) {
      navigate("/projects");
      return;
    }
  }
  await renderFn();
}

// ---------- routes ----------
route("/login", () => renderFullPage(renderAuth({ mode: "login", onSuccess: onAuthSuccess })));
route("/register", () => renderFullPage(renderAuth({ mode: "register", onSuccess: onAuthSuccess })));

route("/projects", async () => {
  const ok = await ensureAuth();
  if (!ok) { navigate("/login"); return; }
  await ensureProjects();
  clear(appRoot);
  const topbar = h("div", { class: "topbar" },
    h("div", { class: "wordmark" }, "SITE MANAGER ", h("span", {}, "OS")),
    h("div", { class: "spacer" }),
    h("div", { class: "user-chip", onclick: doLogout }, (state.user ? state.user.name : "") + " · Log out")
  );
  appRoot.appendChild(topbar);
  const content = h("div", { class: "page" });
  appRoot.appendChild(content);
  renderProjectPicker(content, {
    onOpen: (id) => navigate(`/p/${id}/home`),
  });
});

route("/p/:id/home", (p) => guardedProjectRoute(p.id, async () => renderHome(shell("home", p.id), p.id)));
route("/p/:id/plans", (p) => guardedProjectRoute(p.id, async () => renderPlans(shell("plans", p.id), p.id, { zoneId: p.query.zone, activityId: p.query.activity })));
route("/p/:id/plans/:sheetId", (p) => guardedProjectRoute(p.id, async () => renderPlans(shell("plans", p.id), p.id, { sheetId: p.sheetId, zoneId: p.query.zone, activityId: p.query.activity })));
route("/p/:id/programme", (p) => guardedProjectRoute(p.id, async () => renderProgramme(shell("programme", p.id), p.id)));
route("/p/:id/lookahead", (p) => guardedProjectRoute(p.id, async () => renderLookahead(shell("lookahead", p.id), p.id)));
route("/p/:id/trades", (p) => guardedProjectRoute(p.id, async () => renderTrades(shell("trades", p.id), p.id)));
route("/p/:id/trades/:tradeId", (p) => guardedProjectRoute(p.id, async () => renderTradeDetail(shell("trades", p.id), p.id, p.tradeId)));
route("/p/:id/diary", (p) => guardedProjectRoute(p.id, async () => renderDiary(shell("diary", p.id), p.id)));
route("/p/:id/reports", (p) => guardedProjectRoute(p.id, async () => renderReports(shell("reports", p.id), p.id)));

route("/", async () => {
  const ok = await ensureAuth();
  if (!ok) { navigate("/login"); return; }
  await ensureProjects();
  if (state.projects.length) navigate(`/p/${state.projects[0].id}/home`);
  else navigate("/projects");
});

function onAuthSuccess(user) {
  state.user = user;
  navigate("/");
}

startRouter();
