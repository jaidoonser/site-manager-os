import { h, mount, fmtDateTime, toast } from "../dom.js";
import { api } from "../api.js";

const TYPE_COLOR = { progress: "#2f6fed", delay: "#d64545", decision: "#e2a336", attendance: "#1e8e5a", system: "#8b93a7", note: "#8b93a7" };
const TYPE_LABEL = { progress: "Progress", delay: "Delay", decision: "Decision", attendance: "Attendance", system: "System", note: "Note" };

export async function renderDiary(container, pid) {
  mount(container, h("div", { class: "loading" }, "Loading site diary…"));
  const entries = await api.diary(pid, 200);
  draw(container, pid, entries);
}

function draw(container, pid, entries) {
  const refresh = () => renderDiary(container, pid);

  const textInput = h("textarea", { rows: 2, placeholder: "Add a note to the site diary…" });
  const typeSelect = h("select", {}, Object.entries(TYPE_LABEL).map(([k, l]) => h("option", { value: k, selected: k === "note" }, l)));
  async function addEntry() {
    if (!textInput.value.trim()) return;
    try {
      await api.createDiaryEntry(pid, { text: textInput.value.trim(), entry_type: typeSelect.value });
      textInput.value = "";
      toast("Added to diary");
      refresh();
    } catch (e) { toast(e.message, true); }
  }

  const list = entries.length
    ? entries.map((e) => h("div", { class: "diary-entry" },
        h("span", { class: "dtype", style: `background:${TYPE_COLOR[e.entry_type] || "#8b93a7"}` }),
        h("div", {},
          h("div", { class: "txt" }, h("span", { class: "tag" }, TYPE_LABEL[e.entry_type] || e.entry_type), e.text),
          h("div", { class: "meta" }, `${e.author || "—"} · ${fmtDateTime(e.created_at)}`)
        )
      ))
    : [h("div", { class: "empty-state" }, "No diary entries yet.")];

  mount(container,
    h("div", { class: "page-header" },
      h("div", {},
        h("h1", {}, "Site Diary"),
        h("div", { class: "sub" }, "Automatic chronological record of progress, attendance, photos and delays — plus your own notes.")
      )
    ),
    h("div", { class: "card" },
      h("h2", {}, "Add entry"),
      h("div", { style: "display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;" },
        h("div", { style: "flex:1;min-width:220px;" }, textInput),
        typeSelect,
        h("button", { class: "btn btn-primary btn-sm", onclick: addEntry }, "Add")
      )
    ),
    h("div", { class: "card" }, list)
  );
}
