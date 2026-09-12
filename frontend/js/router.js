const routes = [];

export function route(pattern, handler) {
  // pattern like "/p/:id/plans/:sheetId"
  const paramNames = [];
  const regexStr = "^" + pattern.replace(/:[^/]+/g, (m) => {
    paramNames.push(m.slice(1));
    return "([^/]+)";
  }) + "$";
  routes.push({ regex: new RegExp(regexStr), paramNames, handler });
}

export function currentHash() {
  return location.hash.slice(1) || "/";
}

export function navigate(path) {
  location.hash = path;
}

export function startRouter() {
  window.addEventListener("hashchange", dispatch);
  dispatch();
}

function dispatch() {
  const path = currentHash().split("?")[0];
  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      const params = {};
      r.paramNames.forEach((name, i) => { params[name] = m[i + 1]; });
      r.handler(params);
      return;
    }
  }
  // no match
  const fallback = routes.find((r) => r._fallback);
  if (fallback) fallback.handler({});
}

export function markFallback(pattern) {
  const r = routes.find((r) => r.regex.source === ("^" + pattern.replace(/:[^/]+/g, "([^/]+)") + "$"));
  if (r) r._fallback = true;
}
