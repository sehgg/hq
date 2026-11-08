// Renderer logic runs against small DOM doubles; this is not a visual layout test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function renderer(hq = { read: () => new Promise(() => {}) }) {
  class Element {
    constructor() { this.value = ''; this.innerHTML = ''; this.hidden = false; this.disabled = false; this.open = false; this.dataset = {}; this.listeners = {}; this.children = []; this.attributes = {}; this.width = 226; this.style = { properties:{}, setProperty(name, value) { this.properties[name] = value; } }; this.classList = { toggle() {}, add() {}, remove() {} }; }
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
    dispatch(type, event = {}) { for (const listener of this.listeners[type] ?? []) listener(event); }
    async dispatchAsync(type, event = {}) { for (const listener of this.listeners[type] ?? []) await listener(event); }
    replaceChildren(...children) { this.children = children; this.value = children[0]?.value ?? ''; }
    setAttribute(name, value) { this.attributes[name] = value; } focus() {} showModal() { this.open = true; } close() { this.open = false; }
    getBoundingClientRect() { return {width:this.width}; }
    setPointerCapture(id) { this.capturedPointer=id; } hasPointerCapture(id) { return this.capturedPointer===id; } releasePointerCapture() { this.capturedPointer=null; }
    querySelector() { return null; }
    closest() { return this; }
  }
  const nodes = new Map();
  const handlers = {};
  const document = { body:new Element(), querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); }, addEventListener(type, handler) { (handlers[type] ??= []).push(handler); } };
  const click = (action, id) => { const target = new Element(); target.dataset.action = action; if (id !== undefined) target.dataset.id = String(id); for (const handler of handlers.click ?? []) handler({ target }); };
  class Option { constructor(text, value) { this.text = text; this.value = value; } }
  const context = { document, Option, Element, HTMLInputElement: Element, HTMLSelectElement: Element, HTMLFormElement: Element, getComputedStyle: element => ({getPropertyValue: name => element.style.properties[name] ?? '226px'}), window: { hq, clearTimeout() {}, setTimeout() { return 0; }, addEventListener() {} }, console };
  vm.createContext(context);
  vm.runInContext(readFileSync('dist/renderer.js', 'utf8') + `\nglobalThis.testApi = { taskRow, taskPanel, orderTaskTree, openEditor, openDeleteDialog, openFeatureTaskDialog, render, showView, setTab: value => { activeTab = value; }, selectTask: id => { selectedTaskId = id; renderDetails(); }, updatePredecessorTasks, setWorkspace: value => { workspace = { releases: [], ...value }; }, selected: () => [...selectedPredecessors] };`, context);
  const change = async target => { for (const handler of handlers.change ?? []) await handler({target}); };
  return { api: context.testApi, node: selector => document.querySelector(selector), click, change };
}
const task = (id, title, projectId, overrides = {}) => ({ id, title, projectId, priority:'normal', description:'', kind:'task', featureId:null, releaseId:null, targetVersion:null, criteria:[], dueDate:null, status:'planned', completed:false, predecessorIds:[], successorIds:[], ...overrides });

test('sidebar resize tracks pointer movement, respects the current minimum and supports keyboard input', () => {
  const {node} = renderer(); const handle=node('#sidebar-resize'), shell=node('.shell'), sidebar=node('#sidebar');
  const pointer = (clientX, pointerId=1) => ({button:0, clientX, pointerId, preventDefault(){}});
  handle.dispatch('pointerdown', pointer(226)); assert.equal(handle.capturedPointer,1);
  handle.dispatch('pointermove', pointer(326)); assert.equal(shell.style.properties['--sidebar-width'],'326px');
  handle.dispatch('pointermove', pointer(100)); assert.equal(shell.style.properties['--sidebar-width'],'226px');
  handle.dispatch('pointerup', pointer(100)); assert.equal(handle.capturedPointer,null);
  handle.dispatch('pointermove', pointer(400)); assert.equal(shell.style.properties['--sidebar-width'],'226px');
  shell.style.properties['--sidebar-min']='190px'; sidebar.width=230;
  handle.dispatch('keydown',{key:'ArrowLeft',preventDefault(){}}); assert.equal(shell.style.properties['--sidebar-width'],'220px');
  assert.equal(handle.attributes['aria-valuemin'],'190');
});

test('details divider resizes in the opposite direction and follows the details panel', () => {
  const {api,node} = renderer(); const handle=node('#details-resize'), shell=node('.shell'), details=node('#details'), sidebar=node('#sidebar');
  shell.width=1160; shell.style.properties['--details-min']='320px'; sidebar.width=226; details.width=320;
  api.setWorkspace({projects:[],tasks:[task(1,'Eintrag',null)],subtasks:[]}); api.selectTask(1); assert.equal(handle.hidden,false);
  const pointer=(clientX,pointerId=1)=>({button:0,clientX,pointerId,preventDefault(){}});
  handle.dispatch('pointerdown',pointer(840)); assert.equal(handle.capturedPointer,1);
  handle.dispatch('pointermove',pointer(740)); assert.equal(shell.style.properties['--details-width'],'420px');
  handle.dispatch('pointermove',pointer(940)); assert.equal(shell.style.properties['--details-width'],'320px');
  handle.dispatch('pointerup',pointer(940)); assert.equal(handle.capturedPointer,null);
  details.width=400; handle.dispatch('keydown',{key:'ArrowLeft',preventDefault(){}}); assert.equal(shell.style.properties['--details-width'],'410px');
  handle.dispatch('keydown',{key:'ArrowRight',preventDefault(){}}); assert.equal(shell.style.properties['--details-width'],'390px');
  assert.equal(handle.attributes['aria-valuemin'],'320'); api.selectTask(null); assert.equal(handle.hidden,true);
});

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

test('project deadline editor lists conflicts and saves once their dates are corrected', async t => {
  const { mkdtempSync, rmSync } = require('node:fs');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  const { PlannerDatabase } = require('../dist/database');
  const dir = mkdtempSync(join(tmpdir(), 'hq-deadline-renderer-'));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  const db = new PlannerDatabase(join(dir, 'hq.sqlite'));
  t.after(() => db.close());
  db.saveProject(null, {title:'App', kind:'software', priority:'normal', description:'', dueDate:'2026-12-31'});
  const project = db.read().projects[0].id;
  for (const kind of ['task', 'feature', 'fix']) {
    db.saveTask(null, {title:`Später ${kind}`, kind, projectId:project, priority:'normal', description:'', dueDate:'2026-12-15', status:'planned', predecessorIds:[], criteria:[], featureId:null, releaseId:null});
  }
  const hq = {read:() => new Promise(() => {}), saveProject:async (id, fields) => {db.saveProject(id, fields); return db.read();}};
  const {api, node} = renderer(hq);
  api.setWorkspace(db.read()); api.showView(project); api.openEditor({kind:'project', id:project});
  node('#entry-project-due').value = '2026-11-30'; node('#entry-project-due').dispatch('input');
  const conflicts = node('#project-due-conflicts');
  assert.equal(conflicts.hidden, false);
  for (const text of ['Aufgabe: Später task', 'Feature: Später feature', 'Fix: Später fix', '15.12.2026']) assert.ok(conflicts.innerHTML.includes(text));
  const submit = () => node('#editor-form').dispatchAsync('submit', {preventDefault() {}});
  await submit();
  assert.equal(db.read().projects[0].dueDate, '2026-12-31');
  assert.match(node('#editor-error').textContent, /Fälligkeiten/);
  node('#cancel-editor').dispatch('click');
  for (const item of db.read().tasks) db.saveTask(item.id, {...item, dueDate:'2026-11-30'});
  api.setWorkspace(db.read()); api.openEditor({kind:'project', id:project});
  node('#entry-project-due').value = '2026-11-30'; node('#entry-project-due').dispatch('input');
  assert.equal(conflicts.hidden, true);
  await submit();
  assert.equal(db.read().projects[0].dueDate, '2026-11-30');
  assert.match(node('#content').innerHTML, /Projektfrist: 30\.11\.2026/);
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
  db.createRelease(db.read().projects[0].id,'v0.4.0'); const releaseId=db.read().releases[0].id;
  const hq = {read:() => new Promise(() => {}), saveTask:async (id,fields) => {db.saveTask(id,fields); return db.read();}, completeCriterion:async (id,checked) => {db.completeCriterion(id,checked); return db.read();}};
  const {api,node,change} = renderer(hq); api.setWorkspace(db.read()); api.showView(db.read().projects[0].id); api.setTab('feature');
  api.openEditor({kind:'task',id:null}); node('#entry-title').value='CSV exportieren'; node('#entry-priority').value='normal'; node('#entry-status').value='planned'; node('#entry-target-version').value=String(releaseId);
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

test('delete confirmation cancels safely and deletes a feature only after confirmation', async t => {
  const { mkdtempSync, rmSync } = require('node:fs'); const { join } = require('node:path'); const { tmpdir } = require('node:os');
  const { PlannerDatabase } = require('../dist/database');
  const dir = mkdtempSync(join(tmpdir(),'hq-delete-')); t.after(() => rmSync(dir,{recursive:true,force:true}));
  const db = new PlannerDatabase(join(dir,'hq.sqlite'));
  db.saveProject(null,{title:'Software',kind:'software',description:'',priority:'normal'});
  const project = db.read().projects[0].id;
  db.saveTask(null,{title:'CSV',priority:'normal',description:'',kind:'feature',featureId:null,releaseId:null,criteria:[],projectId:project,dueDate:null,status:'planned',predecessorIds:[]});
  const feature = db.read().tasks[0];
  let deletions=0;
  const hq={read:()=>new Promise(()=>{}),deleteTask:async id=>{deletions++;db.deleteTask(id);return db.read();}};
  const {api,node} = renderer(hq); api.setWorkspace(db.read()); api.showView(project); api.setTab('feature'); api.selectTask(feature.id);
  assert.match(node('#details').innerHTML,/aria-label="Feature löschen"/);
  api.openDeleteDialog(feature.id);
  assert.equal(node('#delete-dialog').open,true); assert.match(node('#delete-description').textContent,/Akzeptanzkriterien/);
  node('#cancel-delete').dispatch('click'); assert.equal(node('#delete-dialog').open,false); assert.equal(deletions,0);
  api.openDeleteDialog(feature.id); await node('#confirm-delete').dispatchAsync('click');
  assert.equal(deletions,1); assert.equal(node('#delete-dialog').open,false); assert.equal(node('#details').hidden,true);
  assert.equal(db.read().tasks.length,0); assert.match(node('#content').innerHTML,/Noch keine Features/);
  db.close();
});

test('feature details create and assign tasks and reflect their independent status after restart', async t => {
  const { mkdtempSync, rmSync }=require('node:fs'); const { join }=require('node:path'); const { tmpdir }=require('node:os');
  const { PlannerDatabase }=require('../dist/database'); const dir=mkdtempSync(join(tmpdir(),'hq-membership-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true})); const path=join(dir,'hq.sqlite'); let db=new PlannerDatabase(path);
  db.saveProject(null,{title:'Software',priority:'normal',description:'',kind:'software'});
  const project=db.read().projects[0].id;
  const base={priority:'normal',description:'',featureId:null,releaseId:null,criteria:[],projectId:project,dueDate:null,status:'planned',predecessorIds:[]};
  db.saveTask(null,{...base,title:'Feature XY',kind:'feature'}); const feature=db.read().tasks.find(x=>x.kind==='feature').id;
  db.saveTask(null,{...base,title:'Vorhanden',kind:'task'}); const existing=db.read().tasks.find(x=>x.title==='Vorhanden').id;
  const hq={read:()=>new Promise(()=>{}),saveTask:async(id,fields)=>{db.saveTask(id,fields);return db.read();},assignFeature:async(id,fid)=>{db.assignFeature(id,fid);return db.read();},completeTask:async(id,done)=>{db.completeTask(id,done);return db.read();}};
  const {api,node,change}=renderer(hq); api.setWorkspace(db.read()); api.showView(project); api.setTab('feature'); api.selectTask(feature);
  assert.match(node('#details').innerHTML,/Zugehörige Aufgaben/); assert.match(node('#details').innerHTML,/data-action="add-feature-task"/);
  api.openFeatureTaskDialog(); assert.equal(node('#feature-task-dialog').open,true);
  assert.deepEqual(node('#existing-feature-task').children.map(option=>option.text),['Aufgabe auswählen','Vorhanden']);
  node('#new-feature-task').dispatch('click'); assert.equal(node('#editor-label').textContent,'Aufgabe');
  assert.equal(node('#entry-task-feature').value,String(feature));
  node('#entry-title').value='Feature XY definieren'; node('#entry-priority').value='normal'; node('#entry-status').value='planned';
  await node('#editor-form').dispatchAsync('submit',{preventDefault(){}});
  let created=db.read().tasks.find(item=>item.title==='Feature XY definieren'); assert.equal(created.featureId,feature);
  assert.match(node('#details').innerHTML,/Feature XY definieren · Geplant/);
  api.openFeatureTaskDialog(); node('#existing-feature-task').value=String(existing); node('#existing-feature-task').dispatch('change');
  await node('#assign-feature-task').dispatchAsync('click'); assert.equal(db.read().tasks.find(x=>x.id===existing).featureId,feature);
  api.showView(project); assert.match(node('#content').innerHTML,/Feature XY definieren/);
  const checkbox=node('#membership-checkbox'); checkbox.dataset.complete=String(created.id); checkbox.checked=true; await change(checkbox);
  api.setTab('feature'); api.selectTask(feature); assert.match(node('#details').innerHTML,/Feature XY definieren · Erledigt/);
  assert.equal(db.read().tasks.find(x=>x.id===feature).status,'planned');
  db.close(); db=new PlannerDatabase(path); api.setWorkspace(db.read()); api.selectTask(feature);
  assert.match(node('#details').innerHTML,/Feature XY definieren · Erledigt/);
  api.selectTask(created.id); assert.match(node('#details').innerHTML,/Zugehöriges Feature/); assert.match(node('#details').innerHTML,/Feature XY/);
  const selector=node('#membership-select'); selector.dataset.featureAssignment=String(created.id); selector.value=''; await change(selector);
  assert.equal(db.read().tasks.find(x=>x.id===created.id).featureId,null);
  db.close();
});

test('task details change feature assignment and editor clears it when project changes', async t => {
  const { mkdtempSync,rmSync }=require('node:fs'); const { join }=require('node:path'); const { tmpdir }=require('node:os'); const {PlannerDatabase}=require('../dist/database');
  const dir=mkdtempSync(join(tmpdir(),'hq-reassign-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); const db=new PlannerDatabase(join(dir,'hq.sqlite'));
  db.saveProject(null,{title:'A',kind:'software',priority:'normal',description:''}); db.saveProject(null,{title:'B',kind:'software',priority:'normal',description:''});
  const a=db.read().projects.find(p=>p.title==='A').id,b=db.read().projects.find(p=>p.title==='B').id;
  const base={priority:'normal',description:'',featureId:null,releaseId:null,criteria:[],projectId:a,dueDate:null,status:'planned',predecessorIds:[]};
  db.saveTask(null,{...base,title:'F1',kind:'feature'}); db.saveTask(null,{...base,title:'F2',kind:'feature'});
  const f1=db.read().tasks.find(x=>x.title==='F1').id, f2=db.read().tasks.find(x=>x.title==='F2').id;
  db.saveTask(null,{...base,title:'Aufgabe',kind:'task',featureId:f1}); const id=db.read().tasks.find(x=>x.title==='Aufgabe').id;
  const hq={read:()=>new Promise(()=>{}),assignFeature:async(task,feature)=>{db.assignFeature(task,feature);return db.read();}};
  const {api,node,change}=renderer(hq); api.setWorkspace(db.read()); api.showView(a); api.selectTask(id);
  assert.match(node('#details').innerHTML,/F1/);
  const select=node('#feature-select'); select.dataset.featureAssignment=String(id); select.value=String(f2); await change(select);
  assert.equal(db.read().tasks.find(x=>x.id===id).featureId,f2); assert.match(node('#details').innerHTML,/F2/);
  api.openEditor({kind:'task',id}); assert.equal(node('#entry-task-feature').value,String(f2));
  node('#entry-project').value=String(b); node('#entry-project').dispatch('change');
  assert.equal(node('#entry-task-feature').value,'');
  assert.deepEqual(node('#entry-task-feature').children.map(option=>option.text),['Kein Feature oder Fix']);
  db.close();
});

test('fixes have their own tab and persist criteria, release and task assignment', async t => {
  const { mkdtempSync,rmSync }=require('node:fs'); const { join }=require('node:path'); const { tmpdir }=require('node:os'); const {PlannerDatabase}=require('../dist/database');
  const dir=mkdtempSync(join(tmpdir(),'hq-fix-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); const path=join(dir,'hq.sqlite'); let db=new PlannerDatabase(path);
  db.saveProject(null,{title:'Software',kind:'software',priority:'normal',description:''}); const project=db.read().projects[0].id;
  const base={priority:'normal',description:'',featureId:null,releaseId:null,criteria:[],projectId:project,dueDate:null,status:'planned',predecessorIds:[]};
  db.createRelease(project,'v0.4.0'); db.createRelease(project,'v0.4.1');
  const releaseId=db.read().releases.find(r=>r.version==='v0.4.0').id, nextReleaseId=db.read().releases.find(r=>r.version==='v0.4.1').id;
  db.saveTask(null,{...base,kind:'feature',title:'Feature'}); db.saveTask(null,{...base,kind:'task',title:'Vorhandene Aufgabe'});
  const hq={read:()=>new Promise(()=>{}),saveTask:async(id,fields)=>{db.saveTask(id,fields);return db.read();},assignFeature:async(id,fid)=>{db.assignFeature(id,fid);return db.read();},completeCriterion:async(id,value)=>{db.completeCriterion(id,value);return db.read();}};
  const {api,node,click,change}=renderer(hq); api.setWorkspace(db.read()); api.showView(project);
  assert.match(node('#content').innerHTML,/data-action="tab-fix"/); assert.match(node('#content').innerHTML,/Vorhandene Aufgabe/);
  click('tab-fix'); assert.match(node('#content').innerHTML,/Noch keine Fixes/); assert.doesNotMatch(node('#content').innerHTML,/Vorhandene Aufgabe/);
  click('new-task'); assert.equal(node('#editor-label').textContent,'Fix'); assert.equal(node('#feature-fields').hidden,false);
  node('#entry-title').value='CSV reparieren'; node('#entry-description').value='Trennzeichen korrigieren'; node('#entry-priority').value='normal'; node('#entry-status').value='planned'; node('#entry-target-version').value=String(releaseId);
  node('#add-criterion').dispatch('click'); const input=node('#fix-criterion'); input.dataset.criterionText='0'; input.value='CSV lässt sich öffnen'; node('#entry-criteria').dispatch('input',{target:input});
  await node('#editor-form').dispatchAsync('submit',{preventDefault(){}});
  let fix=db.read().tasks.find(item=>item.kind==='fix'); assert.equal(fix.targetVersion,'v0.4.0'); assert.match(node('#content').innerHTML,/CSV reparieren/); assert.doesNotMatch(node('#content').innerHTML,/>Feature<\/span>/);
  api.selectTask(fix.id); assert.match(node('#details').innerHTML,/Akzeptanzkriterien/); assert.match(node('#details').innerHTML,/Aufgabe zu Fix hinzufügen/);
  const checkbox=node('#fix-criterion-check'); checkbox.dataset.criterion=String(fix.criteria[0].id); checkbox.checked=true; await change(checkbox);
  api.openFeatureTaskDialog(); const task=db.read().tasks.find(item=>item.title==='Vorhandene Aufgabe'); node('#existing-feature-task').value=String(task.id); node('#existing-feature-task').dispatch('change'); await node('#assign-feature-task').dispatchAsync('click');
  assert.match(node('#details').innerHTML,/Vorhandene Aufgabe · Geplant/);
  api.openFeatureTaskDialog(); node('#new-feature-task').dispatch('click');
  assert.equal(node('#editor-label').textContent,'Aufgabe'); assert.equal(node('#entry-task-feature').value,String(fix.id));
  node('#entry-title').value='Fix testen'; node('#entry-priority').value='normal'; node('#entry-status').value='planned';
  await node('#editor-form').dispatchAsync('submit',{preventDefault(){}});
  assert.equal(db.read().tasks.find(item=>item.title==='Fix testen').featureId,fix.id);
  assert.match(node('#details').innerHTML,/Fix testen · Geplant/);
  db.close(); db=new PlannerDatabase(path); api.setWorkspace(db.read()); api.showView(project); assert.match(node('#content').innerHTML,/Vorhandene Aufgabe/); assert.doesNotMatch(node('#content').innerHTML,/CSV reparieren/);
  api.selectTask(task.id); assert.match(node('#details').innerHTML,/Zugehöriger Fix/); assert.match(node('#details').innerHTML,/CSV reparieren/);
  click('tab-fix'); fix=db.read().tasks.find(item=>item.kind==='fix'); api.selectTask(fix.id);
  assert.match(node('#details').innerHTML,/v0\.4\.0/); assert.match(node('#details').innerHTML,/Vorhandene Aufgabe/); assert.equal(fix.criteria[0].completed,true);
  api.openEditor({kind:'task',id:fix.id}); assert.equal(node('#editor-title').textContent,'Fix bearbeiten'); assert.equal(node('#entry-description').value,'Trennzeichen korrigieren');
  node('#entry-description').value='Trennzeichen und Quotes korrigieren'; node('#entry-target-version').value=String(nextReleaseId);
  await node('#editor-form').dispatchAsync('submit',{preventDefault(){}});
  db.close(); db=new PlannerDatabase(path); api.setWorkspace(db.read());
  fix=db.read().tasks.find(item=>item.kind==='fix'); assert.equal(fix.description,'Trennzeichen und Quotes korrigieren'); assert.equal(fix.targetVersion,'v0.4.1');
  assert.equal(fix.criteria[0].completed,true); assert.equal(db.read().tasks.find(item=>item.id===task.id).featureId,fix.id);
  for (const [tab, expected, forbidden] of [['tab-task','Vorhandene Aufgabe',['CSV reparieren','>Feature</span>']],['tab-feature','Feature',['Vorhandene Aufgabe','CSV reparieren']],['tab-fix','CSV reparieren',['Vorhandene Aufgabe','>Feature</span>']]]) {
    click(tab); const contents=node('#content').innerHTML; assert.match(contents,new RegExp(expected));
    for (const text of forbidden) assert.equal(contents.includes(text),false);
  }
  db.close();
});

test('release tab plans and publishes parallel releases while preserving shipped fix details', async t => {
  const { mkdtempSync,rmSync }=require('node:fs'); const { join }=require('node:path'); const { tmpdir }=require('node:os'); const {PlannerDatabase}=require('../dist/database');
  const dir=mkdtempSync(join(tmpdir(),'hq-release-ui-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); const path=join(dir,'hq.sqlite'); let db=new PlannerDatabase(path);
  db.saveProject(null,{title:'Software',kind:'software',priority:'normal',description:''}); const project=db.read().projects[0].id;
  const hq={read:()=>new Promise(()=>{}),createRelease:async(id,v)=>{db.createRelease(id,v);return db.read();},publishRelease:async id=>{db.publishRelease(id);return db.read();},saveTask:async(id,fields)=>{db.saveTask(id,fields);return db.read();}};
  const {api,node,click}=renderer(hq); api.setWorkspace(db.read()); api.showView(project); click('tab-releases');
  assert.match(node('#content').innerHTML,/Noch keine Releases/);
  click('new-release'); node('#release-version').value='v0.4.0'; await node('#release-form').dispatchAsync('submit',{preventDefault(){}});
  click('new-release'); node('#release-version').value='v0.5.0'; await node('#release-form').dispatchAsync('submit',{preventDefault(){}});
  const v04=db.read().releases.find(r=>r.version==='v0.4.0').id,v05=db.read().releases.find(r=>r.version==='v0.5.0').id;
  click('tab-fix'); click('new-task'); node('#entry-title').value='Fix'; node('#entry-priority').value='normal'; node('#entry-status').value='done'; node('#entry-target-version').value=String(v04); await node('#editor-form').dispatchAsync('submit',{preventDefault(){}});
  click('tab-feature'); click('new-task'); node('#entry-title').value='Feature'; node('#entry-priority').value='normal'; node('#entry-status').value='planned'; node('#entry-target-version').value=String(v05); await node('#editor-form').dispatchAsync('submit',{preventDefault(){}});
  click('tab-releases'); let html=node('#content').innerHTML; assert.match(html,/v0\.4\.0/); assert.match(html,/v0\.5\.0/); assert.match(html,/Fix · Fix/); assert.match(html,/Feature · Feature/);
  click('publish-release',v04); assert.equal(node('#publish-dialog').open,true); await node('#confirm-publish').dispatchAsync('click');
  html=node('#content').innerHTML; assert.match(html,/Veröffentlicht/); assert.match(html,/Fix · Fix/); assert.match(html,/v0\.5\.0/);
  const fix=db.read().tasks.find(item=>item.title==='Fix'); api.selectTask(fix.id); assert.match(node('#details').innerHTML,/v0\.4\.0 \(veröffentlicht\)/);
  api.openEditor({kind:'task',id:fix.id}); const options=node('#entry-target-version').children;
  assert.equal(options.some(option=>option.text==='v0.4.0'),false); assert.equal(options.some(option=>option.text==='v0.5.0'),true);
  assert.equal(node('#entry-target-version').value,'keep-published'); assert.match(node('#published-version').textContent,/v0\.4\.0/);
  node('#entry-title').value='Fix bearbeitet'; node('#entry-priority').value='normal'; node('#entry-status').value='planned'; await node('#editor-form').dispatchAsync('submit',{preventDefault(){}});
  assert.equal(db.read().tasks.find(item=>item.title==='Fix bearbeitet').releaseId,v04);
  api.setTab('fix'); api.openEditor({kind:'task',id:null});
  assert.equal(node('#entry-target-version').children.some(option=>option.text==='v0.4.0'),false); assert.equal(node('#entry-target-version').children.some(option=>option.text==='v0.5.0'),true);
  db.close(); db=new PlannerDatabase(path); api.setWorkspace(db.read()); api.setTab('releases'); api.render();
  html=node('#content').innerHTML; assert.match(html,/v0\.4\.0/); assert.match(html,/Veröffentlicht/); assert.match(html,/Fix · Fix bearbeitet/); assert.match(html,/Feature · Feature/);
  db.close();
});

test('release dialogs clearly create and edit versions with due dates', async t => {
  const {mkdtempSync,rmSync}=require('node:fs'); const {join}=require('node:path'); const {tmpdir}=require('node:os'); const {PlannerDatabase}=require('../dist/database');
  const dir=mkdtempSync(join(tmpdir(),'hq-release-edit-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); const db=new PlannerDatabase(join(dir,'hq.sqlite'));
  db.saveProject(null,{title:'App',priority:'normal',description:'',kind:'software'}); const project=db.read().projects[0].id;
  const hq={read:()=>new Promise(()=>{}),createRelease:async(id,version,due)=>{db.createRelease(id,version,due);return db.read();},renameRelease:async(id,version,due,published)=>{db.renameRelease(id,version,due,published);return db.read();}};
  const {api,node,click}=renderer(hq); api.setWorkspace(db.read()); api.showView(project); click('tab-releases'); click('new-release');
  assert.equal(node('#release-dialog').open,true); assert.equal(node('#release-dialog-title').textContent,'Neues Release'); assert.equal(node('#save-release').textContent,'Release anlegen');
  node('#release-version').value='v1'; node('#release-due').value='2026-12-20'; await node('#release-form').dispatchAsync('submit',{preventDefault(){}});
  const release=db.read().releases[0]; assert.equal(release.dueDate,'2026-12-20');
  assert.match(node('#content').innerHTML,/Fällig am 20\.12\.2026/); assert.match(node('#content').innerHTML,/data-action="edit-release"/);
  click('edit-release',release.id); assert.equal(node('#release-dialog-title').textContent,'Release bearbeiten'); assert.equal(node('#release-version').value,'v1'); assert.equal(node('#release-due').value,'2026-12-20');
  node('#release-version').value='v1.1'; node('#release-due').value='2027-01-05'; await node('#release-form').dispatchAsync('submit',{preventDefault(){}});
  assert.equal(db.read().releases[0].version,'v1.1'); assert.equal(db.read().releases[0].dueDate,'2027-01-05'); assert.match(node('#content').innerHTML,/Fällig am 05\.01\.2027/);
  db.close();
});

test('release details open from the overview and deletion requires confirmation', async t => {
  const {mkdtempSync,rmSync}=require('node:fs'); const {join}=require('node:path'); const {tmpdir}=require('node:os'); const {PlannerDatabase}=require('../dist/database');
  const dir=mkdtempSync(join(tmpdir(),'hq-release-details-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); const path=join(dir,'hq.sqlite'); let db=new PlannerDatabase(path);
  db.saveProject(null,{title:'App',priority:'normal',description:'',kind:'software'}); const project=db.read().projects[0].id;
  db.createRelease(project,'v1','2026-12-20'); const release=db.read().releases[0].id;
  const base={priority:'normal',description:'',featureId:null,releaseId:release,criteria:[],projectId:project,dueDate:null,status:'planned',predecessorIds:[]};
  db.saveTask(null,{...base,title:'Feature A',kind:'feature'}); db.saveTask(null,{...base,title:'Fix B',kind:'fix'});
  let deletes=0;
  const hq={read:()=>new Promise(()=>{}),deleteRelease:async id=>{deletes++;db.deleteRelease(id);return db.read();},renameRelease:async(id,version,due,published)=>{db.renameRelease(id,version,due,published);return db.read();}};
  const {api,node,click}=renderer(hq); api.setWorkspace(db.read()); api.showView(project); click('tab-releases');
  assert.match(node('#content').innerHTML,/data-action="show-release"/);
  click('show-release',release); assert.equal(node('#details').hidden,false);
  assert.match(node('#details').innerHTML,/<h2>v1<\/h2>/); assert.match(node('#details').innerHTML,/20\.12\.2026/);
  assert.match(node('#details').innerHTML,/Feature A/); assert.match(node('#details').innerHTML,/Fix B/); assert.match(node('#details').innerHTML,/aria-label="Release bearbeiten"/);
  const feature=db.read().tasks.find(item=>item.title==='Feature A'); click('show-task',feature.id);
  assert.match(node('#details').innerHTML,/<h2>Feature A<\/h2>/); assert.doesNotMatch(node('#details').innerHTML,/aria-label="Release bearbeiten"/);
  click('close-details'); assert.equal(node('#details').hidden,true); click('show-release',release);
  assert.match(node('#details').innerHTML,/<h2>v1<\/h2>/);
  click('edit-release',release); assert.equal(node('#release-dialog').open,true); assert.equal(node('#release-version').value,'v1');
  node('#release-version').value='v1.1'; await node('#release-form').dispatchAsync('submit',{preventDefault(){}}); assert.match(node('#details').innerHTML,/<h2>v1\.1<\/h2>/);
  click('delete-release',release); assert.equal(node('#delete-release-dialog').open,true); assert.match(node('#delete-release-description').textContent,/bleiben erhalten/);
  node('#cancel-delete-release').dispatch('click'); assert.equal(deletes,0); assert.equal(db.read().releases.length,1);
  click('delete-release',release); await node('#confirm-delete-release').dispatchAsync('click');
  assert.equal(deletes,1); assert.equal(node('#details').hidden,true); assert.match(node('#content').innerHTML,/Noch keine Releases/);
  db.close(); db=new PlannerDatabase(path); const w=db.read(); assert.equal(w.releases.length,0); assert.equal(w.tasks.length,2); assert.equal(w.tasks.every(task=>task.releaseId===null),true); db.close();
});

test('release status selection updates details and planned release choices', async t => {
  const {mkdtempSync,rmSync}=require('node:fs'); const {join}=require('node:path'); const {tmpdir}=require('node:os'); const {PlannerDatabase}=require('../dist/database');
  const dir=mkdtempSync(join(tmpdir(),'hq-release-status-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); const path=join(dir,'hq.sqlite'); let db=new PlannerDatabase(path);
  db.saveProject(null,{title:'App',priority:'normal',description:'',kind:'software'}); const project=db.read().projects[0].id;
  db.createRelease(project,'v1'); const id=db.read().releases[0].id;
  db.saveTask(null,{title:'Fix',kind:'fix',priority:'normal',description:'',featureId:null,releaseId:id,criteria:[],projectId:project,dueDate:null,status:'done',predecessorIds:[]});
  const hq={read:()=>new Promise(()=>{}),renameRelease:async(id,version,due,published)=>{db.renameRelease(id,version,due,published);return db.read();}};
  const {api,node,click}=renderer(hq); api.setWorkspace(db.read()); api.showView(project); click('tab-releases'); click('show-release',id); click('edit-release',id);
  assert.equal(node('#release-status-field').hidden,false); assert.equal(node('#release-status').value,'planned');
  node('#release-status').value='published'; await node('#release-form').dispatchAsync('submit',{preventDefault(){}});
  assert.equal(db.read().releases[0].published,true); assert.match(node('#details').innerHTML,/Veröffentlicht/);
  api.setTab('fix'); api.openEditor({kind:'task',id:null}); assert.equal(node('#entry-target-version').children.some(option=>option.text==='v1'),false);
  node('#cancel-editor').dispatch('click'); api.setTab('releases'); api.selectTask(null); api.render(); click('edit-release',id);
  assert.equal(node('#release-status').value,'published'); node('#release-status').value='planned'; await node('#release-form').dispatchAsync('submit',{preventDefault(){}});
  db.close(); db=new PlannerDatabase(path); assert.equal(db.read().releases[0].published,false); assert.equal(db.read().tasks[0].releaseId,id);
  api.setWorkspace(db.read()); api.setTab('fix'); api.openEditor({kind:'task',id:null}); assert.equal(node('#entry-target-version').children.some(option=>option.text==='v1'),true);
  db.close();
});

test('a task can be assigned in the editor and blocks its release until completed', async t => {
  const {mkdtempSync,rmSync}=require('node:fs'); const {join}=require('node:path'); const {tmpdir}=require('node:os'); const {PlannerDatabase}=require('../dist/database');
  const dir=mkdtempSync(join(tmpdir(),'hq-release-task-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); const path=join(dir,'hq.sqlite'); let db=new PlannerDatabase(path);
  db.saveProject(null,{title:'App',kind:'software',priority:'normal',description:''}); const project=db.read().projects[0].id;
  db.createRelease(project,'v1'); const release=db.read().releases[0].id;
  const hq={read:()=>new Promise(()=>{}),saveTask:async(id,fields)=>{db.saveTask(id,fields);return db.read();},publishRelease:async id=>{db.publishRelease(id);return db.read();},renameRelease:async(id,v,d,status)=>{db.renameRelease(id,v,d,status);return db.read();}};
  const {api,node,click}=renderer(hq); api.setWorkspace(db.read()); api.showView(project); click('tab-task'); click('new-task');
  assert.equal(node('#release-assignment-field').hidden,false);
  assert.ok(node('#entry-target-version').children.some(option=>option.value===String(release)));
  node('#entry-title').value='Dokumentation'; node('#entry-priority').value='normal'; node('#entry-status').value='planned'; node('#entry-target-version').value=String(release);
  await node('#editor-form').dispatchAsync('submit',{preventDefault(){}});
  let task=db.read().tasks.find(item=>item.title==='Dokumentation'); assert.equal(task.releaseId,release);
  click('tab-releases'); assert.match(node('#content').innerHTML,/Aufgabe · Dokumentation · Geplant/);
  click('show-release',release); assert.match(node('#details').innerHTML,/<h3>Aufgaben<\/h3>/); assert.match(node('#details').innerHTML,/Dokumentation · Geplant/);
  click('publish-release',release); assert.match(node('#publish-description').textContent,/Aufgabe: Dokumentation \(Geplant\)/);
  await node('#confirm-publish').dispatchAsync('click'); assert.match(node('#publish-error').textContent,/Aufgabe: Dokumentation/); assert.equal(db.read().releases[0].published,false);
  node('#cancel-publish').dispatch('click'); click('edit-release',release); node('#release-status').value='published';
  await node('#release-form').dispatchAsync('submit',{preventDefault(){}}); assert.match(node('#release-error').textContent,/Aufgabe: Dokumentation/);
  node('#cancel-release').dispatch('click'); api.openEditor({kind:'task',id:task.id}); assert.equal(node('#entry-target-version').value,String(release));
  node('#entry-status').value='done'; await node('#editor-form').dispatchAsync('submit',{preventDefault(){}});
  assert.match(node('#content').innerHTML,/Aufgabe · Dokumentation · Erledigt/);
  click('publish-release',release); await node('#confirm-publish').dispatchAsync('click'); assert.equal(db.read().releases[0].published,true);
  db.close(); db=new PlannerDatabase(path); task=db.read().tasks.find(item=>item.title==='Dokumentation');
  assert.equal(task.releaseId,release); assert.equal(task.status,'done'); assert.equal(db.read().releases[0].status,'published'); db.close();
});

test('release status edits show all states and prevent publication while features are open', async t => {
  const {mkdtempSync,rmSync}=require('node:fs'); const {join}=require('node:path'); const {tmpdir}=require('node:os'); const {PlannerDatabase}=require('../dist/database');
  const dir=mkdtempSync(join(tmpdir(),'hq-release-ready-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); const path=join(dir,'hq.sqlite'); let db=new PlannerDatabase(path);
  db.saveProject(null,{title:'App',kind:'software',priority:'normal',description:''}); const project=db.read().projects[0].id;
  db.createRelease(project,'v1'); const id=db.read().releases[0].id;
  db.saveTask(null,{title:'Feature',kind:'feature',priority:'normal',description:'',featureId:null,releaseId:id,criteria:[],projectId:project,dueDate:null,status:'planned',predecessorIds:[]});
  const hq={read:()=>new Promise(()=>{}),renameRelease:async(id,v,d,status)=>{db.renameRelease(id,v,d,status);return db.read();},publishRelease:async id=>{db.publishRelease(id);return db.read();}};
  const {api,node,click}=renderer(hq); api.setWorkspace(db.read()); api.showView(project); click('tab-releases'); click('show-release',id);
  for (const [value,label] of [['in_progress','In Arbeit'],['paused','Pausiert']]) {
    click('edit-release',id); node('#release-status').value=value; await node('#release-form').dispatchAsync('submit',{preventDefault(){}});
    assert.equal(db.read().releases[0].status,value); assert.match(node('#details').innerHTML,new RegExp(label));
  }
  click('edit-release',id); node('#release-status').value='published'; node('#release-version').value='v1.1'; await node('#release-form').dispatchAsync('submit',{preventDefault(){}});
  assert.equal(node('#release-dialog').open,true); assert.equal(node('#release-error').hidden,false); assert.equal(db.read().releases[0].version,'v1');
  node('#cancel-release').dispatch('click'); click('publish-release',id); await node('#confirm-publish').dispatchAsync('click');
  assert.equal(node('#publish-dialog').open,true); assert.equal(node('#publish-error').hidden,false); assert.equal(db.read().releases[0].published,false);
  node('#cancel-publish').dispatch('click'); const feature=db.read().tasks[0]; db.completeTask(feature.id,true); api.setWorkspace(db.read());
  click('edit-release',id); node('#release-status').value='published'; node('#release-version').value='v1.1'; await node('#release-form').dispatchAsync('submit',{preventDefault(){}});
  assert.equal(db.read().releases[0].status,'published'); assert.equal(db.read().tasks[0].targetVersion,'v1.1');
  click('show-task',feature.id); assert.match(node('#details').innerHTML,/v1\.1 \(veröffentlicht\)/);
  db.close();
});
