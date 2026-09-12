import { h, mount, fmtDateShort, toast, statusBadge } from "../dom.js";
import { api } from "../api.js";
import { openActivityDrawer } from "../components/activityDrawer.js";

export async function renderProgramme(container, pid) {
  mount(container, h("div", { class: "loading" }, "Loading programme…"));
  const [activities, trades] = await Promise.all([api.activities(pid), api.trades(pid)]);
  draw(container, pid, activities, trades);
}

function draw(container, pid, activities, trades) {
  const refresh = () => renderProgramme(container, pid);

  const fileInput = h("input", { type: "file", accept: ".xlsx,.xlsm,.csv", style: "display:none" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    toast("Importing programme…");
    try {
      const res = await api.importProgramme(pid, file);
      toast(`Imported ${res.imported} activities`);
      refresh();
    } catch (e) { toast(e.message, true); }
  });

  const rows = activities.length ? activities.map((a) => h("tr", { onclick: () => openActivityDrawer(pid, a.id, { onChange: refresh }) },
    h("td", {}, a.name),
    h("td", {}, a.trade ? a.trade.name : "—"),
    h("td", {}, fmtDateShort(a.planned_start) + " – " + fmtDateShort(a.planned_end)),
    h("td", {}, fmtDateShort(a.forecast_start) + " – " + fmtDateShort(a.forecast_end)),
    h("td", {}, a.predecessor_name || "—"),
    h("td", {}, h("div", { class: "progress-bar" }, h("div", { style: `width:${a.progress_percent}%` })), a.progress_percent + "%"),
    h("td", {}, statusBadge(a.status, a.status_label)),
    h("td", {}, a.zones && a.zones.length ? a.zones.map((z) => z.name).join(", ") : "—"),
  )) : null;

  const table = activities.length
    ? h("table", { class: "data-table" },
        h("thead", {}, h("tr", {},
          h("th", {}, "Task"), h("th", {}, "Trade"), h("th", {}, "Planned"), h("th", {}, "Forecast"),
          h("th", {}, "Predecessor"), h("th", {}, "Progress"), h("th", {}, "Status"), h("th", {}, "Work face(s)")
        )),
        h("tbody", {}, rows)
      )
    : h("div", { class: "empty-state" }, "No activities yet — import a programme or add one manually.");

  mount(container,
    h("div", { class: "page-header" },
      h("div", {},
        h("h1", {}, "Programme"),
        h("div", { class: "sub" }, "Planned baseline, live forecast, and how each task sequences off the last.")
      ),
      h("div", {},
        h("button", { class: "btn btn-secondary btn-sm", onclick: () => fileInput.click() }, "Import Excel / CSV"),
        fileInput,
        h("button", { class: "btn btn-primary btn-sm", style: "margin-left:8px", onclick: () => openNewActivityModal(pid, trades, refresh) }, "+ New activity")
      )
    ),
    h("div", { class: "card" }, table),
    h("div", { class: "card", style: "font-size:12.3px;color:var(--ink-soft)" },
      h("strong", {}, "Import format: "),
      "a spreadsheet with columns Task, Trade, Planned Start, Planned End (or Duration), and Predecessor (task name or row number). Unknown trades are created automatically."
    )
  );
}

function openNewActivityModal(pid, trades, refresh) {
  const nameInput = h("input", { type: "text" });
  const tradeSelect = h("select", {}, h("option", { value: "" }, "— none —"), trades.map((t) => h("option", { value: t.id }, t.name)));
  const startInput = h("input", { type: "date" });
  const endInput = h("input", { type: "date" });
  const err = h("div", { class: "error-text" });

  async function save() {
    if (!nameInput.value.trim()) { err.textContent = "Name is required"; return; }
    try {
      await api.createActivity(pid, {
        name: nameInput.value.trim(),
        trade_id: tradeSelect.value || null,
        planned_start: startInput.value || null,
        planned_end: endInput.value || null,
      });
      toast("Activity created");
      bg.remove();
      refresh();
    } catch (e) { err.textContent = e.message; }
  }

  const bg = h("div", { class: "modal-center-bg", onclick: (e) => { if (e.target === bg) bg.remove(); } },
    h("div", { class: "modal-card" },
      h("div", { style: "font-weight:700;margin-bottom:12px;font-size:15px;" }, "New activity"),
      h("div", { class: "field" }, h("label", {}, "Name"), nameInput),
      h("div", { class: "field" }, h("label", {}, "Trade"), tradeSelect),
      h("div", { class: "two-col-form" },
        h("div", { class: "field" }, h("label", {}, "Planned start"), startInput),
        h("div", { class: "field" }, h("label", {}, "Planned end"), endInput),
      ),
      err,
      h("div", { class: "form-actions" },
        h("button", { class: "btn btn-secondary btn-sm", onclick: () => bg.remove() }, "Cancel"),
        h("button", { class: "btn btn-primary btn-sm", onclick: save }, "Create")
      )
    )
  );
  document.body.appendChild(bg);
}
