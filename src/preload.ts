import { contextBridge, ipcRenderer } from 'electron';
import type { HqApi } from './shared';

const api: HqApi = {
  read: () => ipcRenderer.invoke('workspace:read'),
  createRelease: (projectId, version, dueDate, revision, notes) => ipcRenderer.invoke('release:create', projectId, version, dueDate, revision, notes),
  renameRelease: (id, version, dueDate, status, revision, notes) => ipcRenderer.invoke('release:rename', id, version, dueDate, status, revision, notes),
  deleteRelease: (id, revision) => ipcRenderer.invoke('release:delete', id, revision),
  publishRelease: (id, revision) => ipcRenderer.invoke('release:publish', id, revision),
  saveProject: (id, fields, revision, notes) => ipcRenderer.invoke('project:save', id, fields, revision, notes),
  saveTask: (id, fields, revision, notes) => ipcRenderer.invoke('task:save', id, fields, revision, notes),
  deleteTask: (id, revision) => ipcRenderer.invoke('task:delete', id, revision),
  completeTask: (id, completed, revision) => ipcRenderer.invoke('task:complete', id, completed, revision),
  completeSubtask: (id, completed, revision) => ipcRenderer.invoke('subtask:complete', id, completed, revision),
  completeCriterion: (id, completed, revision) => ipcRenderer.invoke('criterion:complete', id, completed, revision),
};

contextBridge.exposeInMainWorld('hq', api);
