const BASE = "/api";

async function request(path, options = {}) {
  const opts = {
    method: options.method || "GET",
    credentials: "include",
    headers: {},
    ...options,
  };
  if (options.body && !(options.body instanceof FormData)) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(options.body);
  } else if (options.body instanceof FormData) {
    opts.body = options.body;
  }
  let res;
  try {
    res = await fetch(BASE + path, opts);
  } catch (e) {
    throw new Error("Network error - is the server running?");
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = text; }
  }
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  del: (path) => request(path, { method: "DELETE" }),

  // auth
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
  register: (email, password, name) => request("/auth/register", { method: "POST", body: { email, password, name } }),
  logout: () => request("/auth/logout", { method: "POST" }),
  me: () => request("/auth/me"),

  // projects
  projects: () => request("/projects"),
  createProject: (data) => request("/projects", { method: "POST", body: data }),
  project: (id) => request(`/projects/${id}`),

  // drawings
  drawings: (pid) => request(`/projects/${pid}/drawings`),
  uploadDrawing: (pid, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/projects/${pid}/drawings`, { method: "POST", body: fd });
  },
  sheet: (pid, sid) => request(`/projects/${pid}/sheets/${sid}`),
  updateSheet: (pid, sid, data) => request(`/projects/${pid}/sheets/${sid}`, { method: "PUT", body: data }),

  // zones
  zones: (pid, sid) => request(`/projects/${pid}/sheets/${sid}/zones`),
  createZone: (pid, sid, data) => request(`/projects/${pid}/sheets/${sid}/zones`, { method: "POST", body: data }),
  updateZone: (pid, zid, data) => request(`/projects/${pid}/zones/${zid}`, { method: "PUT", body: data }),
  deleteZone: (pid, zid) => request(`/projects/${pid}/zones/${zid}`, { method: "DELETE" }),

  // trades
  trades: (pid) => request(`/projects/${pid}/trades`),
  createTrade: (pid, data) => request(`/projects/${pid}/trades`, { method: "POST", body: data }),
  trade: (pid, tid) => request(`/projects/${pid}/trades/${tid}`),
  updateTrade: (pid, tid, data) => request(`/projects/${pid}/trades/${tid}`, { method: "PUT", body: data }),
  createAttendance: (pid, tid, data) => request(`/projects/${pid}/trades/${tid}/attendances`, { method: "POST", body: data }),
  updateAttendance: (pid, aid, data) => request(`/projects/${pid}/attendances/${aid}`, { method: "PUT", body: data }),

  // activities
  activities: (pid) => request(`/projects/${pid}/activities`),
  activity: (pid, aid) => request(`/projects/${pid}/activities/${aid}`),
  createActivity: (pid, data) => request(`/projects/${pid}/activities`, { method: "POST", body: data }),
  updateActivity: (pid, aid, data) => request(`/projects/${pid}/activities/${aid}`, { method: "PUT", body: data }),
  linkZone: (pid, aid, zoneId) => request(`/projects/${pid}/activities/${aid}/zones`, { method: "POST", body: { zone_id: zoneId } }),
  unlinkZone: (pid, aid, zid) => request(`/projects/${pid}/activities/${aid}/zones/${zid}`, { method: "DELETE" }),

  importProgramme: (pid, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request(`/projects/${pid}/programme/import`, { method: "POST", body: fd });
  },

  // ai
  suggestions: (pid, status = "pending") => request(`/projects/${pid}/ai-suggestions?status=${status}`),
  refreshSuggestions: (pid) => request(`/projects/${pid}/ai-suggestions/refresh`, { method: "POST" }),
  acceptSuggestion: (pid, sid) => request(`/projects/${pid}/ai-suggestions/${sid}/accept`, { method: "POST" }),
  dismissSuggestion: (pid, sid) => request(`/projects/${pid}/ai-suggestions/${sid}/dismiss`, { method: "POST" }),

  // photos
  uploadPhoto: (pid, file, { activityId, zoneId, caption } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    if (activityId) fd.append("activity_id", activityId);
    if (zoneId) fd.append("zone_id", zoneId);
    if (caption) fd.append("caption", caption);
    return request(`/projects/${pid}/photos`, { method: "POST", body: fd });
  },

  // diary
  diary: (pid, limit = 100) => request(`/projects/${pid}/diary?limit=${limit}`),
  createDiaryEntry: (pid, data) => request(`/projects/${pid}/diary`, { method: "POST", body: data }),

  // reports
  summary: (pid) => request(`/projects/${pid}/reports/summary`),
  lookahead: (pid, range) => request(`/projects/${pid}/reports/lookahead?range=${range}`),
  daily: (pid, date) => request(`/projects/${pid}/reports/daily?date=${date}`),
};

export function drawingFileUrl(filename) {
  return `${BASE}/projects/drawing-files/${filename}`;
}
export function photoFileUrl(filename) {
  return `${BASE}/projects/photo-files/${filename}`;
}
