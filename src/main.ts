import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { PlannerDatabase } from './database';
import type { ProjectFields, TaskFields, ReleaseStatus, HistoryKind, NoteFields } from './shared';

const indexPath = join(__dirname, '../ui/index.html');
let window: BrowserWindow | null = null;

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const workArea = isMac ? screen.getPrimaryDisplay().workArea : null;
  const nextWindow = new BrowserWindow({
    ...(workArea ?? { width: 1160, height: 780 }),
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
  function saveWithNotes(kind: HistoryKind, revision: number, notes: NoteFields[] | undefined, save: () => number) {
    return store.mutateWorkspace(revision, () => {
      const id = save();
      if (notes !== undefined) store.saveHistoryNotes(kind, id, notes);
    });
  }

  ipcMain.handle('workspace:read', () => store.read());
  ipcMain.handle('release:create', (_event, projectId: number, version: string, dueDate: string | null, revision: number, notes?: NoteFields[]) => saveWithNotes('release', revision, notes, () => store.createRelease(projectId, version, dueDate)));
  ipcMain.handle('release:rename', (_event, id: number, version: string, dueDate: string | null, status: ReleaseStatus, revision: number, notes?: NoteFields[]) => saveWithNotes('release', revision, notes, () => store.renameRelease(id, version, dueDate, status)));
  ipcMain.handle('release:delete', (_event, id: number, revision: number) => store.mutateWorkspace(revision, () => store.deleteRelease(id)));
  ipcMain.handle('release:publish', (_event, id: number, revision: number) => store.mutateWorkspace(revision, () => store.publishRelease(id)));
  ipcMain.handle('project:save', (_event, id: number | null, fields: ProjectFields, revision: number, notes?: NoteFields[]) => saveWithNotes('project', revision, notes, () => store.saveProject(id, fields)));
  ipcMain.handle('task:save', (_event, id: number | null, fields: TaskFields, revision: number, notes?: NoteFields[]) => saveWithNotes('task', revision, notes, () => store.saveTask(id, fields)));
  ipcMain.handle('task:delete', (_event, id: number, revision: number) => store.mutateWorkspace(revision, () => store.deleteTask(id)));
  ipcMain.handle('task:complete', (_event, id: number, completed: boolean, revision: number) => store.mutateWorkspace(revision, () => store.completeTask(id, completed)));
  ipcMain.handle('subtask:complete', (_event, id: number, completed: boolean, revision: number) => store.mutateWorkspace(revision, () => store.completeSubtask(id, completed)));
  ipcMain.handle('criterion:complete', (_event, id: number, completed: boolean, revision: number) => store.mutateWorkspace(revision, () => store.completeCriterion(id, completed)));
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
