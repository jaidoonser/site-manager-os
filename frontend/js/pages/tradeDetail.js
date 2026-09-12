import { h, mount, fmtDate, fmtDateTime, toast, attendanceLabel } from "../dom.js";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { openActivityDrawer } from "../components/activityDrawer.js";

const CHECKLIST_ITEMS = [
  ["book_invite", "Book / invite"],
  ["confirm_attendance", "Confirm attendance"],
  ["materials", "Materials ordered / available"],
  ["shop_drawings", "Shop drawings / approvals complete"],
  ["access_ready", "Access ready"],
  ["predecessor_complete", "Predecessor complete"],
  ["site_info_sent", "Site information sent"],
  ["special_plant", "Special plant / permits arranged"],
];

const STATUS_OPTIONS = ["not_contacted", "tentative", "confirmed", "on_site", "complete"];

export async function renderTradeDetail(container, pid, tradeId) {
  mount(container, h("div", { class: "loading" }, "Loading trade…"));
  const trade = await api.trade(pid, tradeId);
  draw(container, pid, trade);
}

function draw(container, pid, trade) {
  const refresh = () => renderTradeDetail(container, pid, trade.id);

  const infoCard = h("div", { class: "card" },
    h("h2", {}, "Contact"),
    h("div", { style: "font-size:13.5px;line-height:1.9;" },
      h("div", {}, h("strong", {}, "Contact: "), trade.contact_name || "—"),
      h("div", {}, h("strong", {}, "Phone: "), trade.contact_phone || "—"),
      h("div", {}, h("strong", {}, "Email: "), trade.contact_email || "—"),
    ),
    h("button", { class: "btn btn-secondary btn-sm", style: "margin-top:10px", onclick: () => openEditTradeModal(pid, trade, refresh) }, "Edit contact")
  );

  const activitiesCard = h("div", { class: "card" },
    h("h2", {}, "Assigned activities"),
    trade.activities && trade.activities.length
      ? h("div", { class: "row-list" }, trade.activities.map((a) => h("div", { class: "row-item", onclick: () => openActivityDrawer(pid, a.id, { onChange: refresh }) },
          h("div", { class: "title" }, a.name),
          h("div", { class: "spacer" }),
          h("span", { class: "meta" }, a.forecast_start || "—")
        )))
      : h("div", { class: "empty-state" }, "No activities assigned yet.")
  );

  const attendanceRows = (trade.attendances || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map((att) => attendanceRow(pid, trade, att, refresh));

  mount(container,
    h("div", { class: "page-header" },
      h("div", {},
        h("a", { href: `#/p/${pid}/trades`, style: "font-size:12.5px;color:var(--ink-soft);text-decoration:none;" }, "← All trades"),
        h("h1", { style: "margin-top:4px;" }, trade.name)
      ),
      h("button", { class: "btn btn-primary btn-sm", onclick: () => openNewAttendanceModal(pid, trade, refresh) }, "+ Add attendance")
    ),
    h("div", { class: "grid-2" },
      h("div", {},
        h("div", { class: "card" },
          h("h2", {}, "Attendance history & upcoming visits"),
          attendanceRows.length ? h("div", {}, attendanceRows) : h("div", { class: "empty-state" }, "No attendance dates recorded yet.")
        )
      ),
      h("div", {}, infoCard, activitiesCard)
    )
  );
}

function attendanceRow(pid, trade, att, refresh) {
  const checklist = safeParse(att.checklist_json);
  const isPast = att.date < new Date().toISOString().slice(0, 10);

  const statusSelect = h("select", {}, STATUS_OPTIONS.map((s) => h("option", { value: s, selected: s === att.status }, attendanceLabel(s))));
  statusSelect.addEventListener("change", async () => {
    try {
      await api.updateAttendance(pid, att.id, { status: statusSelect.value });
      toast("Updated");
      refresh();
    } catch (e) { toast(e.message, true); }
  });

  const checklistEl = h("div", { class: "checklist" }, CHECKLIST_ITEMS.map(([key, label]) => {
    const cb = h("input", { type: "checkbox", checked: !!checklist[key] });
    cb.addEventListener("change", async () => {
      checklist[key] = cb.checked;
      try { await api.updateAttendance(pid, att.id, { checklist }); } catch (e) { toast(e.message, true); }
    });
    return h("label", {}, cb, label);
  }));

  return h("div", { class: "card", style: isPast ? "opacity:0.75" : "" },
    h("div", { style: "display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;" },
      h("div", {},
        h("div", { style: "font-weight:700;font-size:14px;" }, fmtDate(att.date)),
        att.activity_name ? h("div", { class: "meta" }, att.activity_name) : null
      ),
      statusSelect
    ),
    att.notes ? h("div", { style: "font-size:12.8px;color:var(--ink-soft);margin-top:6px;" }, att.notes) : null,
    h("div", { style: "font-size:11px;text-transform:uppercase;color:var(--ink-soft);font-weight:700;margin-top:10px;" }, "Preparation checklist"),
    checklistEl
  );
}

function safeParse(json) {
  try { return JSON.parse(json || "{}"); } catch (e) { return {}; }
}

function openNewAttendanceModal(pid, trade, refresh) {
  const dateInput = h("input", { type: "date" });
  const activitySelect = h("select", {}, h("option", { value: "" }, "— none —"),
    (trade.activities || []).map((a) => h("option", { value: a.id }, a.name)));
  const notesInput = h("textarea", { rows: 2 });
  const err = h("div", { class: "error-text" });

  async function save() {
    if (!dateInput.value) { err.textContent = "Date is required"; return; }
    try {
      await api.createAttendance(pid, trade.id, {
        date: dateInput.value, activity_id: activitySelect.value || null, notes: notesInput.value.trim(),
      });
      toast("Attendance added");
      bg.remove();
      refresh();
    } catch (e) { err.textContent = e.message; }
  }

  const bg = h("div", { class: "modal-center-bg", onclick: (e) => { if (e.target === bg) bg.remove(); } },
    h("div", { class: "modal-card" },
      h("div", { style: "font-weight:700;margin-bottom:12px;font-size:15px;" }, `Add attendance – ${trade.name}`),
      h("div", { class: "field" }, h("label", {}, "Date"), dateInput),
      h("div", { class: "field" }, h("label", {}, "Related activity"), activitySelect),
      h("div", { class: "field" }, h("label", {}, "Notes"), notesInput),
      err,
      h("div", { class: "form-actions" },
        h("button", { class: "btn btn-secondary btn-sm", onclick: () => bg.remove() }, "Cancel"),
        h("button", { class: "btn btn-primary btn-sm", onclick: save }, "Add")
      )
    )
  );
  document.body.appendChild(bg);
}

function openEditTradeModal(pid, trade, refresh) {
  const nameInput = h("input", { type: "text", value: trade.name });
  const contactInput = h("input", { type: "text", value: trade.contact_name || "" });
  const phoneInput = h("input", { type: "text", value: trade.contact_phone || "" });
  const emailInput = h("input", { type: "email", value: trade.contact_email || "" });
  const err = h("div", { class: "error-text" });

  async function save() {
    try {
      await api.updateTrade(pid, trade.id, {
        name: nameInput.value.trim(), contact_name: contactInput.value.trim(),
        contact_phone: phoneInput.value.trim(), contact_email: emailInput.value.trim(),
      });
      toast("Saved");
      bg.remove();
      refresh();
    } catch (e) { err.textContent = e.message; }
  }

  const bg = h("div", { class: "modal-center-bg", onclick: (e) => { if (e.target === bg) bg.remove(); } },
    h("div", { class: "modal-card" },
      h("div", { style: "font-weight:700;margin-bottom:12px;font-size:15px;" }, "Edit trade contact"),
      h("div", { class: "field" }, h("label", {}, "Company name"), nameInput),
      h("div", { class: "field" }, h("label", {}, "Contact name"), contactInput),
      h("div", { class: "two-col-form" },
        h("div", { class: "field" }, h("label", {}, "Phone"), phoneInput),
        h("div", { class: "field" }, h("label", {}, "Email"), emailInput),
      ),
      err,
      h("div", { class: "form-actions" },
        h("button", { class: "btn btn-secondary btn-sm", onclick: () => bg.remove() }, "Cancel"),
        h("button", { class: "btn btn-primary btn-sm", onclick: save }, "Save")
      )
    )
  );
  document.body.appendChild(bg);
}
