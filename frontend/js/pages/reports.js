import { h, mount, fmtDate, fmtDateTime, statusBadge } from "../dom.js";
import { api, photoFileUrl } from "../api.js";

export async function renderReports(container, pid) {
  mount(container, h("div", { class: "loading" }, "Loading reports…"));
  const today = new Date().toISOString().slice(0, 10);
  const [summary, daily] = await Promise.all([api.summary(pid), api.daily(pid, today)]);
  draw(container, pid, summary, daily, today);
}

function draw(container, pid, summary, daily, selectedDate) {
  const dateInput = h("input", { type: "date", value: selectedDate });
  dateInput.addEventListener("change", async () => {
    const d = await api.daily(pid, dateInput.value);
    draw(container, pid, summary, d, dateInput.value);
  });

  const statusSummary = h("div", { class: "stat-row" },
    ...Object.entries(summary.stats).map(([key, n]) => h("div", { class: "stat-pill" },
      h("div", { class: "n" }, String(n)),
      h("div", { class: "l" }, key.replace("_", " "))
    ))
  );

  const diaryList = daily.diary.length
    ? daily.diary.map((e) => h("div", { class: "diary-entry" },
        h("span", { class: "dtype", style: "background:var(--blue)" }),
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

  mount(container,
    h("div", { class: "page-header" },
      h("div", {},
        h("h1", {}, "Reports"),
        h("div", { class: "sub" }, "Daily handover report, trade attendance and progress summary.")
      )
    ),
    h("div", { class: "card" }, h("h2", {}, "Project progress summary"), statusSummary),
    h("div", { class: "card" },
      h("div", { style: "display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;" },
        h("h2", {}, "Daily report"),
        dateInput
      ),
      h("h2", { style: "margin-top:14px;" }, "Diary"), h("div", {}, diaryList),
      h("h2", { style: "margin-top:14px;" }, "Attendance"), h("div", { class: "row-list" }, attList),
      daily.photos.length ? h("div", {}, h("h2", { style: "margin-top:14px;" }, "Photos"), photoGrid) : null
    ),
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
