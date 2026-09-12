import { h, mount, fmtDate, fmtDateShort, toast, statusBadge, attendanceLabel } from "../dom.js";
import { api } from "../api.js";
import { openActivityDrawer } from "../components/activityDrawer.js";

export async function renderHome(container, pid) {
  mount(container, h("div", { class: "loading" }, "Loading today's picture…"));
  const [summary, suggestions] = await Promise.all([
    api.summary(pid),
    api.suggestions(pid, "pending"),
  ]);
  draw(container, pid, summary, suggestions);
}

function activityRow(pid, a, refresh) {
  return h("div", { class: "row-item", onclick: () => openActivityDrawer(pid, a.id, { onChange: refresh }) },
    h("div", {},
      h("div", { class: "title" }, a.name),
      h("div", { class: "meta" },
        (a.trade ? a.trade.name + " · " : "") +
        (a.zones && a.zones.length ? a.zones.map((z) => z.name).join(", ") + " · " : "") +
        "Forecast " + fmtDateShort(a.forecast_start)
      )
    ),
    h("div", { class: "spacer" }),
    statusBadge(a.status, a.status_label)
  );
}

function draw(container, pid, summary, suggestions) {
  const refresh = () => renderHome(container, pid);

  const stats = summary.stats;
  const statRow = h("div", { class: "stat-row" },
    stat("Active", stats.active, "var(--blue)"),
    stat("Ready", stats.ready, "#93691c"),
    stat("Not Ready", stats.not_ready, "var(--ink-soft)"),
    stat("Blocked", stats.blocked, "var(--red)"),
    stat("Complete", stats.complete, "var(--green)"),
  );

  const suggestionCards = suggestions.length
    ? suggestions.map((s) => suggestionCard(pid, s, refresh))
    : [h("div", { class: "empty-state" }, "No open AI prompts right now — nice and clear.")];

  const blockedList = summary.blocked.length
    ? summary.blocked.map((a) => activityRow(pid, a, refresh))
    : [h("div", { class: "empty-state" }, "Nothing blocked today.")];

  const activeList = summary.active.length
    ? summary.active.map((a) => activityRow(pid, a, refresh))
    : [h("div", { class: "empty-state" }, "Nothing active right now.")];

  const confirmList = summary.confirmations_due.length
    ? summary.confirmations_due.map((c) => h("div", { class: "row-item", style: "cursor:default" },
        h("div", {},
          h("div", { class: "title" }, c.trade_name),
          h("div", { class: "meta" }, fmtDate(c.date) + " · " + attendanceLabel(c.status))
        ),
        h("div", { class: "spacer" }),
        h("span", { class: "tag" }, "needs confirming")
      ))
    : [h("div", { class: "empty-state" }, "All upcoming visits are confirmed.")];

  mount(container,
    h("div", { class: "page-header" },
      h("div", {},
        h("h1", {}, "Today"),
        h("div", { class: "sub" }, fmtDate(summary.today) + " — what's happening, what's ready, and what needs organising next.")
      ),
      h("button", { class: "btn btn-secondary btn-sm", onclick: refresh }, "Refresh")
    ),
    statRow,
    h("div", { class: "grid-2" },
      h("div", {},
        h("div", { class: "card" },
          h("h2", {}, `AI look-ahead prompts`, suggestions.length ? h("span", { class: "count" }, suggestions.length) : null),
          ...suggestionCards
        ),
        h("div", { class: "card" },
          h("h2", {}, "Blocked", h("span", { class: "count" }, summary.blocked.length)),
          h("div", { class: "row-list" }, blockedList)
        ),
        h("div", { class: "card" },
          h("h2", {}, "Active right now", h("span", { class: "count" }, summary.active.length)),
          h("div", { class: "row-list" }, activeList)
        ),
      ),
      h("div", {},
        h("div", { class: "card" },
          h("h2", {}, "Confirmations due this week"),
          h("div", { class: "row-list" }, confirmList)
        ),
      )
    )
  );
}

function stat(label, n, color) {
  return h("div", { class: "stat-pill" },
    h("div", { class: "n", style: `color:${color}` }, String(n)),
    h("div", { class: "l" }, label)
  );
}

function suggestionCard(pid, s, refresh) {
  async function accept() {
    try { await api.acceptSuggestion(pid, s.id); toast("Applied"); refresh(); }
    catch (e) { toast(e.message, true); }
  }
  async function dismiss() {
    try { await api.dismissSuggestion(pid, s.id); toast("Dismissed"); refresh(); }
    catch (e) { toast(e.message, true); }
  }
  const canApply = s.type === "forecast_shift";
  return h("div", { class: "suggestion-item" },
    h("div", { class: "msg" }, s.message),
    h("div", { class: "actions" },
      canApply ? h("button", { class: "btn btn-primary btn-sm", onclick: accept }, "Accept suggested date") : null,
      h("button", { class: "btn btn-ghost btn-sm", onclick: dismiss }, "Dismiss")
    )
  );
}
