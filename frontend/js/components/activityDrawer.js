import { h, mount, clear, fmtDate, fmtDateTime, toast, statusBadge } from "../dom.js";
import { api, photoFileUrl } from "../api.js";

let closeFn = null;

export async function openActivityDrawer(pid, activityId, { onChange } = {}) {
  if (closeFn) closeFn();

  const bg = h("div", { class: "overlay-bg", onclick: (e) => { if (e.target === bg) close(); } });
  const drawer = h("div", { class: "drawer" }, h("div", { class: "loading" }, "Loading…"));
  bg.appendChild(drawer);
  document.body.appendChild(bg);

  function close() {
    bg.remove();
    closeFn = null;
    document.removeEventListener("keydown", onEsc);
  }
  function onEsc(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onEsc);
  closeFn = close;

  let activity;
  try {
    activity = await api.activity(pid, activityId);
  } catch (e) {
    clear(drawer);
    drawer.appendChild(h("div", { class: "error-text" }, e.message));
    return;
  }
  renderDrawer(drawer, pid, activity, close, onChange);
}

function diaryColor(type) {
  return { progress: "#2f6fed", delay: "#d64545", decision: "#e2a336", attendance: "#1e8e5a", system: "#8b93a7", note: "#8b93a7" }[type] || "#8b93a7";
}

function renderDrawer(drawer, pid, activity, close, onChange) {
  clear(drawer);

  const editState = {
    planned_start: activity.planned_start || "",
    planned_end: activity.planned_end || "",
    forecast_start: activity.forecast_start || "",
    forecast_end: activity.forecast_end || "",
    actual_start: activity.actual_start || "",
    actual_end: activity.actual_end || "",
    progress_percent: activity.progress_percent || 0,
    blocked_manual: !!activity.blocked_manual,
    blocked_reason: activity.blocked_reason || "",
    notes: activity.notes || "",
  };

  async function save() {
    try {
      const updated = await api.updateActivity(pid, activity.id, editState);
      toast("Saved");
      if (onChange) onChange(updated);
      renderDrawer(drawer, pid, updated, close, onChange);
    } catch (e) {
      toast(e.message, true);
    }
  }

  const header = h("div", { class: "drawer-header" },
    h("div", {},
      h("h2", {}, activity.name),
      h("div", { style: "margin-top:6px;display:flex;gap:6px;align-items:center;" },
        statusBadge(activity.status, activity.status_label),
        activity.trade ? h("span", { class: "tag" }, activity.trade.name) : null
      )
    ),
    h("button", { class: "close-x", onclick: close }, "✕")
  );
  drawer.appendChild(header);

  if (activity.predecessor_name) {
    drawer.appendChild(h("div", { class: "card", style: "background:#fafbff" },
      h("div", { style: "font-size:12.5px;color:var(--ink-soft)" }, "Predecessor"),
      h("div", { style: "font-size:13.5px;font-weight:600" }, activity.predecessor_name)
    ));
  }

  // Dates card
  const dateField = (label, key, disabled) => h("div", { class: "field" },
    h("label", {}, label),
    h("input", {
      type: "date", value: editState[key], disabled: !!disabled,
      onchange: (e) => { editState[key] = e.target.value; },
    })
  );

  drawer.appendChild(h("div", { class: "card" },
    h("h2", {}, "Dates"),
    h("div", { class: "two-col-form" },
      dateField("Planned start", "planned_start", true),
      dateField("Planned end", "planned_end", true),
      dateField("Forecast start", "forecast_start"),
      dateField("Forecast end", "forecast_end"),
      dateField("Actual start", "actual_start"),
      dateField("Actual end", "actual_end"),
    )
  ));

  // Progress + blocked
  const progressInput = h("input", {
    type: "range", min: "0", max: "100", step: "5", value: String(editState.progress_percent),
  });
  const progressLabel = h("span", {}, `${editState.progress_percent}%`);
  progressInput.addEventListener("input", (e) => {
    editState.progress_percent = Number(e.target.value);
    progressLabel.textContent = `${editState.progress_percent}%`;
  });

  const blockedCheckbox = h("input", {
    type: "checkbox", checked: editState.blocked_manual,
    onchange: (e) => { editState.blocked_manual = e.target.checked; reasonInput.disabled = !e.target.checked; },
  });
  const reasonInput = h("textarea", {
    rows: 2, placeholder: "Why is this blocked?", disabled: !editState.blocked_manual,
    oninput: (e) => { editState.blocked_reason = e.target.value; },
  }, editState.blocked_reason);

  drawer.appendChild(h("div", { class: "card" },
    h("h2", {}, "Progress"),
    h("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:14px;" }, progressInput, progressLabel),
    h("label", { style: "display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;margin-bottom:6px;" },
      blockedCheckbox, "Flag as blocked"),
    reasonInput
  ));

  const notesInput = h("textarea", {
    rows: 3, oninput: (e) => { editState.notes = e.target.value; },
  }, editState.notes);
  drawer.appendChild(h("div", { class: "card" },
    h("h2", {}, "Notes"),
    notesInput
  ));

  drawer.appendChild(h("div", { class: "form-actions" },
    h("button", { class: "btn btn-primary", onclick: save }, "Save changes")
  ));

  // Zones
  if (activity.zones && activity.zones.length) {
    drawer.appendChild(h("div", { class: "card" },
      h("h2", {}, "Linked work faces"),
      h("div", {}, activity.zones.map((z) => h("span", { class: "tag" }, z.name)))
    ));
  }

  // Photos
  const photoGrid = h("div", { class: "photo-grid" },
    (activity.photos || []).map((p) => h("img", { src: photoFileUrl(p.file_path), title: p.caption || "" }))
  );
  const fileInput = h("input", { type: "file", accept: "image/*", style: "display:none" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      await api.uploadPhoto(pid, file, { activityId: activity.id });
      toast("Photo added");
      const updated = await api.activity(pid, activity.id);
      renderDrawer(drawer, pid, updated, close, onChange);
    } catch (e) {
      toast(e.message, true);
    }
  });
  drawer.appendChild(h("div", { class: "card" },
    h("h2", {}, `Photos ${activity.photos && activity.photos.length ? `(${activity.photos.length})` : ""}`),
    photoGrid,
    h("button", { class: "btn btn-secondary btn-sm", style: "margin-top:10px", onclick: () => fileInput.click() }, "Add photo"),
    fileInput
  ));

  // Diary / history
  const diaryItems = (activity.diary || []).map((d) => h("div", { class: "diary-entry" },
    h("span", { class: "dtype", style: `background:${diaryColor(d.entry_type)}` }),
    h("div", {},
      h("div", { class: "txt" }, d.text),
      h("div", { class: "meta" }, `${d.author || "—"} · ${fmtDateTime(d.created_at)}`)
    )
  ));
  drawer.appendChild(h("div", { class: "card" },
    h("h2", {}, "Activity history"),
    diaryItems.length ? h("div", {}, diaryItems) : h("div", { class: "empty-state" }, "No history yet.")
  ));

  if (activity.dependents && activity.dependents.length) {
    drawer.appendChild(h("div", { class: "card" },
      h("h2", {}, "Depends on this finishing"),
      h("div", { class: "row-list" }, activity.dependents.map((d) => h("div", { class: "row-item", style: "cursor:default" },
        h("span", { class: "title" }, d.name)
      )))
    ));
  }
}
