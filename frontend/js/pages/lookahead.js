import { h, mount, fmtDate, statusBadge, daysUntil } from "../dom.js";
import { api } from "../api.js";
import { openActivityDrawer } from "../components/activityDrawer.js";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "2week", label: "2-Week" },
  { key: "6week", label: "6-Week" },
];

export async function renderLookahead(container, pid, range = "2week") {
  mount(container, h("div", { class: "loading" }, "Loading look-ahead…"));
  const data = await api.lookahead(pid, range);
  draw(container, pid, data, range);
}

function draw(container, pid, data, range) {
  const refresh = (r) => renderLookahead(container, pid, r);

  const tabs = h("div", { style: "display:flex;gap:6px;margin-bottom:16px;" },
    RANGES.map((r) => h("button", {
      class: "btn btn-sm " + (r.key === range ? "btn-primary" : "btn-secondary"),
      onclick: () => refresh(r.key),
    }, r.label))
  );

  const groups = {};
  data.activities.forEach((a) => {
    const key = a.forecast_start || "Unscheduled";
    (groups[key] = groups[key] || []).push(a);
  });
  const dateKeys = Object.keys(groups).sort();

  const body = dateKeys.length
    ? dateKeys.map((dk) => h("div", { class: "card" },
        h("h2", {}, fmtDate(dk), daysUntilLabel(dk)),
        h("div", { class: "row-list" }, groups[dk].map((a) => h("div", { class: "row-item", onclick: () => openActivityDrawer(pid, a.id, { onChange: () => refresh(range) }) },
          h("div", {},
            h("div", { class: "title" }, a.name),
            h("div", { class: "meta" }, (a.trade ? a.trade.name + " · " : "") + (a.zones && a.zones.length ? a.zones.map((z) => z.name).join(", ") : "No zone linked"))
          ),
          h("div", { class: "spacer" }),
          statusBadge(a.status, a.status_label)
        )))
      ))
    : [h("div", { class: "card" }, h("div", { class: "empty-state" }, "Nothing forecast in this window."))];

  mount(container,
    h("div", { class: "page-header" },
      h("div", {},
        h("h1", {}, "Look-Ahead"),
        h("div", { class: "sub" }, `${fmtDate(data.from)} – ${fmtDate(data.to)}`)
      )
    ),
    tabs,
    ...body
  );
}

function daysUntilLabel(dateStr) {
  const n = daysUntil(dateStr);
  if (n === null) return "";
  let txt;
  if (n === 0) txt = "Today";
  else if (n === 1) txt = "Tomorrow";
  else if (n > 0) txt = `In ${n} days`;
  else txt = `${Math.abs(n)} days overdue`;
  return h("span", { style: "font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px;color:var(--ink-soft);font-size:12px;" }, `· ${txt}`);
}
