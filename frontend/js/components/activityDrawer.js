import { h, mount, clear, fmtDate, fmtDateTime, toast, statusBadge } from "../dom.js";
import { api, photoFileUrl } from "../api.js";
import { navigate } from "../router.js";

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
    delay_reason: "",
  };

  // Tracks the dates as they were when this drawer was opened, so we can
  // tell whether the user has actually changed a forecast/actual date (as
  // opposed to just re-saving) and prompt for why - e.g. a site delay -
  // so it's on record and referenceable later.
  const originalDates = {
    forecast_start: editState.forecast_start,
    forecast_end: editState.forecast_end,
    actual_start: editState.actual_start,
    actual_end: editState.actual_end,
  };
  function datesChanged() {
    return Object.keys(originalDates).some((k) => editState[k] !== originalDates[k]);
  }

  const reasonInputEl = h("textarea", {
    rows: 2, placeholder: "e.g. Wet weather delayed the concrete pour by 3 days",
    oninput: (e) => { editState.delay_reason = e.target.value; },
  });
  const reasonWrap = h("div", { class: "field", style: "display:none;margin-top:10px;" },
    h("label", {}, "Reason for the date change (kept on this task's history)"),
    reasonInputEl
  );
  function refreshReasonVisibility() {
    reasonWrap.style.display = datesChanged() ? "" : "none";
  }

  async function save() {
    try {
      await api.updateActivity(pid, activity.id, editState);
      // Re-fetch the full activity (not just the PUT response) so newly
      // created diary entries - e.g. the delay-reason note just below, or a
      // "flagged as blocked" entry - show up in Activity history right away
      // instead of only appearing the next time the drawer is opened.
      const fresh = await api.activity(pid, activity.id);
      toast("Saved");
      if (onChange) onChange(fresh);
      renderDrawer(drawer, pid, fresh, close, onChange);
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

  function todayIso() { return new Date().toISOString().slice(0, 10); }

  // Status (Ready/Active/Complete/etc.) is driven entirely by Actual
  // start/end, not by the progress slider - so the two need to stay in
  // sync or a task can sit at "100%" forever without ever becoming
  // "Complete" (and without unblocking whatever comes after it). Nudging
  // one to keep the other consistent - without ever overwriting a date the
  // user already set - keeps that from surprising anyone.
  const dateInputs = {};
  const dateField = (label, key, disabled) => {
    const input = h("input", {
      type: "date", value: editState[key], disabled: !!disabled,
      onchange: (e) => {
        editState[key] = e.target.value;
        if (key === "actual_end" && editState.actual_end && editState.progress_percent < 100) {
          setProgress(100);
        }
        if (key === "actual_start" && editState.actual_start && editState.progress_percent === 0) {
          setProgress(5);
        }
        refreshReasonVisibility();
      },
    });
    dateInputs[key] = input;
    return h("div", { class: "field" }, h("label", {}, label), input);
  };

  drawer.appendChild(h("div", { class: "card" },
    h("h2", {}, "Dates"),
    h("div", { class: "two-col-form" },
      dateField("Planned start", "planned_start", true),
      dateField("Planned end", "planned_end", true),
      dateField("Forecast start", "forecast_start"),
      dateField("Forecast end", "forecast_end"),
      dateField("Actual start", "actual_start"),
      dateField("Actual end", "actual_end"),
    ),
    reasonWrap
  ));

  // Progress + blocked
  const progressInput = h("input", {
    type: "range", min: "0", max: "100", step: "5", value: String(editState.progress_percent),
  });
  const progressLabel = h("span", {}, `${editState.progress_percent}%`);

  function setProgress(value) {
    editState.progress_percent = value;
    progressInput.value = String(value);
    progressLabel.textContent = `${value}%`;
  }

  progressInput.addEventListener("input", (e) => {
    setProgress(Number(e.target.value));
    // Forward-fill actual dates so status (and anything waiting on this
    // task) keeps up with progress - but never overwrite a date already
    // on record.
    if (editState.progress_percent > 0 && !editState.actual_start) {
      editState.actual_start = todayIso();
      if (dateInputs.actual_start) dateInputs.actual_start.value = editState.actual_start;
    }
    if (editState.progress_percent >= 100 && !editState.actual_end) {
      editState.actual_end = todayIso();
      if (dateInputs.actual_end) dateInputs.actual_end.value = editState.actual_end;
    }
    refreshReasonVisibility();
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
    h("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:6px;" }, progressInput, progressLabel),
    h("div", { style: "font-size:11.5px;color:var(--ink-soft);margin-bottom:14px;" },
      "Dragging to 100% sets Actual end to today (if it isn't set yet) so the task shows as Complete — adjust the date above if it finished on a different day."),
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
      h("div", {}, activity.zones.map((z) => h("span", {
        class: "tag", style: "cursor:pointer;",
        title: "View on the plan",
        onclick: () => { close(); navigate(`/p/${pid}/plans/${z.sheet_id}?zone=${z.id}&activity=${activity.id}`); },
      }, z.name + " ↗")))
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
