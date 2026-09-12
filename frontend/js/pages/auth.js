import { h } from "../dom.js";
import { api } from "../api.js";

export function renderAuth({ mode, onSuccess }) {
  const isRegister = mode === "register";
  const errorBox = h("div", { class: "error-text" });
  const emailInput = h("input", { type: "email", required: true, autocomplete: "email" });
  const passInput = h("input", { type: "password", required: true, autocomplete: isRegister ? "new-password" : "current-password" });
  const nameInput = h("input", { type: "text", autocomplete: "name" });

  async function submit(e) {
    e.preventDefault();
    errorBox.textContent = "";
    const email = emailInput.value.trim();
    const password = passInput.value;
    try {
      const user = isRegister
        ? await api.register(email, password, nameInput.value.trim())
        : await api.login(email, password);
      onSuccess(user);
    } catch (err) {
      errorBox.textContent = err.message;
    }
  }

  const form = h("form", { onsubmit: submit },
    isRegister ? h("div", { class: "field" }, h("label", {}, "Name"), nameInput) : null,
    h("div", { class: "field" }, h("label", {}, "Email"), emailInput),
    h("div", { class: "field" }, h("label", {}, "Password"), passInput),
    errorBox,
    h("button", { class: "btn btn-primary btn-block", type: "submit" }, isRegister ? "Create account" : "Log in"),
    h("div", { style: "text-align:center;margin-top:14px;font-size:13px;color:var(--ink-soft)" },
      isRegister ? "Already have an account? " : "New here? ",
      h("a", { href: isRegister ? "#/login" : "#/register" }, isRegister ? "Log in" : "Create an account")
    )
  );

  if (!isRegister) {
    form.insertBefore(
      h("div", { style: "background:var(--blue-light);color:#2559c9;font-size:12.3px;padding:9px 11px;border-radius:8px;margin-bottom:14px;" },
        h("strong", {}, "Demo account: "), "demo@sitemanageros.app / demo1234"
      ),
      form.firstChild
    );
  }

  return h("div", { class: "auth-wrap" },
    h("div", { class: "auth-card" },
      h("div", { class: "auth-logo" }, "SITE MANAGER OS"),
      h("div", { class: "auth-sub" }, "The live visual interface for your build."),
      form
    )
  );
}
