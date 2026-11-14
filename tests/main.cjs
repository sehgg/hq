const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const vm = require('node:vm');

function main(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-main-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handlers = {};
  let options;
  class BrowserWindow {
    constructor(value) { options = value; this.webContents = {setWindowOpenHandler() {}, on() {}}; }
    on() {}
    loadFile() {}
  }
  const app = { getPath: () => dir, once() {}, on() {}, requestSingleInstanceLock: () => false, quit() {} };
  const electron = {app, BrowserWindow, ipcMain:{handle: (name, handler) => { handlers[name] = handler; }}, screen:{getPrimaryDisplay: () => ({workArea:{x:10,y:25,width:1440,height:875}})}};
  const context = {exports:{}, require: name => name === 'electron' ? electron : name === './database' ? require('../dist/database') : require(name), __dirname: join(process.cwd(),'dist'), process:{platform:'darwin'}, Set};
  vm.createContext(context);
  vm.runInContext(readFileSync('dist/main.js','utf8') + '\nglobalThis.testApi = {setupDatabase, createWindow};', context);
  context.testApi.setupDatabase();
  return {handlers, createWindow: context.testApi.createWindow, options: () => options};
}

test('macOS window opens in the display work area', t => {
  const app = main(t);
  app.createWindow();
  const {x,y,width,height} = app.options();
  assert.deepEqual({x,y,width,height}, {x:10,y:25,width:1440,height:875});
});

test('default and minimum details widths are twice the navigation widths', () => {
  const css = readFileSync('ui/styles.css', 'utf8');
  assert.match(css, /--sidebar-min:\s*226px/);
  assert.match(css, /\.shell\.with-details\s*\{\s*--details-min:\s*452px/);
  assert.match(css, /@media \(max-width: 900px\)\s*\{\s*\.shell\.with-details\s*\{\s*--sidebar-min:\s*160px;\s*--details-min:\s*320px/);
  assert.match(css, /var\(--sidebar-width,\s*var\(--sidebar-min\)\)/);
  assert.match(css, /var\(--details-width,\s*var\(--details-min\)\)/);
});

test('entity saves persist notes atomically through IPC', t => {
  const {handlers} = main(t);
  const call = (name, ...args) => handlers[name](null, ...args);
  let w = call('workspace:read');
  w = call('project:save', null, {title:'Projekt',priority:'normal',description:'',kind:'software',dueDate:null}, w.revision, [{id:null,text:'Projektmeldung'}]);
  const project = w.projects[0], projectNote = w.history.find(entry => entry.manual);
  w = call('task:save', null, {title:'Aufgabe',priority:'normal',description:'',kind:'task',featureId:null,releaseId:null,criteria:[],projectId:project.id,dueDate:null,status:'planned',predecessorIds:[]}, w.revision, [{id:null,text:'Aufgabenmeldung'}]);
  const task = w.tasks[0], taskNote = w.history.find(entry => entry.entityKind === 'task' && entry.manual);
  w = call('release:create', project.id, 'v1', null, w.revision, [{id:null,text:'Releasemeldung'}]);
  const release = w.releases[0], releaseNote = w.history.find(entry => entry.entityKind === 'release' && entry.manual);
  w = call('release:rename', release.id, 'v2', null, 'planned', w.revision, [{id:releaseNote.id,text:'Aktualisiert'}]);
  assert.equal(w.history.find(entry => entry.id === releaseNote.id).newValue, 'Aktualisiert');
  assert.throws(() => call('task:save', task.id, {...task,title:'Änderung'}, w.revision, []), /nicht gelöscht/);
  assert.equal(call('workspace:read').tasks[0].title, 'Aufgabe');
  w = call('project:save', project.id, {...project}, w.revision, []);
  assert.ok(!w.history.some(entry => entry.id === projectNote.id));
  assert.ok(w.history.some(entry => entry.id === taskNote.id));
});
