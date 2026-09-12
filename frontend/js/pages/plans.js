import { h, mount, clear, toast } from "../dom.js";
import { api, drawingFileUrl } from "../api.js";
import { navigate } from "../router.js";
import { openActivityDrawer } from "../components/activityDrawer.js";

const STATUS_COLORS = {
  complete: "#1e8e5a", active: "#2f6fed", ready: "#e2a336", not_ready: "#8b93a7", blocked: "#d64545", unassigned: "#c7cdd9",
};

const DISCIPLINES = [
  { value: "architectural", label: "Architectural" },
  { value: "structural", label: "Structural" },
  { value: "civil", label: "Civil" },
  { value: "hydraulic", label: "Hydraulic" },
  { value: "electrical", label: "Electrical" },
  { value: "mechanical", label: "Mechanical" },
  { value: "landscape", label: "Landscape" },
  { value: "fire", label: "Fire" },
  { value: "geotechnical", label: "Geotechnical" },
  { value: "survey", label: "Survey" },
  { value: "other", label: "Other" },
];
const DISCIPLINE_LABELS = Object.fromEntries(DISCIPLINES.map((d) => [d.value, d.label]));

let renderToken = 0;
let plansRenderGen = 0;

export async function renderPlans(container, pid, { sheetId } = {}) {
  const myGen = ++plansRenderGen;
  mount(container, h("div", { class: "loading" }, "Loading drawings…"));
  const drawingSets = await api.drawings(pid);
  if (myGen !== plansRenderGen) return;

  if (!drawingSets.length) {
    renderEmpty(container, pid);
    return;
  }

  let activeSheetId = sheetId ? Number(sheetId) : null;
  if (!activeSheetId) {
    for (const ds of drawingSets) { if (ds.sheets.length) { activeSheetId = ds.sheets[0].id; break; } }
  }

  await drawLayout(container, pid, drawingSets, activeSheetId, null);

  // If anything's still rendering in the background, quietly refresh the
  // sheet list in a bit so the "Rendering image…" tags clear on their own.
  const anyPending = drawingSets.some((ds) => ds.sheets.some((s) => s.image_status === "pending"));
  if (anyPending) {
    setTimeout(() => { if (myGen === plansRenderGen) renderPlans(container, pid, { sheetId: activeSheetId }); }, 4000);
  }
}

function renderEmpty(container, pid) {
  const fileInput = h("input", { type: "file", accept: "application/pdf", style: "display:none" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const discipline = await promptDiscipline("What kind of drawing set is this?", { includeAuto: true });
    if (discipline === null) { fileInput.value = ""; return; }
    await doUpload(pid, file, discipline, (ds) => renderPlans(container, pid, { sheetId: ds.sheets[0] ? ds.sheets[0].id : undefined }));
  });
  mount(container,
    h("div", { class: "page-header" }, h("h1", {}, "Plans")),
    h("div", { class: "card" },
      h("div", { class: "upload-drop", onclick: () => fileInput.click() },
        h("div", { style: "font-size:15px;font-weight:700;margin-bottom:6px;" }, "Upload your first drawing set"),
        "Click to choose a PDF. We'll index sheet numbers, titles and types automatically — you can correct anything the AI gets wrong.",
        fileInput
      )
    )
  );
}

async function drawLayout(container, pid, drawingSets, activeSheetId, activeDiscipline) {
  const presentDisciplines = Array.from(new Set(drawingSets.map((ds) => ds.discipline || "other")));
  const visibleSets = activeDiscipline ? drawingSets.filter((ds) => (ds.discipline || "other") === activeDiscipline) : drawingSets;
  const allSheets = visibleSets.flatMap((ds) => ds.sheets.map((s) => ({ ...s, drawingSetName: ds.original_filename })));
  const activeSheet = allSheets.find((s) => s.id === activeSheetId) || allSheets[0];

  const fileInput = h("input", { type: "file", accept: "application/pdf", style: "display:none" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const discipline = await promptDiscipline("What kind of drawing set is this?", { includeAuto: true });
    if (discipline === null) { fileInput.value = ""; return; }
    await doUpload(pid, file, discipline, (ds) => renderPlans(container, pid, { sheetId: ds.sheets[0] ? ds.sheets[0].id : undefined }));
  });

  async function editDiscipline(ds) {
    const chosen = await promptDiscipline(`Discipline for "${ds.original_filename}"`, { current: ds.discipline || "other" });
    if (chosen === null) return;
    try {
      await api.updateDrawingSet(pid, ds.id, { discipline: chosen });
      toast("Discipline updated");
      renderPlans(container, pid, { sheetId: activeSheet ? activeSheet.id : undefined });
    } catch (e) { toast(e.message, true); }
  }

  const filterBar = presentDisciplines.length > 1
    ? h("div", { class: "discipline-tabs" },
        h("button", {
          class: "chip" + (!activeDiscipline ? " active" : ""),
          onclick: () => drawLayout(container, pid, drawingSets, activeSheetId, null),
        }, "All"),
        presentDisciplines.map((d) => h("button", {
          class: "chip" + (d === activeDiscipline ? " active" : ""),
          onclick: () => drawLayout(container, pid, drawingSets, activeSheetId, d),
        }, DISCIPLINE_LABELS[d] || "Other"))
      )
    : null;

  const sheetListEl = h("div", { class: "sheet-list" },
    filterBar,
    visibleSets.map((ds) => h("div", {},
      h("div", { class: "drawing-set-heading" },
        h("span", { class: "name" }, ds.original_filename),
        h("span", { class: "tag" }, DISCIPLINE_LABELS[ds.discipline] || "Other"),
        ds.discipline_confidence && ds.discipline_confidence !== "confirmed" ? h("span", { class: "needs-review" }, "AI guess") : null,
        h("button", { class: "link-btn", onclick: () => editDiscipline(ds) }, "Edit")
      ),
      ds.sheets.map((s) => h("div", {
        class: "sheet-item" + (activeSheet && s.id === activeSheet.id ? " active" : ""),
        onclick: () => navigate(`/p/${pid}/plans/${s.id}`),
      },
        h("div", { class: "num" }, s.sheet_number),
        h("div", { class: "tt" }, s.sheet_title),
        s.ai_confidence !== "confirmed" ? h("div", { class: "needs-review" }, "AI guess — review") : null,
        s.image_status === "pending" ? h("div", { style: "font-size:10.5px;color:var(--ink-soft);" }, "Rendering image…") : null
      ))
    ))
  );

  const canvasWrap = h("div", { class: "drawing-canvas-wrap" }, h("div", { class: "loading" }, "Rendering sheet…"));
  const zoneListEl = h("div", { class: "row-list" });
  const sheetInfoEl = h("div", {});
  const addZoneBtn = h("button", { class: "btn btn-secondary btn-sm" }, "Add zone");

  const rightPanel = h("div", {},
    h("div", { class: "card" }, h("h2", {}, "Sheet details"), sheetInfoEl),
    h("div", { class: "card" }, h("h2", {}, "Work faces on this sheet"), zoneListEl)
  );

  const legend = h("div", { class: "legend" },
    Object.entries({ Complete: "complete", Active: "active", Ready: "ready", "Not Ready": "not_ready", Blocked: "blocked", Unassigned: "unassigned" })
      .map(([label, key]) => h("div", { class: "item" },
        h("span", { class: "dot", style: `background:${STATUS_COLORS[key]}` }), label
      ))
  );

  mount(container,
    h("div", { class: "page-header" },
      h("div", {},
        h("h1", {}, "Plans"),
        h("div", { class: "sub" }, "Tap a zone to see its task, trade, dates and photos.")
      ),
      h("div", {},
        h("button", { class: "btn btn-secondary btn-sm", onclick: () => fileInput.click() }, "Upload drawing set"),
        fileInput
      )
    ),
    h("div", { class: "plans-layout" },
      h("div", { class: "card" }, sheetListEl),
      h("div", {},
        h("div", { style: "display:flex;justify-content:flex-end;margin-bottom:8px;" }, addZoneBtn),
        canvasWrap,
        legend
      ),
      rightPanel
    )
  );

  if (!activeSheet) return; // filtered discipline has no sheets - list-only state above is enough
  await renderSheetDetail(pid, activeSheet, sheetInfoEl, () => renderPlans(container, pid, { sheetId: activeSheet.id }));
  await renderSheetCanvas(pid, activeSheet, canvasWrap, zoneListEl, addZoneBtn);
}

async function renderSheetDetail(pid, sheet, el, onSaved) {
  const numInput = h("input", { type: "text", value: sheet.sheet_number || "" });
  const titleInput = h("input", { type: "text", value: sheet.sheet_title || "" });
  const typeSelect = h("select", {},
    ["plan", "elevation", "section", "detail", "schedule", "other"].map((t) =>
      h("option", { value: t, selected: t === sheet.sheet_type }, t[0].toUpperCase() + t.slice(1)))
  );
  async function save() {
    try {
      await api.updateSheet(pid, sheet.id, { sheet_number: numInput.value, sheet_title: titleInput.value, sheet_type: typeSelect.value });
      toast("Sheet updated");
      onSaved();
    } catch (e) { toast(e.message, true); }
  }
  mount(el,
    sheet.ai_confidence !== "confirmed" ? h("div", { style: "background:var(--amber-light);color:#93691c;padding:8px 10px;border-radius:8px;font-size:12px;margin-bottom:10px;" },
      "AI-suggested from the drawing text — please confirm or correct.") : null,
    h("div", { class: "field" }, h("label", {}, "Sheet number"), numInput),
    h("div", { class: "field" }, h("label", {}, "Sheet title"), titleInput),
    h("div", { class: "field" }, h("label", {}, "Type"), typeSelect),
    h("button", { class: "btn btn-secondary btn-sm", onclick: save }, "Confirm / save")
  );
}

async function renderSheetCanvas(pid, sheet, wrap, zoneListEl, addZoneBtn, pollAttempt = 0) {
  const myToken = ++renderToken;
  clear(wrap);
  wrap.style.width = "";
  wrap.appendChild(h("div", { class: "loading" }, "Rendering sheet…"));
  if (addZoneBtn) addZoneBtn.disabled = true;

  const full = await api.sheet(pid, sheet.id);
  if (myToken !== renderToken) return;

  if (full.image_status === "pending") {
    clear(wrap);
    wrap.appendChild(h("div", { class: "empty-state" },
      "Rendering this sheet's image in the background… large drawing sets can take a minute or two. This updates automatically."));
    if (pollAttempt < 40) { // ~2 minutes of polling before giving up
      setTimeout(() => { if (myToken === renderToken) renderSheetCanvas(pid, sheet, wrap, zoneListEl, addZoneBtn, pollAttempt + 1); }, 3000);
    }
    return;
  }

  if (!full.image_filename) {
    clear(wrap);
    wrap.appendChild(h("div", { class: "empty-state" }, "This sheet couldn't be rendered as an image — the page may be corrupted or in an unsupported format."));
    return;
  }

  const containerWidth = Math.min((wrap.parentElement && wrap.parentElement.clientWidth) || 800, 900);
  const img = h("img", { src: drawingFileUrl(full.image_filename), style: `display:block;width:${containerWidth}px;height:auto;` });
  const overlay = h("div", { class: "zone-overlay" });
  clear(wrap);
  const inner = h("div", { style: "position:relative;" }, img, overlay);
  wrap.appendChild(inner);

  await new Promise((resolve) => {
    if (img.complete) resolve();
    else img.addEventListener("load", resolve, { once: true });
  });
  if (myToken !== renderToken) return;

  const width = img.clientWidth;
  const height = img.clientHeight;
  overlay.style.width = width + "px";
  overlay.style.height = height + "px";
  const viewport = { width, height };

  const refresh = () => renderSheetCanvas(pid, sheet, wrap, zoneListEl, addZoneBtn);
  let zones = await api.zones(pid, sheet.id);
  if (myToken !== renderToken) return;
  drawZones(pid, sheet, zones, overlay, viewport, zoneListEl, refresh);

  if (addZoneBtn) addZoneBtn.disabled = false;
  setupZoneDrawing(pid, sheet, overlay, viewport, refresh, addZoneBtn);
}

function drawZones(pid, sheet, zones, overlay, viewport, zoneListEl, refresh) {
  overlay.querySelectorAll(".zone-box").forEach((n) => n.remove());

  zones.forEach((z) => {
    const color = STATUS_COLORS[z.status] || STATUS_COLORS.unassigned;
    const box = h("div", {
      class: "zone-box",
      style: `left:${z.x * viewport.width}px;top:${z.y * viewport.height}px;width:${z.w * viewport.width}px;height:${z.h * viewport.height}px;border-color:${color};background:${color}22;`,
      onclick: (e) => {
        e.stopPropagation();
        if (z.activities && z.activities.length) {
          openActivityDrawer(pid, z.activities[0].id, { onChange: refresh });
        } else {
          toast(`'${z.name}' has no task linked yet — link one from the Programme screen.`);
        }
      },
    }, h("span", { class: "zlabel" }, z.name));
    overlay.appendChild(box);
  });

  mount(zoneListEl, zones.length
    ? zones.map((z) => h("div", { class: "row-item" },
        h("span", { class: "dot", style: `background:${STATUS_COLORS[z.status] || STATUS_COLORS.unassigned};margin-right:2px;` }),
        h("div", {},
          h("div", { class: "title" }, z.name),
          h("div", { class: "meta" }, z.activities && z.activities.length ? z.activities.map((a) => a.name).join(", ") : "No task linked")
        )
      ))
    : [h("div", { class: "empty-state" }, "No work faces drawn yet — draw a box on the plan to create one.")]);
}

// Pending window-level pointer listeners from a previous call, so they can
// be torn down before attaching new ones - otherwise every re-render (every
// sheet navigation, every zone created) would pile on another pair of
// listeners forever.
let _zonePointerMoveHandler = null;
let _zonePointerUpHandler = null;

function setupZoneDrawing(pid, sheet, overlay, viewport, refresh, addZoneBtn) {
  if (_zonePointerMoveHandler) window.removeEventListener("pointermove", _zonePointerMoveHandler);
  if (_zonePointerUpHandler) window.removeEventListener("pointerup", _zonePointerUpHandler);

  let drawModeActive = false;
  let drawing = false;
  let activePointerId = null;
  let startX, startY;
  let tempBox = null;

  const hint = h("div", { class: "zone-draw-hint" }, "Drag on the plan to draw a new work-face zone. Tap “Cancel” to stop.");
  hint.style.display = "none";
  overlay.parentElement.appendChild(hint);

  function setDrawMode(active) {
    drawModeActive = active;
    hint.style.display = active ? "" : "none";
    overlay.style.cursor = active ? "crosshair" : "";
    // touch-action: none while drawing so a finger-drag draws a box instead
    // of scrolling the page; back to normal so pinch/scroll works otherwise.
    overlay.style.touchAction = active ? "none" : "auto";
    if (addZoneBtn) {
      addZoneBtn.textContent = active ? "Cancel" : "Add zone";
      addZoneBtn.classList.toggle("btn-primary", active);
      addZoneBtn.classList.toggle("btn-secondary", !active);
    }
    if (!active && tempBox) { tempBox.remove(); tempBox = null; }
    drawing = false;
    activePointerId = null;
  }
  setDrawMode(false);

  if (addZoneBtn) addZoneBtn.onclick = () => setDrawMode(!drawModeActive);

  overlay.addEventListener("pointerdown", (e) => {
    if (!drawModeActive) return; // view mode - let clicks reach existing zone boxes normally
    if (e.target !== overlay) return; // clicked an existing zone box, not empty plan area
    e.preventDefault();
    const rect = overlay.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    drawing = true;
    activePointerId = e.pointerId;
    tempBox = h("div", { class: "zone-box", style: `left:${startX}px;top:${startY}px;width:0;height:0;border-color:#2f6fed;background:#2f6fed22;` });
    overlay.appendChild(tempBox);
  });

  _zonePointerMoveHandler = (e) => {
    if (!drawing || !tempBox || e.pointerId !== activePointerId) return;
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const left = Math.min(x, startX), top = Math.min(y, startY);
    const w = Math.abs(x - startX), hgt = Math.abs(y - startY);
    tempBox.style.left = left + "px"; tempBox.style.top = top + "px";
    tempBox.style.width = w + "px"; tempBox.style.height = hgt + "px";
  };

  _zonePointerUpHandler = async (e) => {
    if (!drawing || e.pointerId !== activePointerId) return;
    drawing = false;
    activePointerId = null;
    if (!tempBox) return;
    const w = parseFloat(tempBox.style.width);
    const hgt = parseFloat(tempBox.style.height);
    if (w < 12 || hgt < 12) { tempBox.remove(); tempBox = null; return; }
    const left = parseFloat(tempBox.style.left);
    const top = parseFloat(tempBox.style.top);
    tempBox.remove();
    tempBox = null;

    const name = await promptText("Name this work face", "e.g. Kitchen, Zone B, Amenities Block");
    if (!name) return;
    try {
      await api.createZone(pid, sheet.id, {
        name,
        x: left / viewport.width, y: top / viewport.height,
        w: w / viewport.width, h: hgt / viewport.height,
      });
      toast("Zone created");
      refresh(); // renderSheetCanvas re-runs and rebuilds in view mode by default
    } catch (err) { toast(err.message, true); }
  };

  window.addEventListener("pointermove", _zonePointerMoveHandler);
  window.addEventListener("pointerup", _zonePointerUpHandler);
}

// Shared upload flow for both the empty-state and the normal-state upload
// buttons: shows a real progress bar (from actual upload-progress events,
// not a guess) while the file transfers, then a brief "indexing" phase
// while the server responds - which should now be quick, since page image
// rendering happens in the background rather than blocking the response.
async function doUpload(pid, file, discipline, onDone) {
  const progress = showUploadProgress(file.name);
  try {
    const ds = await api.uploadDrawingWithProgress(pid, file, discipline || undefined, (pct) => {
      progress.setPercent(pct);
      if (pct >= 100) progress.setIndexing();
    });
    progress.close();
    toast(`Indexed ${ds.sheets.length} sheet(s) — page images are rendering in the background`);
    await onDone(ds);
  } catch (e) {
    progress.close();
    toast(e.message, true);
  }
}

function showUploadProgress(filename) {
  const fill = h("div", { style: "height:100%;width:0%;background:var(--blue);border-radius:6px;transition:width .15s;" });
  const bar = h("div", { style: "height:8px;background:var(--grey-light);border-radius:6px;overflow:hidden;margin:14px 0 8px;" }, fill);
  const statusText = h("div", { style: "font-size:12.5px;color:var(--ink-soft);" }, "Uploading… 0%");
  const bg = h("div", { class: "modal-center-bg" },
    h("div", { class: "modal-card", style: "max-width:380px;text-align:left;" },
      h("div", { style: "font-weight:700;margin-bottom:4px;" }, "Uploading drawing set"),
      h("div", { style: "font-size:12.5px;color:var(--ink-soft);overflow-wrap:anywhere;" }, filename),
      bar,
      statusText
    )
  );
  document.body.appendChild(bg);
  return {
    setPercent(pct) {
      fill.style.width = pct + "%";
      statusText.textContent = `Uploading… ${pct}%`;
    },
    setIndexing() {
      fill.style.width = "100%";
      statusText.textContent = "Upload complete — indexing sheets…";
    },
    close() { bg.remove(); },
  };
}

function promptDiscipline(title, { includeAuto = false, current } = {}) {
  return new Promise((resolve) => {
    const options = [];
    if (includeAuto) options.push(h("option", { value: "" }, "Let AI guess from the file"));
    DISCIPLINES.forEach((d) => options.push(h("option", { value: d.value, selected: d.value === current }, d.label)));
    const select = h("select", { autofocus: true }, options);
    function close(val) { bg.remove(); resolve(val); }
    const bg = h("div", { class: "modal-center-bg", onclick: (e) => { if (e.target === bg) close(null); } },
      h("div", { class: "modal-card" },
        h("div", { style: "font-weight:700;margin-bottom:10px;" }, title),
        h("div", { class: "field" }, h("label", {}, "Discipline"), select),
        h("div", { class: "form-actions" },
          h("button", { class: "btn btn-secondary btn-sm", onclick: () => close(null) }, "Cancel"),
          h("button", { class: "btn btn-primary btn-sm", onclick: () => close(select.value) }, "Continue")
        )
      )
    );
    document.body.appendChild(bg);
  });
}

function promptText(title, placeholder) {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", placeholder, autofocus: true });
    function close(val) { bg.remove(); resolve(val); }
    const bg = h("div", { class: "modal-center-bg", onclick: (e) => { if (e.target === bg) close(null); } },
      h("div", { class: "modal-card" },
        h("div", { style: "font-weight:700;margin-bottom:10px;" }, title),
        h("div", { class: "field" }, input),
        h("div", { class: "form-actions" },
          h("button", { class: "btn btn-secondary btn-sm", onclick: () => close(null) }, "Cancel"),
          h("button", { class: "btn btn-primary btn-sm", onclick: () => close(input.value.trim()) }, "Create")
        )
      )
    );
    document.body.appendChild(bg);
    setTimeout(() => input.focus(), 30);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") close(input.value.trim()); });
  });
}
