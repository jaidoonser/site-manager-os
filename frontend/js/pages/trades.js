import { h, mount, fmtDate, toast, attendanceLabel } from "../dom.js";
import { api } from "../api.js";
import { navigate } from "../router.js";

const STATUS_COLOR = { not_contacted: "#8b93a7", tentative: "#e2a336", confirmed: "#2f6fed", on_site: "#1e8e5a", complete: "#1e8e5a" };

export async function renderTrades(container, pid) {
  mount(container, h("div", { class: "loading" }, "Loading trades…"));
  const trades = await api.trades(pid);
  draw(container, pid, trades);
}

function draw(container, pid, trades) {
  const refresh = () => renderTrades(container, pid);

  const rows = trades.length ? trades.map((t) => h("div", { class: "row-item", onclick: () => navigate(`/p/${pid}/trades/${t.id}`) },
    h("div", {},
      h("div", { class: "title" }, t.name),
      h("div", { class: "meta" }, t.contact_name ? `${t.contact_name} · ${t.contact_phone || ""}` : "No contact on file")
    ),
    h("div", { class: "spacer" }),
    t.next_attendance
      ? h("div", { style: "text-align:right" },
          h("div", { style: `font-size:12.5px;font-weight:700;color:${STATUS_COLOR[t.next_attendance.status]}` }, attendanceLabel(t.next_attendance.status)),
          h("div", { style: "font-size:11.5px;color:var(--ink-soft)" }, "Next: " + fmtDate(t.next_attendance.date))
        )
      : h("div", { class: "meta" }, "No upcoming visit")
  )) : [h("div", { class: "empty-state" }, "No trades yet.")];

  mount(container,
    h("div", { class: "page-header" },
      h("div", {},
        h("h1", {}, "Trades"),
        h("div", { class: "sub" }, "Every subcontractor's next visit, confirmation status and history.")
      ),
      h("button", { class: "btn btn-primary btn-sm", onclick: () => openNewTradeModal(pid, refresh) }, "+ New trade")
    ),
    h("div", { class: "card" }, h("div", { class: "row-list" }, rows))
  );
}

function openNewTradeModal(pid, refresh) {
  const nameInput = h("input", { type: "text" });
  const contactInput = h("input", { type: "text" });
  const phoneInput = h("input", { type: "text" });
  const emailInput = h("input", { type: "email" });
  const err = h("div", { class: "error-text" });

  async function save() {
    if (!nameInput.value.trim()) { err.textContent = "Trade name is required"; return; }
    try {
      await api.createTrade(pid, {
        name: nameInput.value.trim(), contact_name: contactInput.value.trim(),
        contact_phone: phoneInput.value.trim(), contact_email: emailInput.value.trim(),
      });
      toast("Trade added");
      bg.remove();
      refresh();
    } catch (e) { err.textContent = e.message; }
  }

  const bg = h("div", { class: "modal-center-bg", onclick: (e) => { if (e.target === bg) bg.remove(); } },
    h("div", { class: "modal-card" },
      h("div", { style: "font-weight:700;margin-bottom:12px;font-size:15px;" }, "New trade / subcontractor"),
      h("div", { class: "field" }, h("label", {}, "Company name"), nameInput),
      h("div", { class: "field" }, h("label", {}, "Contact name"), contactInput),
      h("div", { class: "two-col-form" },
        h("div", { class: "field" }, h("label", {}, "Phone"), phoneInput),
        h("div", { class: "field" }, h("label", {}, "Email"), emailInput),
      ),
      err,
      h("div", { class: "form-actions" },
        h("button", { class: "btn btn-secondary btn-sm", onclick: () => bg.remove() }, "Cancel"),
        h("button", { class: "btn btn-primary btn-sm", onclick: save }, "Add trade")
      )
    )
  );
  document.body.appendChild(bg);
}
