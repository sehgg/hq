// Renderer logic runs against small DOM doubles; this is not a visual layout test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function renderer() {
  class Element {
    constructor() { this.value = ''; this.innerHTML = ''; this.hidden = false; this.disabled = false; this.open = false; this.dataset = {}; this.listeners = {}; this.children = []; this.classList = { toggle() {} }; }
    addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
    dispatch(type, event = {}) { for (const listener of this.listeners[type] ?? []) listener(event); }
    replaceChildren(...children) { this.children = children; this.value = children[0]?.value ?? ''; }
    setAttribute() {} focus() {} showModal() { this.open = true; } close() { this.open = false; }
    querySelector() { return null; }
  }
  const nodes = new Map();
  const document = { querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); }, addEventListener() {} };
  class Option { constructor(text, value) { this.text = text; this.value = value; } }
  const context = { document, Option, Element, HTMLInputElement: Element, HTMLFormElement: Element, window: { hq: { read: () => new Promise(() => {}) } }, console };
  vm.createContext(context);
  vm.runInContext(readFileSync('dist/renderer.js', 'utf8') + `\nglobalThis.testApi = { taskRow, taskPanel, orderTaskTree, openEditor, updatePredecessorTasks, setWorkspace: value => { workspace = value; }, selected: () => [...selectedPredecessors] };`, context);
  return { api: context.testApi, node: selector => document.querySelector(selector) };
}
const task = (id, title, projectId, overrides = {}) => ({ id, title, projectId, priority:'normal', description:'', dueDate:null, status:'planned', completed:false, predecessorIds:[], successorIds:[], ...overrides });

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
