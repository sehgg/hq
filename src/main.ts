import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { PlannerDatabase } from './database';
import type { ProjectFields, TaskFields, ReleaseStatus } from './shared';

const indexPath = join(__dirname, '../ui/index.html');
let window: BrowserWindow | null = null;

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const nextWindow = new BrowserWindow({
    width: 1160,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#101322',
    icon: join(__dirname, '../ui/icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window = nextWindow;
  nextWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  nextWindow.webContents.on('will-navigate', event => event.preventDefault());
  nextWindow.on('closed', () => { window = null; });
  void nextWindow.loadFile(indexPath);
}

function setupDatabase(): void {
  const store = new PlannerDatabase(join(app.getPath('userData'), 'hq.sqlite'));
  ipcMain.handle('workspace:read', () => store.read());
  ipcMain.handle('release:create', (_event, projectId: number, version: string, dueDate: string | null, revision: number) => store.mutate(revision, () => { store.createRelease(projectId, version, dueDate); return store.read(); }));
  ipcMain.handle('release:rename', (_event, id: number, version: string, dueDate: string | null, status: ReleaseStatus, revision: number) => store.mutate(revision, () => { store.renameRelease(id, version, dueDate, status); return store.read(); }));
  ipcMain.handle('release:delete', (_event, id: number, revision: number) => store.mutate(revision, () => { store.deleteRelease(id); return store.read(); }));
  ipcMain.handle('release:publish', (_event, id: number, revision: number) => store.mutate(revision, () => { store.publishRelease(id); return store.read(); }));
  ipcMain.handle('project:save', (_event, id: number | null, fields: ProjectFields, revision: number) => store.mutate(revision, () => { store.saveProject(id, fields); return store.read(); }));
  ipcMain.handle('task:save', (_event, id: number | null, fields: TaskFields, revision: number) => store.mutate(revision, () => { store.saveTask(id, fields); return store.read(); }));
  ipcMain.handle('task:assign-feature', (_event, id: number, featureId: number | null, revision: number) => store.mutate(revision, () => { store.assignFeature(id, featureId); return store.read(); }));
  ipcMain.handle('task:delete', (_event, id: number, revision: number) => store.mutate(revision, () => { store.deleteTask(id); return store.read(); }));
  ipcMain.handle('task:complete', (_event, id: number, completed: boolean, revision: number) => store.mutate(revision, () => { store.completeTask(id, completed); return store.read(); }));
  ipcMain.handle('subtask:add', (_event, id: number, value: string, revision: number) => store.mutate(revision, () => { store.addSubtask(id, value); return store.read(); }));
  ipcMain.handle('subtask:complete', (_event, id: number, completed: boolean, revision: number) => store.mutate(revision, () => { store.completeSubtask(id, completed); return store.read(); }));
  ipcMain.handle('criterion:complete', (_event, id: number, completed: boolean, revision: number) => store.mutate(revision, () => { store.completeCriterion(id, completed); return store.read(); }));
  app.once('will-quit', () => store.close());
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window) {
      createWindow();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  void app.whenReady().then(() => {
    setupDatabase();
    if (process.platform === 'darwin') app.dock?.setIcon(join(__dirname, '../ui/icon.png'));
    createWindow();
    app.on('activate', () => {
      if (!window) createWindow();
    });
  }).catch(error => {
    dialog.showErrorBox('HQ konnte nicht starten', String(error));
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
