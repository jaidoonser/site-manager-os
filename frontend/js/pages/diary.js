import { h, mount, fmtDateTime, toast } from "../dom.js";
import { api } from "../api.js";

const TYPE_COLOR = { progress: "#2f6fed", delay: "#d64545", decision: "#e2a336", attendance: "#1e8e5a", safety: "#a3232f", system: "#8b93a7", note: "#8b93a7" };
const TYPE_LABEL = { progress: "Progress", delay: "Delay", decision: "Decision", attendance: "Attendance", safety: "Safety", system: "System", note: "Note" };

function todayIso() { return new Date().toISOString().slice(0, 10); }

export async function renderDiary(container, pid) {
  mount(container, h("div", { class: "loading" }, "Loading site diary…"));
  const day = todayIso();
  const [entries, diaryDay] = await Promise.all([api.diary(pid, 200), api.diaryDay(pid, day)]);
  draw(container, pid, entries, diaryDay, day);
}

function draw(container, pid, entries, diaryDay, selectedDay) {
  const refresh = () => renderDiary(container, pid);
  let activeType = null; // null = all
  let dateFrom = "";
  let dateTo = "";

  // ---------- Today's structured site diary record ----------
  const dayPicker = h("input", { type: "date", value: selectedDay });
  dayPicker.addEventListener("change", async () => {
    const dd = await api.diaryDay(pid, dayPicker.value);
    draw(container, pid, entries, dd, dayPicker.value);
  });

  const dayState = {
    weather_conditions: diaryDay.weather_conditions || "",
    weather_temp: diaryDay.weather_temp || "",
    personnel_notes: diaryDay.personnel_notes || "",
    plant_equipment: diaryDay.plant_equipment || "",
    deliveries: diaryDay.deliveries || "",
    visitors: diaryDay.visitors || "",
    instructions: diaryDay.instructions || "",
    safety_notes: diaryDay.safety_notes || "",
    general_notes: diaryDay.general_notes || "",
  };

  const field = (label, key, { textarea = false, placeholder = "" } = {}) => {
    const input = textarea
      ? h("textarea", { rows: 2, placeholder, oninput: (e) => { dayState[key] = e.target.value; } }, dayState[key])
      : h("input", { type: "text", placeholder, value: dayState[key], oninput: (e) => { dayState[key] = e.target.value; } });
    return h("div", { class: "field" }, h("label", {}, label), input);
  };

  async function saveDay() {
    try {
      const updated = await api.updateDiaryDay(pid, dayPicker.value, dayState);
      toast("Site diary saved for " + dayPicker.value);
      // Refresh the whole page if a safety note was logged (so it shows in the feed below)
      const freshEntries = await api.diary(pid, 200);
      draw(container, pid, freshEntries, updated, dayPicker.value);
    } catch (e) { toast(e.message, true); }
  }

  const dayCard = h("div", { class: "card" },
    h("div", { style: "display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:4px;" },
      h("h2", {}, "Today's site diary"),
      dayPicker
    ),
    h("div", { class: "sub", style: "margin-bottom:12px;" }, "The structured daily record — weather, who and what was on site, deliveries, visitors, instructions and safety. Fill in what's relevant; it's saved per day."),
    h("div", { class: "two-col-form" },
      field("Weather conditions", "weather_conditions", { placeholder: "e.g. Fine, light wind" }),
      field("Temperature", "weather_temp", { placeholder: "e.g. 18°C" }),
    ),
    field("Personnel on site", "personnel_notes", { textarea: true, placeholder: "e.g. ABC Plumbing (2), City Painters (3), site manager" }),
    field("Plant & equipment on site", "plant_equipment", { textarea: true, placeholder: "e.g. Scaffold, scissor lift, site shed" }),
    h("div", { class: "two-col-form" },
      field("Deliveries", "deliveries", { textarea: true, placeholder: "e.g. Timber pack delivered 10am" }),
      field("Visitors", "visitors", { textarea: true, placeholder: "e.g. Engineer site visit 2pm" }),
    ),
    field("Instructions / decisions", "instructions", { textarea: true, placeholder: "Verbal instructions, decisions made on site, etc." }),
    field("Safety observations / incidents", "safety_notes", { textarea: true, placeholder: "Near misses, hazards, toolbox talks, incidents — logged to the diary feed below too" }),
    field("General notes", "general_notes", { textarea: true }),
    h("button", { class: "btn btn-primary btn-sm", onclick: saveDay }, "Save site diary")
  );

  // ---------- Quick add to the chronological feed ----------
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

  // ---------- Filterable chronological feed ----------
  const feedWrap = h("div", {});
  function renderFeed() {
    const filtered = entries.filter((e) => {
      if (activeType && e.entry_type !== activeType) return false;
      const d = (e.created_at || "").slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
    mount(feedWrap, filtered.length
      ? filtered.map((e) => h("div", { class: "diary-entry" },
          h("span", { class: "dtype", style: `background:${TYPE_COLOR[e.entry_type] || "#8b93a7"}` }),
          h("div", {},
            h("div", { class: "txt" }, h("span", { class: "tag" }, TYPE_LABEL[e.entry_type] || e.entry_type), e.text),
            h("div", { class: "meta" }, `${e.author || "—"} · ${fmtDateTime(e.created_at)}`)
          )
        ))
      : [h("div", { class: "empty-state" }, "No diary entries match this filter.")]);
  }

  const typeChips = h("div", { class: "filter-tabs" },
    h("button", { class: "chip active", "data-type": "" }, "All"),
    Object.entries(TYPE_LABEL).map(([k, l]) => h("button", { class: "chip", "data-type": k }, l))
  );
  typeChips.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeType = btn.dataset.type || null;
      typeChips.querySelectorAll(".chip").forEach((b) => b.classList.toggle("active", b === btn));
      renderFeed();
    });
  });

  const fromInput = h("input", { type: "date" });
  const toInput = h("input", { type: "date" });
  fromInput.addEventListener("change", () => { dateFrom = fromInput.value; renderFeed(); });
  toInput.addEventListener("change", () => { dateTo = toInput.value; renderFeed(); });
  const clearRangeBtn = h("button", { class: "link-btn", onclick: () => { dateFrom = ""; dateTo = ""; fromInput.value = ""; toInput.value = ""; renderFeed(); } }, "Clear dates");

  mount(container,
    h("div", { class: "page-header" },
      h("div", {},
        h("h1", {}, "Site Diary"),
        h("div", { class: "sub" }, "Automatic chronological record of progress, attendance, photos and delays — plus your own notes and the daily structured record.")
      )
    ),
    dayCard,
    h("div", { class: "card" },
      h("h2", {}, "Add a note"),
      h("div", { style: "display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;" },
        h("div", { style: "flex:1;min-width:220px;" }, textInput),
        typeSelect,
        h("button", { class: "btn btn-primary btn-sm", onclick: addEntry }, "Add")
      )
    ),
    h("div", { class: "card" },
      h("div", { style: "display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:6px;" },
        h("h2", {}, "Diary feed"),
        h("div", { style: "display:flex;gap:6px;align-items:center;flex-wrap:wrap;" },
          h("span", { style: "font-size:11.5px;color:var(--ink-soft);" }, "From"), fromInput,
          h("span", { style: "font-size:11.5px;color:var(--ink-soft);" }, "To"), toInput,
          clearRangeBtn
        )
      ),
      typeChips,
      feedWrap
    )
  );
  renderFeed();
}
