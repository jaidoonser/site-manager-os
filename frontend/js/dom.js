// Tiny hyperscript-style DOM helper so we can build the UI without a build step.
// h('div', {class:'card', onclick: fn}, 'text', otherNode, [arrayOfNodes])
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  props = props || {};
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "class") {
      el.className = value;
    } else if (key === "html") {
      el.innerHTML = value;
    } else if (key in el && key !== "list") {
      try { el[key] = value; } catch (e) { el.setAttribute(key, value); }
    } else {
      el.setAttribute(key, value);
    }
  }
  const append = (child) => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(append); return; }
    if (typeof child === "string" || typeof child === "number") {
      el.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  };
  children.forEach(append);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function mount(container, ...nodes) {
  clear(container);
  const append = (child) => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(append); return; }
    if (typeof child === "string" || typeof child === "number") {
      container.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      container.appendChild(child);
    }
  };
  nodes.forEach(append);
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const dt = new Date(iso + "T00:00:00");
  if (isNaN(dt)) return iso;
  return dt.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateShort(iso) {
  if (!iso) return "—";
  const dt = new Date(iso + "T00:00:00");
  if (isNaN(dt)) return iso;
  return dt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  const dt = new Date(iso.replace(" ", "T") + "Z");
  if (isNaN(dt)) return iso;
  return dt.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

export function statusBadge(status, label) {
  return h("span", { class: `badge status-${status}` },
    h("span", { class: "dot", style: `background:currentColor` }),
    label
  );
}

export function toast(msg, isError = false) {
  const el = h("div", { class: "toast", style: isError ? "background:#d64545" : "" }, msg);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function attendanceLabel(status) {
  return {
    not_contacted: "Not Contacted",
    tentative: "Tentative",
    confirmed: "Confirmed",
    on_site: "On Site",
    complete: "Complete",
  }[status] || status;
}
