import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { PlannerDatabase } from './database';
import type { ProjectFields, TaskFields } from './shared';

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
  ipcMain.handle('project:save', (_event, id: number | null, fields: ProjectFields) => {
    store.saveProject(id, fields);
    return store.read();
  });
  ipcMain.handle('task:save', (_event, id: number | null, fields: TaskFields) => {
    store.saveTask(id, fields);
    return store.read();
  });
  ipcMain.handle('task:complete', (_event, id: number, completed: boolean) => {
    store.completeTask(id, completed);
    return store.read();
  });
  ipcMain.handle('subtask:add', (_event, taskId: number, title: string) => { store.addSubtask(taskId, title); return store.read(); });
  ipcMain.handle('subtask:complete', (_event, id: number, completed: boolean) => { store.completeSubtask(id, completed); return store.read(); });
  ipcMain.handle('criterion:complete', (_event, id: number, completed: boolean) => { store.completeCriterion(id, completed); return store.read(); });
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
