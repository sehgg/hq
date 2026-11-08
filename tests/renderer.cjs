// Renderer logic runs against small DOM doubles; this is not a visual layout test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function renderer(hq = { read: () => new Promise(() => {}) }) {
  class Element {
    constructor() { this.value = ''; this.innerHTML = ''; this.hidden = false; this.disabled = false; this.open = false; this.dataset = {}; this.listeners = {}; this.children = []; this.classList = { toggle() {} }; }
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
    dispatch(type, event = {}) { for (const listener of this.listeners[type] ?? []) listener(event); }
    async dispatchAsync(type, event = {}) { for (const listener of this.listeners[type] ?? []) await listener(event); }
    replaceChildren(...children) { this.children = children; this.value = children[0]?.value ?? ''; }
    setAttribute() {} focus() {} showModal() { this.open = true; } close() { this.open = false; }
    querySelector() { return null; }
    closest() { return this; }
  }
  const nodes = new Map();
  const handlers = {};
  const document = { querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); }, addEventListener(type, handler) { (handlers[type] ??= []).push(handler); } };
  const click = action => { const target = new Element(); target.dataset.action = action; for (const handler of handlers.click ?? []) handler({ target }); };
  class Option { constructor(text, value) { this.text = text; this.value = value; } }
  const context = { document, Option, Element, HTMLInputElement: Element, HTMLFormElement: Element, window: { hq, clearTimeout() {}, setTimeout() { return 0; } }, console };
  vm.createContext(context);
  vm.runInContext(readFileSync('dist/renderer.js', 'utf8') + `\nglobalThis.testApi = { taskRow, taskPanel, orderTaskTree, openEditor, render, showView, setTab: value => { activeTab = value; }, selectTask: id => { selectedTaskId = id; renderDetails(); }, updatePredecessorTasks, setWorkspace: value => { workspace = value; }, selected: () => [...selectedPredecessors] };`, context);
  const change = async target => { for (const handler of handlers.change ?? []) await handler({target}); };
  return { api: context.testApi, node: selector => document.querySelector(selector), click, change };
}
const task = (id, title, projectId, overrides = {}) => ({ id, title, projectId, priority:'normal', description:'', kind:'task', targetVersion:null, criteria:[], dueDate:null, status:'planned', completed:false, predecessorIds:[], successorIds:[], ...overrides });

test('task rows expose every status and mark cross-project dependencies without changing the title', () => {
  const { api } = renderer();
  for (const [status, label] of [['planned','Geplant'], ['in_progress','In Arbeit'], ['paused','Pausiert'], ['done','Erledigt']]) {
    const row = api.taskRow(task(2, 'Nachfolger', 2, {status, predecessorIds:[1]}));
    assert.match(row, new RegExp(`task-status">${label}<`));
    assert.match(row, /has-predecessor/); assert.match(row, /↳/); assert.match(row, /Nachfolger/);
  }
  assert.doesNotMatch(api.taskRow(task(3, 'Ohne Vorgänger', null)), /dependency-marker/);
});

test('predecessor selection offers other projects and inbox, excludes current and selected tasks, and retains selection', () => {
  const { api, node } = renderer();
  api.setWorkspace({ projects:[{id:1,title:'Projekt A'}, {id:2,title:'Projekt B'}], tasks:[task(1,'Selbst',1), task(2,'Aus B',2), task(3,'Loser Vorgänger',null), task(4,'Schon gewählt',2)], subtasks:[] });
  api.openEditor({kind:'task', id:1});
  node('#add-predecessor').dispatch('click');
  assert.equal(node('#predecessor-dialog').open, true);
  assert.deepEqual(node('#predecessor-project').children.map(option => option.text), ['Projekt auswählen','Posteingang','Projekt A','Projekt B']);
  node('#predecessor-project').value = '2'; node('#predecessor-project').dispatch('change');
  assert.deepEqual(node('#predecessor-task').children.map(option => option.text), ['Aufgabe auswählen','Aus B','Schon gewählt']);
  node('#predecessor-task').value = '2'; node('#predecessor-task').dispatch('change');
  assert.equal(node('#confirm-predecessor').disabled, false);
  node('#predecessor-form').dispatch('submit', { preventDefault() {} });
  assert.deepEqual(Array.from(api.selected()), [2]);
  assert.match(node('#entry-predecessors').innerHTML, /Aus B/);
  node('#add-predecessor').dispatch('click'); node('#predecessor-project').value = 'inbox'; node('#predecessor-project').dispatch('change');
  assert.deepEqual(node('#predecessor-task').children.map(option => option.text), ['Aufgabe auswählen','Loser Vorgänger']);
  node('#predecessor-project').value = '1'; node('#predecessor-project').dispatch('change');
  assert.equal(node('#predecessor-task').disabled, true);
  assert.equal(node('#predecessor-empty').hidden, false);
  node('#predecessor-project').value = '2'; node('#predecessor-project').dispatch('change');
  assert.deepEqual(node('#predecessor-task').children.map(option => option.text), ['Aufgabe auswählen','Schon gewählt']);
});

test('depth-first task overview keeps complete branches together and sorts only siblings by due date', () => {
  const { api } = renderer();
  const tasks = [
    task(5,'E',1,{dueDate:'2026-03-01',predecessorIds:[1]}),
    task(3,'C',1,{dueDate:'2026-12-01',predecessorIds:[2]}),
    task(2,'B',1,{dueDate:'2026-01-01',predecessorIds:[1]}),
    task(1,'A',1,{dueDate:'2026-11-01'}),
    task(6,'D',1,{dueDate:null}),
  ];
  api.setWorkspace({ projects:[{id:1,title:'P'}], tasks, subtasks:[] });
  const result = Array.from(api.orderTaskTree(tasks), item => [item.task.title, item.depth]);
  assert.deepEqual(result, [['A',0], ['B',1], ['C',2], ['E',1], ['D',0]]);
  const html = api.taskPanel({id:1,title:'P'});
  assert.deepEqual(Array.from(html.matchAll(/data-action="show-task" data-id="(\d+)"/g), m => Number(m[1])), [1,2,3,5,6]);
  const cRow = html.match(/<li class="task-row"[^>]*>[\s\S]*?<\/li>/g).find(row => row.includes('data-action="show-task" data-id="3"'));
  assert.equal((cRow.match(/class="task-indent"/g) ?? []).length, 2);
});

test('multi-parent tasks occur once and hidden-project predecessors remain marked and visible', () => {
  const { api } = renderer();
  const tasks = [task(1,'A',1,{dueDate:'2026-01-01'}), task(2,'B',1,{dueDate:'2026-02-01'}), task(3,'C',1,{predecessorIds:[2,1]}), task(4,'Extern',1,{predecessorIds:[99]})];
  const result = Array.from(api.orderTaskTree(tasks), item => [item.task.title, item.depth]);
  assert.deepEqual(result, [['A',0],['C',1],['B',0],['Extern',0]]);
  assert.match(api.taskRow(tasks[3]), /dependency-marker/);
  assert.equal(result.filter(item => item[0] === 'C').length, 1);
});

test('a direct link to an ancestor does not flatten a longer dependency chain', () => {
  const { api } = renderer();
  const tasks = [task(1, 'A', 1, {dueDate:'2026-01-01'}), task(2, 'B', 1, {dueDate:'2026-02-01', predecessorIds:[1]}), task(3, 'C', 1, {dueDate:'2026-03-01', predecessorIds:[1,2]})];
  assert.deepEqual(Array.from(api.orderTaskTree(tasks), item => [item.task.title, item.depth]), [['A',0],['B',1],['C',2]]);
});

test('project and inbox overviews include complete cross-project chains with clear labels and local counts', () => {
  const { api } = renderer();
  const tasks = [task(1,'A',1,{dueDate:'2026-03-01'}),task(2,'B',2,{dueDate:'2026-01-01',predecessorIds:[1]}),task(3,'C',null,{dueDate:'2026-02-01',predecessorIds:[2]}),task(4,'Andere',2)];
  api.setWorkspace({projects:[{id:1,title:'Projekt A'},{id:2,title:'Projekt B'}],tasks,subtasks:[]});
  for (const project of [{id:1,title:'Projekt A'}, {id:2,title:'Projekt B'}, undefined]) {
    const html = api.taskPanel(project);
    const ids = Array.from(html.matchAll(/data-action="show-task" data-id="(\d+)"/g), m => Number(m[1]));
    if (project?.id === 2) assert.deepEqual(ids, [1,2,3,4]);
    else assert.deepEqual(ids, [1,2,3]);
    assert.match(html, /Projekt A|Projekt B/);
    assert.match(html, /verknüpft/);
    assert.match(html, /<dt>Offen<\/dt><dd class="accent-secondary">[12]<\/dd>/);
    assert.doesNotMatch(html, /<dt>Erledigt<\/dt><dd class="accent-primary">-/);
  }
});

test('software projects separate tasks and features and normal projects have one overview', () => {
  const { api, node, click } = renderer();
  const software = {id:1,title:'Software',kind:'software'};
  const normal = {id:2,title:'Normal',kind:'normal'};
  api.setWorkspace({projects:[software,normal],tasks:[task(1,'Aufgabe',1), task(2,'Feature',1,{kind:'feature',description:'Funktion'}), task(3,'Normal-Aufgabe',2)],subtasks:[]});
  api.showView(1);
  let html = node('#content').innerHTML;
  assert.match(html, /data-action="tab-task"/); assert.match(html, /data-action="tab-feature"/);
  assert.match(html, /Aufgabe<\/span>/); assert.doesNotMatch(html, />Feature<\/span>/);
  click('tab-feature'); html = node('#content').innerHTML;
  assert.match(html, />Feature<\/span>/); assert.doesNotMatch(html, />Aufgabe<\/span>/);
  click('new-task');
  assert.equal(node('#editor-label').textContent, 'Feature');
  assert.deepEqual(node('#entry-project').children.map(option => option.text), ['Software']);
  api.openEditor({kind:'task',id:2});
  assert.equal(node('#entry-description').value, 'Funktion');
  assert.equal(node('#editor-title').textContent, 'Feature bearbeiten');
  api.showView(2); html = node('#content').innerHTML;
  assert.doesNotMatch(html, /data-action="tab-feature"/); assert.match(html, /Normal-Aufgabe/);
  api.openEditor({kind:'project',id:null});
  assert.equal(node('#entry-project-kind').value, 'normal');
  assert.equal(node('#project-kind-field').hidden, false);
});

test('editor creates a software project, a task and a feature and reloads edited data', async t => {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  const { PlannerDatabase } = require('../dist/database');
  const dir = mkdtempSync(join(tmpdir(),'hq-renderer-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const path = join(dir,'hq.sqlite');
  let db = new PlannerDatabase(path);
  const hq = {read:() => new Promise(() => {}), saveProject: async (id,fields) => {db.saveProject(id,fields); return db.read();}, saveTask: async (id,fields) => {db.saveTask(id,fields); return db.read();}};
  const { api, node } = renderer(hq);
  api.setWorkspace(db.read());
  const submit = () => node('#editor-form').dispatchAsync('submit', {preventDefault() {}});
  api.openEditor({kind:'project',id:null});
  node('#entry-title').value='Software'; node('#entry-priority').value='normal'; node('#entry-project-kind').value='software';
  await submit();
  const project = db.read().projects[0]; assert.equal(project.kind,'software');
  api.openEditor({kind:'task',id:null});
  node('#entry-title').value='Erste Aufgabe'; node('#entry-priority').value='normal'; node('#entry-status').value='planned';
  await submit();
  api.setTab('feature'); api.render();
  api.openEditor({kind:'task',id:null});
  node('#entry-title').value='Neue Funktion'; node('#entry-description').value='Das soll die App können'; node('#entry-priority').value='normal'; node('#entry-status').value='planned';
  await submit();
  let feature=db.read().tasks.find(item=>item.kind==='feature'); assert.equal(feature.description,'Das soll die App können');
  api.openEditor({kind:'task',id:feature.id});
  node('#entry-description').value='Genauer beschrieben';
  await submit();
  db.close(); db=new PlannerDatabase(path);
  const reloaded=db.read();
  assert.equal(reloaded.projects[0].kind,'software');
  assert.equal(reloaded.tasks.find(item=>item.kind==='task').title,'Erste Aufgabe');
  feature=reloaded.tasks.find(item=>item.kind==='feature'); assert.equal(feature.description,'Genauer beschrieben');
  api.setWorkspace(reloaded); api.showView(project.id);
  assert.match(node('#content').innerHTML,/Erste Aufgabe/); assert.doesNotMatch(node('#content').innerHTML,/Neue Funktion/);
  api.setTab('feature'); api.render(); assert.match(node('#content').innerHTML,/Neue Funktion/); assert.doesNotMatch(node('#content').innerHTML,/Erste Aufgabe/);
  db.close();
});

test('feature editor and detail checklist save criteria and target version through SQLite', async t => {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { join } = require('node:path'); const { tmpdir } = require('node:os');
  const { PlannerDatabase } = require('../dist/database');
  const dir = mkdtempSync(join(tmpdir(),'hq-criteria-')); t.after(() => rmSync(dir,{recursive:true,force:true}));
  const path = join(dir,'hq.sqlite'); let db = new PlannerDatabase(path);
  db.saveProject(null,{title:'Software',kind:'software',description:'',priority:'normal'});
  const hq = {read:() => new Promise(() => {}), saveTask:async (id,fields) => {db.saveTask(id,fields); return db.read();}, completeCriterion:async (id,checked) => {db.completeCriterion(id,checked); return db.read();}};
  const {api,node,change} = renderer(hq); api.setWorkspace(db.read()); api.showView(db.read().projects[0].id); api.setTab('feature');
  api.openEditor({kind:'task',id:null}); node('#entry-title').value='CSV exportieren'; node('#entry-priority').value='normal'; node('#entry-status').value='planned'; node('#entry-target-version').value='v0.4.0';
  node('#add-criterion').dispatch('click');
  const input = node('#criterion-input'); input.dataset.criterionText='0'; input.value='CSV enthält alle Titel'; node('#entry-criteria').dispatch('input',{target:input});
  node('#add-criterion').dispatch('click'); input.dataset.criterionText='1'; input.value='CSV enthält den Status'; node('#entry-criteria').dispatch('input',{target:input});
  const check = node('#criterion-check'); check.dataset.criterionCheck='1'; check.checked=true; node('#entry-criteria').dispatch('change',{target:check});
  await node('#editor-form').dispatchAsync('submit',{preventDefault(){}});
  db.close(); db = new PlannerDatabase(path);
  let saved = db.read().tasks[0]; assert.equal(saved.targetVersion,'v0.4.0'); assert.deepEqual(saved.criteria.map(c=>c.completed),[false,true]);
  api.setWorkspace(db.read()); api.openEditor({kind:'task',id:saved.id});
  input.dataset.criterionText='0'; input.value='CSV enthält alle Titel und Termine'; node('#entry-criteria').dispatch('input',{target:input});
  const remove = node('#criterion-remove'); remove.dataset.removeCriterion='1'; node('#entry-criteria').dispatch('click',{target:remove});
  node('#add-criterion').dispatch('click'); input.dataset.criterionText='1'; input.value='CSV lässt sich öffnen'; node('#entry-criteria').dispatch('input',{target:input});
  await node('#editor-form').dispatchAsync('submit',{preventDefault(){}});
  saved=db.read().tasks[0]; assert.deepEqual(saved.criteria.map(c=>c.text), ['CSV enthält alle Titel und Termine','CSV lässt sich öffnen']);
  api.setWorkspace(db.read()); api.selectTask(saved.id);
  const html = node('#details').innerHTML;
  assert.match(html,/v0\.4\.0/); assert.match(html,/CSV enthält alle Titel und Termine/); assert.match(html,/CSV lässt sich öffnen/);
  assert.doesNotMatch(html,/CSV enthält den Status/);
  const detailCheck = node('#detail-check'); detailCheck.dataset.criterion=String(saved.criteria[0].id); detailCheck.checked=true; await change(detailCheck);
  db.close(); db = new PlannerDatabase(path);
  assert.deepEqual(db.read().tasks[0].criteria.map(c => c.completed), [true,false]);
  db.close();
});
