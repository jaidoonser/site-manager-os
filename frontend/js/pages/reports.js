import { h, mount, fmtDate, fmtDateTime, statusBadge } from "../dom.js";
import { api, photoFileUrl, dailyReportPdfUrl } from "../api.js";

function todayIso() { return new Date().toISOString().slice(0, 10); }

export async function renderReports(container, pid) {
  mount(container, h("div", { class: "loading" }, "Loading reports…"));
  const today = todayIso();
  const [summary, daily] = await Promise.all([api.summary(pid), api.daily(pid, today)]);
  draw(container, pid, summary, { view: "daily", daily, day: today });
}

function draw(container, pid, summary, state) {
  const viewTabs = h("div", { style: "display:flex;gap:6px;margin-bottom:16px;" },
    h("button", { class: "btn btn-sm " + (state.view === "daily" ? "btn-primary" : "btn-secondary"), onclick: () => switchView("daily") }, "Daily"),
    h("button", { class: "btn btn-sm " + (state.view === "weekly" ? "btn-primary" : "btn-secondary"), onclick: () => switchView("weekly") }, "Weekly")
  );

  async function switchView(view) {
    if (view === "daily") {
      const daily = await api.daily(pid, state.day || todayIso());
      draw(container, pid, summary, { view: "daily", daily, day: state.day || todayIso() });
    } else {
      const end = state.weeklyEnd || todayIso();
      const weekly = await api.weekly(pid, end);
      draw(container, pid, summary, { view: "weekly", weekly, weeklyEnd: end });
    }
  }

  const statusSummary = h("div", { class: "stat-row" },
    ...Object.entries(summary.stats).map(([key, n]) => h("div", { class: "stat-pill" },
      h("div", { class: "n" }, String(n)),
      h("div", { class: "l" }, key.replace("_", " "))
    ))
  );

  const body = state.view === "daily"
    ? drawDaily(container, pid, summary, state)
    : drawWeekly(container, pid, summary, state, switchView);

  mount(container,
    h("div", { class: "page-header" },
      h("div", {},
        h("h1", {}, "Reports"),
        h("div", { class: "sub" }, "Daily handover report, weekly summary, trade attendance and progress.")
      )
    ),
    viewTabs,
    h("div", { class: "card" }, h("h2", {}, "Project progress summary"), statusSummary),
    body,
    h("div", { class: "card" },
      h("h2", {}, "Blocked items requiring attention"),
      summary.blocked.length
        ? h("div", { class: "row-list" }, summary.blocked.map((a) => h("div", { class: "row-item", style: "cursor:default" },
            h("div", { class: "title" }, a.name), h("div", { class: "spacer" }), statusBadge(a.status, a.status_label)
          )))
        : h("div", { class: "empty-state" }, "Nothing blocked.")
    )
  );
}

function drawDaily(container, pid, summary, state) {
  const { daily, day } = state;
  const dd = daily.diary_day || {};

  const dateInput = h("input", { type: "date", value: day });
  dateInput.addEventListener("change", async () => {
    const d = await api.daily(pid, dateInput.value);
    draw(container, pid, summary, { view: "daily", daily: d, day: dateInput.value });
  });

  const downloadBtn = h("a", {
    class: "btn btn-secondary btn-sm", href: dailyReportPdfUrl(pid, day), target: "_blank", rel: "noopener",
  }, "Download PDF");

  const infoRow = (label, value) => h("div", { style: "margin-bottom:10px;" },
    h("div", { style: "font-size:11px;text-transform:uppercase;color:var(--ink-soft);font-weight:700;letter-spacing:.3px;" }, label),
    h("div", { style: "font-size:13.5px;white-space:pre-wrap;" }, value && value.trim() ? value : "—")
  );

  const weatherLine = [dd.weather_conditions, dd.weather_temp].filter(Boolean).join(" · ") || "—";

  const diaryList = daily.diary.length
    ? daily.diary.map((e) => h("div", { class: "diary-entry" },
        h("span", { class: "dtype", style: `background:${{progress:"#2f6fed",delay:"#d64545",decision:"#e2a336",attendance:"#1e8e5a",safety:"#a3232f"}[e.entry_type] || "#8b93a7"}` }),
        h("div", {}, h("div", { class: "txt" }, e.text), h("div", { class: "meta" }, `${e.author || "—"} · ${fmtDateTime(e.created_at)}`))
      ))
    : [h("div", { class: "empty-state" }, "No diary activity that day.")];

  const attList = daily.attendances.length
    ? daily.attendances.map((a) => h("div", { class: "row-item", style: "cursor:default" },
        h("div", { class: "title" }, a.trade_name),
        h("div", { class: "spacer" }),
        h("span", { class: "tag" }, a.status)
      ))
    : [h("div", { class: "empty-state" }, "No attendances recorded that day.")];

  const photoGrid = h("div", { class: "photo-grid" }, daily.photos.map((p) => h("img", { src: photoFileUrl(p.file_path), title: p.caption || "" })));

  return h("div", { class: "card" },
    h("div", { style: "display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;" },
      h("h2", {}, "Daily report"),
      h("div", { style: "display:flex;gap:8px;align-items:center;" }, dateInput, downloadBtn)
    ),
    h("div", { class: "two-col-form", style: "margin-top:14px;" },
      infoRow("Weather", weatherLine),
      infoRow("Personnel on site", dd.personnel_notes),
    ),
    h("div", { class: "two-col-form" },
      infoRow("Plant & equipment", dd.plant_equipment),
      infoRow("Deliveries", dd.deliveries),
    ),
    h("div", { class: "two-col-form" },
      infoRow("Visitors", dd.visitors),
      infoRow("Instructions / decisions", dd.instructions),
    ),
    infoRow("Safety observations / incidents", dd.safety_notes),
    daily.completed_activities && daily.completed_activities.length
      ? infoRow("Tasks completed today", daily.completed_activities.map((a) => a.name).join(", "))
      : null,
    h("h2", { style: "margin-top:14px;" }, "Diary"), h("div", {}, diaryList),
    h("h2", { style: "margin-top:14px;" }, "Attendance"), h("div", { class: "row-list" }, attList),
    daily.photos.length ? h("div", {}, h("h2", { style: "margin-top:14px;" }, "Photos"), photoGrid) : null
  );
}

function drawWeekly(container, pid, summary, state, switchView) {
  const { weekly, weeklyEnd } = state;
  const endInput = h("input", { type: "date", value: weeklyEnd });
  endInput.addEventListener("change", async () => {
    const w = await api.weekly(pid, endInput.value);
    draw(container, pid, summary, { view: "weekly", weekly: w, weeklyEnd: endInput.value });
  });

  const statRow = h("div", { class: "stat-row" },
    h("div", { class: "stat-pill" }, h("div", { class: "n" }, String(weekly.completed_activities.length)), h("div", { class: "l" }, "completed")),
    h("div", { class: "stat-pill" }, h("div", { class: "n" }, String(weekly.started_activities.length)), h("div", { class: "l" }, "started")),
    h("div", { class: "stat-pill" }, h("div", { class: "n" }, String(weekly.safety_entries.length)), h("div", { class: "l" }, "safety notes")),
    h("div", { class: "stat-pill" }, h("div", { class: "n" }, String(weekly.photos_count)), h("div", { class: "l" }, "photos logged")),
  );

  const attSummary = Object.entries(weekly.attendance_counts).length
    ? h("div", {}, Object.entries(weekly.attendance_counts).map(([status, n]) => h("span", { class: "tag" }, `${status.replace("_", " ")}: ${n}`)))
    : h("div", { class: "empty-state" }, "No attendance recorded this week.");

  const completedList = weekly.completed_activities.length
    ? h("div", { class: "row-list" }, weekly.completed_activities.map((a) => h("div", { class: "row-item", style: "cursor:default" },
        h("div", { class: "title" }, a.name), h("div", { class: "spacer" }), h("span", { class: "meta" }, a.actual_end)
      )))
    : h("div", { class: "empty-state" }, "Nothing completed this week.");

  const safetyList = weekly.safety_entries.length
    ? h("div", {}, weekly.safety_entries.map((s) => h("div", { class: "diary-entry" },
        h("span", { class: "dtype", style: "background:#a3232f" }),
        h("div", {}, h("div", { class: "txt" }, s.text), h("div", { class: "meta" }, `${s.author || "—"} · ${fmtDateTime(s.created_at)}`))
      )))
    : h("div", { class: "empty-state" }, "No safety observations logged this week.");

  return h("div", { class: "card" },
    h("div", { style: "display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;" },
      h("h2", {}, "Weekly summary"),
      h("div", { style: "display:flex;gap:6px;align-items:center;" }, h("span", { style: "font-size:11.5px;color:var(--ink-soft);" }, "Week ending"), endInput)
    ),
    h("div", { class: "sub", style: "margin:4px 0 12px;" }, `${fmtDate(weekly.from)} – ${fmtDate(weekly.to)}`),
    statRow,
    h("h2", { style: "margin-top:14px;" }, "Completed this week"), completedList,
    h("h2", { style: "margin-top:14px;" }, "Attendance"), attSummary,
    h("h2", { style: "margin-top:14px;" }, "Safety observations"), safetyList
  );
}
