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

  // Group into top-level tasks + their subtasks (one level of nesting).
  const topLevel = activities.filter((a) => !a.parent_activity_id);
  const childrenByParent = {};
  activities.forEach((a) => {
    if (a.parent_activity_id) (childrenByParent[a.parent_activity_id] = childrenByParent[a.parent_activity_id] || []).push(a);
  });

  const expanded = new Set(topLevel.filter((a) => childrenByParent[a.id]).map((a) => a.id)); // expanded by default
  const tableWrap = h("div", {});

  function activityRow(a, { indent = false } = {}) {
    return h("tr", { class: indent ? "subtask-row" : "", onclick: () => openActivityDrawer(pid, a.id, { onChange: refresh }) },
      h("td", {},
        indent ? h("span", { style: "color:var(--ink-soft);margin-right:4px;" }, "↳") : null,
        a.name,
        !indent && childrenByParent[a.id]
          ? h("button", {
              class: "link-btn", style: "margin-left:8px;",
              onclick: (e) => { e.stopPropagation(); toggleExpand(a.id); },
            }, expanded.has(a.id) ? `▾ ${childrenByParent[a.id].length} subtask${childrenByParent[a.id].length > 1 ? "s" : ""}` : `▸ ${childrenByParent[a.id].length} subtask${childrenByParent[a.id].length > 1 ? "s" : ""}`)
          : null,
        !indent
          ? h("button", { class: "link-btn", style: "margin-left:8px;", onclick: (e) => { e.stopPropagation(); openNewActivityModal(pid, trades, refresh, a); } }, "+ Subtask")
          : null
      ),
      h("td", {}, a.trade ? a.trade.name : "—"),
      h("td", {}, fmtDateShort(a.planned_start) + " – " + fmtDateShort(a.planned_end)),
      h("td", {}, fmtDateShort(a.forecast_start) + " – " + fmtDateShort(a.forecast_end)),
      h("td", {}, a.predecessor_name || "—"),
      h("td", {}, h("div", { class: "progress-bar" }, h("div", { style: `width:${a.progress_percent}%` })), a.progress_percent + "%"),
      h("td", {}, statusBadge(a.status, a.status_label)),
      h("td", {}, a.zones && a.zones.length ? a.zones.map((z) => z.name).join(", ") : "—"),
    );
  }

  function toggleExpand(id) {
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    renderTable();
  }

  function renderTable() {
    const rows = [];
    topLevel.forEach((a) => {
      rows.push(activityRow(a));
      if (childrenByParent[a.id] && expanded.has(a.id)) {
        childrenByParent[a.id].forEach((child) => rows.push(activityRow(child, { indent: true })));
      }
    });

    const table = activities.length
      ? h("table", { class: "data-table" },
          h("thead", {}, h("tr", {},
            h("th", {}, "Task"), h("th", {}, "Trade"), h("th", {}, "Planned"), h("th", {}, "Forecast"),
            h("th", {}, "Predecessor"), h("th", {}, "Progress"), h("th", {}, "Status"), h("th", {}, "Work face(s)")
          )),
          h("tbody", {}, rows)
        )
      : h("div", { class: "empty-state" }, "No activities yet — import a programme or add one manually.");
    mount(tableWrap, table);
  }

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
    h("div", { class: "card" }, tableWrap),
    h("div", { class: "card", style: "font-size:12.3px;color:var(--ink-soft)" },
      h("strong", {}, "Import format: "),
      "a spreadsheet with columns like Task/Activity, Trade, Start, Finish (or Duration/Workdays), and Predecessor (an ID, task name, or row number all work). Title rows above the real header and extra tabs are fine — we find the right one automatically. Unknown trades are created automatically.",
      h("br"),
      h("strong", {}, "Subtasks: "),
      "use \"+ Subtask\" on a task, or the \"Subtask of\" field on \"+ New activity\", to break a task into smaller steps (e.g. \"Clean second floor\" under \"Frame walls — second floor\"). Subtasks show up everywhere a normal task does (Look-Ahead, Trades, Reports) and can have their own trade and dates."
    )
  );
  renderTable();
}

function openNewActivityModal(pid, trades, refresh, defaultParent) {
  const nameInput = h("input", { type: "text" });
  const tradeSelect = h("select", {}, h("option", { value: "" }, "— none —"), trades.map((t) => h("option", { value: t.id }, t.name)));
  const startInput = h("input", { type: "date" });
  const endInput = h("input", { type: "date" });
  const err = h("div", { class: "error-text" });

  const parentOptions = defaultParent ? [] : null; // populated below once we know the top-level list

  async function save() {
    if (!nameInput.value.trim()) { err.textContent = "Name is required"; return; }
    try {
      await api.createActivity(pid, {
        name: nameInput.value.trim(),
        trade_id: tradeSelect.value || null,
        planned_start: startInput.value || null,
        planned_end: endInput.value || null,
        parent_activity_id: parentSelect ? (parentSelect.value || null) : (defaultParent ? defaultParent.id : null),
      });
      toast(defaultParent ? "Subtask created" : "Activity created");
      bg.remove();
      refresh();
    } catch (e) { err.textContent = e.message; }
  }

  // "Subtask of" picker - only offered when not already launched from a
  // specific row's "+ Subtask" shortcut (which fixes the parent).
  let parentSelect = null;
  const parentField = (() => {
    if (defaultParent) {
      return h("div", { class: "field" }, h("label", {}, "Subtask of"), h("input", { type: "text", value: defaultParent.name, disabled: true }));
    }
    return null; // built asynchronously below once we have the top-level task list
  })();

  const bg = h("div", { class: "modal-center-bg", onclick: (e) => { if (e.target === bg) bg.remove(); } },
    h("div", { class: "modal-card" },
      h("div", { style: "font-weight:700;margin-bottom:12px;font-size:15px;" }, defaultParent ? `New subtask of "${defaultParent.name}"` : "New activity"),
      h("div", { class: "field" }, h("label", {}, "Name"), nameInput),
      h("div", { class: "field" }, h("label", {}, "Trade"), tradeSelect),
      h("div", { class: "two-col-form" },
        h("div", { class: "field" }, h("label", {}, "Planned start"), startInput),
        h("div", { class: "field" }, h("label", {}, "Planned end"), endInput),
      ),
      parentField,
      err,
      h("div", { class: "form-actions" },
        h("button", { class: "btn btn-secondary btn-sm", onclick: () => bg.remove() }, "Cancel"),
        h("button", { class: "btn btn-primary btn-sm", onclick: save }, "Create")
      )
    )
  );
  document.body.appendChild(bg);

  if (!defaultParent) {
    // Fetch the current top-level task list to offer as a "Subtask of" choice.
    api.activities(pid).then((all) => {
      const topLevel = all.filter((a) => !a.parent_activity_id);
      parentSelect = h("select", {}, h("option", { value: "" }, "— none (top-level task) —"), topLevel.map((a) => h("option", { value: a.id }, a.name)));
      const field = h("div", { class: "field" }, h("label", {}, "Subtask of"), parentSelect);
      bg.querySelector(".modal-card").insertBefore(field, err);
    });
  }

  setTimeout(() => nameInput.focus(), 30);
}
