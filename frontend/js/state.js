export const state = {
  user: null,
  projects: [],
  currentProjectId: null,
};

export function currentProject() {
  return state.projects.find((p) => p.id === state.currentProjectId) || null;
}
