import { h, mount, toast } from "../dom.js";
import { api } from "../api.js";
import { state } from "../state.js";

export function renderProjectPicker(container, { onOpen }) {
  const list = h("div", { class: "row-list" },
    state.projects.length
      ? state.projects.map((p) => h("div", { class: "row-item", onclick: () => onOpen(p.id) },
          h("div", {},
            h("div", { class: "title" }, p.name),
            h("div", { class: "meta" }, p.address || "No address set")
          ),
          h("div", { class: "spacer" }),
          h("span", { class: "btn btn-ghost btn-sm" }, "Open →")
        ))
      : h("div", { class: "empty-state" }, "No projects yet — create your first one below.")
  );

  const nameInput = h("input", { type: "text", placeholder: "e.g. Riverside Townhouses" });
  const addrInput = h("input", { type: "text", placeholder: "Site address (optional)" });
  const err = h("div", { class: "error-text" });

  async function createProject(e) {
    e.preventDefault();
    err.textContent = "";
    if (!nameInput.value.trim()) { err.textContent = "Project name is required"; return; }
    try {
      const p = await api.createProject({ name: nameInput.value.trim(), address: addrInput.value.trim() });
      state.projects.push(p);
      toast("Project created");
      onOpen(p.id);
    } catch (e2) {
      err.textContent = e2.message;
    }
  }

  mount(container,
    h("div", { class: "page-header" },
      h("h1", {}, "Your projects"),
    ),
    h("div", { class: "grid-2" },
      h("div", { class: "card" }, h("h2", {}, "Projects"), list),
      h("div", { class: "card" },
        h("h2", {}, "New project"),
        h("form", { onsubmit: createProject },
          h("div", { class: "field" }, h("label", {}, "Project name"), nameInput),
          h("div", { class: "field" }, h("label", {}, "Address"), addrInput),
          err,
          h("button", { class: "btn btn-primary", type: "submit" }, "Create project")
        )
      )
    )
  );
}
