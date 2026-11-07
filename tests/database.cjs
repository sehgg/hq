const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { PlannerDatabase } = require('../dist/database.js');

const fields = (title, extra = {}) => ({ title, priority: 'normal', description: '', projectId: null, dueDate: null, status: 'planned', predecessorIds: [], ...extra });
function tempDatabase(t, legacy = false) {
  const dir = mkdtempSync(join(tmpdir(), 'hq-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'hq.sqlite');
  if (legacy) {
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priority TEXT NOT NULL) STRICT;
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priority TEXT NOT NULL, project_id INTEGER REFERENCES projects(id), completed INTEGER NOT NULL DEFAULT 0) STRICT;
      INSERT INTO projects VALUES (1, 'Vorhandenes Projekt', 'high');
      INSERT INTO tasks VALUES (1, 'Offen', 'normal', 1, 0), (2, 'Alt erledigt', 'low', NULL, 1);`);
    db.close();
  }
  return file;
}
function find(db, title) { return db.read().tasks.find(item => item.title === title); }

test('migration preserves projects, tasks and their completed states across a restart', t => {
  const file = tempDatabase(t, true);
  let db = new PlannerDatabase(file);
  let workspace = db.read();
  assert.deepEqual(workspace.projects.map(project => ({...project})), [{ id: 1, title: 'Vorhandenes Projekt', priority: 'high', description: '' }]);
  assert.equal(find(db, 'Offen').status, 'planned');
  assert.equal(find(db, 'Alt erledigt').status, 'done');
  db.close(); db = new PlannerDatabase(file); workspace = db.read();
  assert.equal(workspace.tasks.length, 2); assert.equal(workspace.projects.length, 1); db.close();
});

test('dependencies and subtasks guard both completion paths and persist together with edited fields', t => {
  const file = tempDatabase(t, true);
  let db = new PlannerDatabase(file);
  db.saveProject(1, {title: 'Projekt', priority: 'low', description: 'Projektbeschreibung'});
  db.saveTask(null, fields('Vorgänger', {projectId: 1}));
  const predecessor = find(db, 'Vorgänger').id;
  db.saveTask(null, fields('Aufgabe', {projectId: 1, description: 'Beschreibung', dueDate: '2026-12-15', predecessorIds: [predecessor]}));
  const task = find(db, 'Aufgabe').id;
  db.addSubtask(task, 'Teil erledigen');
  const sub = db.read().subtasks[0].id;
  assert.deepEqual(find(db, 'Vorgänger').successorIds, [task]);
  assert.throws(() => db.completeTask(task, true), /Unteraufgaben/);
  assert.throws(() => db.saveTask(task, fields('Umbenannt', {status:'done', predecessorIds:[predecessor]})), /Unteraufgaben/);
  assert.equal(find(db, 'Aufgabe').description, 'Beschreibung');
  db.completeSubtask(sub, true);
  assert.throws(() => db.completeTask(task, true), /Vorgänger/);
  assert.throws(() => db.saveTask(task, fields('Aufgabe', {status:'done', predecessorIds:[predecessor]})), /Vorgänger/);
  db.completeTask(predecessor, true);
  db.saveTask(task, fields('Aufgabe bearbeitet', {projectId: 1, description:'Bearbeitet', dueDate:'2026-12-16', status:'in_progress', predecessorIds:[predecessor]}));
  assert.equal(find(db, 'Aufgabe bearbeitet').status, 'in_progress');
  db.completeTask(task, true);
  assert.throws(() => db.completeTask(predecessor, false), /Folgeaufgaben/);
  assert.throws(() => db.completeSubtask(sub, false), /übergeordnete/);
  db.close(); db = new PlannerDatabase(file);
  const saved = find(db, 'Aufgabe bearbeitet');
  assert.equal(saved.description, 'Bearbeitet'); assert.equal(saved.dueDate, '2026-12-16');
  assert.equal(saved.status, 'done'); assert.deepEqual(saved.predecessorIds, [predecessor]);
  assert.equal(db.read().subtasks[0].completed, true);
  assert.equal(db.read().projects[0].description, 'Projektbeschreibung');
  assert.equal(db.read().tasks.filter(item => item.projectId === 1 && !item.completed).length, 1);
  db.close();
});

test('all statuses work and cyclic links are rejected without losing existing links', t => {
  const db = new PlannerDatabase(tempDatabase(t));
  db.saveTask(null, fields('A')); db.saveTask(null, fields('B'));
  const a = find(db, 'A').id, b = find(db, 'B').id;
  db.saveTask(b, fields('B', {predecessorIds:[a], status:'paused'}));
  assert.equal(find(db, 'B').status, 'paused');
  assert.throws(() => db.saveTask(a, fields('A', {predecessorIds:[b]})), /Kreis/);
  assert.deepEqual(find(db, 'B').predecessorIds, [a]);
  assert.deepEqual(find(db, 'A').predecessorIds, []);
  db.saveTask(a, fields('A', {status:'done'}));
  db.saveTask(b, fields('B', {status:'done', predecessorIds:[a]}));
  assert.equal(find(db, 'B').status, 'done'); db.close();
});

test('tasks sort by due date across status, priority and project, and cross-project predecessors block completion', t => {
  const file = tempDatabase(t);
  const db = new PlannerDatabase(file);
  db.saveProject(null, { title:'Erstes Projekt', priority:'normal', description:'' });
  db.saveProject(null, { title:'Zweites Projekt', priority:'normal', description:'' });
  const one = db.read().projects.find(p => p.title === 'Erstes Projekt').id;
  const two = db.read().projects.find(p => p.title === 'Zweites Projekt').id;
  db.saveTask(null, fields('Später', { projectId: one, dueDate:'2027-12-01', priority:'high' }));
  db.saveTask(null, fields('Kein Datum', { projectId: one, priority:'high' }));
  db.saveTask(null, fields('Früh erledigt', { projectId: one, dueDate:'2026-01-01', priority:'low', status:'done' }));
  db.saveTask(null, fields('Anderes Projekt', { projectId: two, dueDate:'2026-02-01' }));
  const pre = find(db, 'Anderes Projekt').id;
  db.saveTask(null, fields('Folge', { projectId: one, dueDate:'2026-03-01', predecessorIds:[pre] }));
  const follow = find(db, 'Folge').id;
  assert.deepEqual(db.read().tasks.map(task => task.title), ['Früh erledigt','Anderes Projekt','Folge','Später','Kein Datum']);
  assert.deepEqual(find(db, 'Anderes Projekt').successorIds, [follow]);
  assert.throws(() => db.completeTask(follow, true), /Vorgänger/);
  assert.throws(() => db.saveTask(follow, fields('Folge', { projectId:one, dueDate:'2026-03-01', status:'done', predecessorIds:[pre] })), /Vorgänger/);
  db.completeTask(pre, true);
  db.completeTask(follow, true);
  assert.equal(find(db, 'Folge').status, 'done');
  db.close();
  const reopened = new PlannerDatabase(file);
  assert.deepEqual(find(reopened, 'Folge').predecessorIds, [pre]);
  assert.deepEqual(reopened.read().tasks.map(task => task.title), ['Früh erledigt','Anderes Projekt','Folge','Später','Kein Datum']);
  reopened.close();
});
