import { h, mount, clear, toast } from "../dom.js";
import { api, drawingFileUrl } from "../api.js";
import { navigate } from "../router.js";
import { openActivityDrawer } from "../components/activityDrawer.js";

const STATUS_COLORS = {
  complete: "#1e8e5a", active: "#2f6fed", ready: "#e2a336", not_ready: "#8b93a7", blocked: "#d64545", unassigned: "#c7cdd9",
};

let renderToken = 0;

export async function renderPlans(container, pid, { sheetId } = {}) {
  mount(container, h("div", { class: "loading" }, "Loading drawings…"));
  const drawingSets = await api.drawings(pid);

  if (!drawingSets.length) {
    renderEmpty(container, pid);
    return;
  }

  let activeSheetId = sheetId ? Number(sheetId) : null;
  if (!activeSheetId) {
    for (const ds of drawingSets) { if (ds.sheets.length) { activeSheetId = ds.sheets[0].id; break; } }
  }

  await drawLayout(container, pid, drawingSets, activeSheetId);
}

function renderEmpty(container, pid) {
  const fileInput = h("input", { type: "file", accept: "application/pdf", style: "display:none" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    toast("Uploading and indexing sheets…");
    try {
      await api.uploadDrawing(pid, file);
      toast("Drawing set uploaded");
      renderPlans(container, pid, {});
    } catch (e) { toast(e.message, true); }
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

async function drawLayout(container, pid, drawingSets, activeSheetId) {
  const allSheets = drawingSets.flatMap((ds) => ds.sheets.map((s) => ({ ...s, drawingSetName: ds.original_filename })));
  const activeSheet = allSheets.find((s) => s.id === activeSheetId) || allSheets[0];

  const fileInput = h("input", { type: "file", accept: "application/pdf", style: "display:none" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    toast("Uploading and indexing sheets…");
    try {
      const ds = await api.uploadDrawing(pid, file);
      toast(`Indexed ${ds.sheets.length} sheet(s)`);
      renderPlans(container, pid, { sheetId: ds.sheets[0] ? ds.sheets[0].id : undefined });
    } catch (e) { toast(e.message, true); }
  });

  const sheetListEl = h("div", { class: "sheet-list" },
    drawingSets.map((ds) => h("div", {},
      h("div", { style: "font-size:11px;text-transform:uppercase;color:var(--ink-soft);font-weight:700;margin:10px 0 4px;" }, ds.original_filename),
      ds.sheets.map((s) => h("div", {
        class: "sheet-item" + (s.id === activeSheet.id ? " active" : ""),
        onclick: () => navigate(`/p/${pid}/plans/${s.id}`),
      },
        h("div", { class: "num" }, s.sheet_number),
        h("div", { class: "tt" }, s.sheet_title),
        s.ai_confidence !== "confirmed" ? h("div", { class: "needs-review" }, "AI guess — review") : null
      ))
    ))
  );

  const canvasWrap = h("div", { class: "drawing-canvas-wrap" }, h("div", { class: "loading" }, "Rendering sheet…"));
  const zoneListEl = h("div", { class: "row-list" });
  const sheetInfoEl = h("div", {});

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
      h("div", {}, canvasWrap, legend),
      rightPanel
    )
  );

  await renderSheetDetail(pid, activeSheet, sheetInfoEl, () => renderPlans(container, pid, { sheetId: activeSheet.id }));
  await renderSheetCanvas(pid, activeSheet, canvasWrap, zoneListEl);
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

async function renderSheetCanvas(pid, sheet, wrap, zoneListEl) {
  const myToken = ++renderToken;
  clear(wrap);
  wrap.style.width = "";
  wrap.appendChild(h("div", { class: "loading" }, "Rendering sheet…"));

  const full = await api.sheet(pid, sheet.id);
  if (myToken !== renderToken) return;

  if (!full.image_filename) {
    clear(wrap);
    wrap.appendChild(h("div", { class: "empty-state" }, "This sheet couldn't be rendered as an image."));
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

  const refresh = () => renderSheetCanvas(pid, sheet, wrap, zoneListEl);
  let zones = await api.zones(pid, sheet.id);
  if (myToken !== renderToken) return;
  drawZones(pid, sheet, zones, overlay, viewport, zoneListEl, refresh);

  setupZoneDrawing(pid, sheet, overlay, viewport, refresh);
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

function setupZoneDrawing(pid, sheet, overlay, viewport, refresh) {
  let drawing = false;
  let startX, startY;
  let tempBox = null;

  const hint = h("div", { class: "zone-draw-hint" }, "Drag on the plan to draw a new work-face zone");
  overlay.parentElement.appendChild(hint);

  overlay.addEventListener("mousedown", (e) => {
    if (e.target !== overlay) return; // clicked an existing zone box
    const rect = overlay.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    drawing = true;
    tempBox = h("div", { class: "zone-box", style: `left:${startX}px;top:${startY}px;width:0;height:0;border-color:#2f6fed;background:#2f6fed22;` });
    overlay.appendChild(tempBox);
  });

  window.addEventListener("mousemove", (e) => {
    if (!drawing || !tempBox) return;
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const left = Math.min(x, startX), top = Math.min(y, startY);
    const w = Math.abs(x - startX), hgt = Math.abs(y - startY);
    tempBox.style.left = left + "px"; tempBox.style.top = top + "px";
    tempBox.style.width = w + "px"; tempBox.style.height = hgt + "px";
  });

  window.addEventListener("mouseup", async (e) => {
    if (!drawing) return;
    drawing = false;
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
      refresh();
    } catch (err) { toast(err.message, true); }
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
