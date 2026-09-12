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
  uploadDrawing: (pid, file, discipline) => {
    const fd = new FormData();
    fd.append("file", file);
    if (discipline) fd.append("discipline", discipline);
    return request(`/projects/${pid}/drawings`, { method: "POST", body: fd });
  },
  // Same endpoint as uploadDrawing, but over XMLHttpRequest so we can report
  // real upload-progress percentage (fetch has no cross-browser-reliable
  // way to do this for the request body). onProgress(pct) fires as bytes
  // go out; the server responds quickly once the PDF is indexed (page
  // images render afterwards in the background), so pct reaching 100 just
  // means "waiting on the server to index it", not that everything is done.
  uploadDrawingWithProgress: (pid, file, discipline, onProgress) => {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", file);
      if (discipline) fd.append("discipline", discipline);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/projects/${pid}/drawings`);
      xhr.withCredentials = true;
      xhr.timeout = 5 * 60 * 1000; // generous - the request itself should be fast, but large files take a while just to transfer over a phone connection
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = () => {
        let data = null;
        try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) { /* non-JSON error page, e.g. a 413 */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error((data && data.error) || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Network error during upload — check the connection and try again."));
      xhr.ontimeout = () => reject(new Error("Upload timed out — the file may be too large for the current connection."));
      xhr.send(fd);
    });
  },
  updateDrawingSet: (pid, dsid, data) => request(`/projects/${pid}/drawing-sets/${dsid}`, { method: "PUT", body: data }),
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
  diaryDay: (pid, date) => request(`/projects/${pid}/diary/day/${date}`),
  updateDiaryDay: (pid, date, data) => request(`/projects/${pid}/diary/day/${date}`, { method: "PUT", body: data }),

  // reports
  summary: (pid) => request(`/projects/${pid}/reports/summary`),
  lookahead: (pid, range) => request(`/projects/${pid}/reports/lookahead?range=${range}`),
  daily: (pid, date) => request(`/projects/${pid}/reports/daily?date=${date}`),
  weekly: (pid, end) => request(`/projects/${pid}/reports/weekly?end=${end}`),
};

export function dailyReportPdfUrl(pid, date) {
  return `${BASE}/projects/${pid}/reports/daily/pdf?date=${date}`;
}

export function drawingFileUrl(filename) {
  return `${BASE}/projects/drawing-files/${filename}`;
}
export function photoFileUrl(filename) {
  return `${BASE}/projects/photo-files/${filename}`;
}
