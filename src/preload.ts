import { contextBridge, ipcRenderer } from 'electron';
import type { HqApi } from './shared';

const api: HqApi = {
  read: () => ipcRenderer.invoke('workspace:read'),
  createRelease: (projectId, version, dueDate, revision) => ipcRenderer.invoke('release:create', projectId, version, dueDate, revision),
  renameRelease: (id, version, dueDate, status, revision) => ipcRenderer.invoke('release:rename', id, version, dueDate, status, revision),
  deleteRelease: (id, revision) => ipcRenderer.invoke('release:delete', id, revision),
  publishRelease: (id, revision) => ipcRenderer.invoke('release:publish', id, revision),
  saveProject: (id, fields, revision) => ipcRenderer.invoke('project:save', id, fields, revision),
  saveTask: (id, fields, revision) => ipcRenderer.invoke('task:save', id, fields, revision),
  assignFeature: (taskId, featureId, revision) => ipcRenderer.invoke('task:assign-feature', taskId, featureId, revision),
  deleteTask: (id, revision) => ipcRenderer.invoke('task:delete', id, revision),
  completeTask: (id, completed, revision) => ipcRenderer.invoke('task:complete', id, completed, revision),
  addSubtask: (id, title, revision) => ipcRenderer.invoke('subtask:add', id, title, revision),
  completeSubtask: (id, completed, revision) => ipcRenderer.invoke('subtask:complete', id, completed, revision),
  completeCriterion: (id, completed, revision) => ipcRenderer.invoke('criterion:complete', id, completed, revision),
};

contextBridge.exposeInMainWorld('hq', api);
