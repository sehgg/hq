import { contextBridge, ipcRenderer } from 'electron';
import type { HqApi } from './shared';

const api: HqApi = {
  read: () => ipcRenderer.invoke('workspace:read'),
  saveProject: (id, fields) => ipcRenderer.invoke('project:save', id, fields),
  saveTask: (id, fields) => ipcRenderer.invoke('task:save', id, fields),
  completeTask: (id, completed) => ipcRenderer.invoke('task:complete', id, completed),
  addSubtask: (id, title) => ipcRenderer.invoke('subtask:add', id, title),
  completeSubtask: (id, completed) => ipcRenderer.invoke('subtask:complete', id, completed),
};

contextBridge.exposeInMainWorld('hq', api);
