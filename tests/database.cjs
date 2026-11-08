const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { PlannerDatabase } = require('../dist/database.js');

const fields = (title, extra = {}) => ({ title, priority: 'normal', description: '', kind: 'task', featureId: null, releaseId: null, criteria: [], projectId: null, dueDate: null, status: 'planned', predecessorIds: [], ...extra });
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
  assert.deepEqual(workspace.projects.map(project => ({...project})), [{ id: 1, title: 'Vorhandenes Projekt', priority: 'high', description: '', kind: 'normal' }]);
  assert.equal(find(db, 'Offen').status, 'planned');
  assert.equal(find(db, 'Alt erledigt').status, 'done');
  db.close(); db = new PlannerDatabase(file); workspace = db.read();
  assert.equal(workspace.tasks.length, 2); assert.equal(workspace.projects.length, 1); db.close();
});

test('dependencies and subtasks guard both completion paths and persist together with edited fields', t => {
  const file = tempDatabase(t, true);
  let db = new PlannerDatabase(file);
  db.saveProject(1, {title: 'Projekt', priority: 'low', description: 'Projektbeschreibung', kind:'normal'});
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
  db.saveProject(null, { title:'Erstes Projekt', priority:'normal', description:'', kind:'normal' });
  db.saveProject(null, { title:'Zweites Projekt', priority:'normal', description:'', kind:'normal' });
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

test('project types and features persist separately and features cannot be orphaned', t => {
  const file = tempDatabase(t, true);
  let db = new PlannerDatabase(file);
  assert.equal(db.read().projects[0].kind, 'normal');
  assert.equal(find(db, 'Offen').kind, 'task');
  db.saveProject(null, {title:'Software', priority:'normal', description:'App', kind:'software'});
  const software = db.read().projects.find(project => project.title === 'Software').id;
  db.saveTask(null, fields('Reguläre Aufgabe', {projectId:software}));
  db.saveTask(null, fields('Feature', {projectId:software, kind:'feature', description:'Neue Funktion'}));
  const feature = find(db, 'Feature');
  assert.equal(feature.kind, 'feature');
  db.saveTask(feature.id, fields('Feature bearbeitet', {projectId:software, kind:'feature', description:'Neue Funktion genauer beschrieben'}));
  assert.throws(() => db.saveProject(software, {title:'Software', priority:'normal', description:'App', kind:'normal'}), /Features/);
  assert.throws(() => db.saveTask(feature.id, fields('Feature', {projectId:1, kind:'feature'})), /Softwareprojekt/);
  assert.throws(() => db.saveTask(null, fields('Feature', {kind:'feature'})), /Softwareprojekt/);
  db.close();
  db = new PlannerDatabase(file);
  assert.equal(db.read().projects.find(project => project.id === software).kind, 'software');
  assert.equal(find(db, 'Reguläre Aufgabe').kind, 'task');
  assert.equal(find(db, 'Feature bearbeitet').description, 'Neue Funktion genauer beschrieben');
  assert.equal(find(db, 'Feature bearbeitet').kind, 'feature');
  db.close();
});

test('migration of the preceding schema preserves descriptions, dates, statuses and relationships', t => {
  const file = tempDatabase(t);
  let old = new DatabaseSync(file);
  old.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priority TEXT NOT NULL, description TEXT NOT NULL DEFAULT '') STRICT;
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priority TEXT NOT NULL, project_id INTEGER REFERENCES projects(id), completed INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '', due_date TEXT, status TEXT NOT NULL DEFAULT 'planned') STRICT;
    CREATE TABLE subtasks (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id), title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0) STRICT;
    CREATE TABLE task_dependencies (predecessor_id INTEGER NOT NULL REFERENCES tasks(id), successor_id INTEGER NOT NULL REFERENCES tasks(id), PRIMARY KEY (predecessor_id, successor_id)) STRICT;
    INSERT INTO projects VALUES (1,'Altprojekt','high','Projekttext');
    INSERT INTO tasks VALUES (1,'Vorgänger','normal',1,0,'Erste Beschreibung','2026-12-01','in_progress'),(2,'Folge','low',1,0,'Zweite Beschreibung','2027-01-01','paused');
    INSERT INTO subtasks VALUES (1,2,'Teilaufgabe',0);
    INSERT INTO task_dependencies VALUES (1,2);`);
  old.close();
  const db = new PlannerDatabase(file);
  const workspace = db.read();
  assert.equal(workspace.projects[0].kind, 'normal');
  assert.equal(workspace.projects[0].description, 'Projekttext');
  const previous = workspace.tasks.find(item => item.id === 1);
  const following = workspace.tasks.find(item => item.id === 2);
  assert.equal(previous.kind, 'task'); assert.equal(previous.status, 'in_progress');
  assert.equal(previous.description, 'Erste Beschreibung'); assert.equal(previous.dueDate, '2026-12-01');
  assert.equal(following.kind, 'task'); assert.equal(following.status, 'paused');
  assert.deepEqual(following.predecessorIds, [1]); assert.deepEqual(previous.successorIds, [2]);
  assert.equal(workspace.subtasks[0].title, 'Teilaufgabe');
  db.close();
});

test('feature target version and individually edited criteria survive restart and can be cleared', t => {
  const file = tempDatabase(t);
  let db = new PlannerDatabase(file);
  db.saveProject(null, {title:'App', priority:'normal', description:'', kind:'software'});
  const projectId = db.read().projects[0].id;
  db.createRelease(projectId, 'v0.4.0'); db.createRelease(projectId, 'v0.5.0');
  const v04=db.read().releases.find(r=>r.version==='v0.4.0').id, v05=db.read().releases.find(r=>r.version==='v0.5.0').id;
  const feature = (overrides = {}) => fields('CSV exportieren', {kind:'feature', projectId, releaseId:v04, description:'CSV für Auswertungen', criteria:[{id:null,text:'CSV enthält Titel und Status',completed:false},{id:null,text:'CSV enthält Fälligkeitsdaten',completed:false}], ...overrides});
  db.saveTask(null, feature());
  let task = find(db,'CSV exportieren');
  assert.equal(task.targetVersion,'v0.4.0'); assert.equal(task.criteria.length,2);
  const first = task.criteria[0].id, second = task.criteria[1].id;
  db.completeCriterion(first, true);
  db.close(); db = new PlannerDatabase(file);
  task = find(db,'CSV exportieren');
  assert.deepEqual(task.criteria.map(c => c.completed), [true,false]);
  assert.equal(task.targetVersion, 'v0.4.0');
  db.saveTask(task.id, feature({releaseId:v05, criteria:[{id:second,text:'Fälligkeit und Projekt enthalten',completed:true},{id:null,text:'Datei lässt sich öffnen',completed:false}]}));
  task = find(db,'CSV exportieren');
  assert.deepEqual(task.criteria.map(c => c.text), ['Fälligkeit und Projekt enthalten','Datei lässt sich öffnen']);
  assert.deepEqual(task.criteria.map(c => c.completed), [true,false]);
  assert.equal(task.criteria[0].id,second); assert.equal(task.targetVersion,'v0.5.0');
  assert.throws(() => db.completeCriterion(first,true), /nicht gefunden/);
  assert.throws(() => db.saveTask(task.id, feature({criteria:[{id:second,text:'',completed:false}]})), /Akzeptanzkriterium/);
  assert.equal(find(db,'CSV exportieren').targetVersion,'v0.5.0');
  db.saveTask(task.id, feature({releaseId:null, criteria:task.criteria}));
  db.close(); db = new PlannerDatabase(file);
  task = find(db,'CSV exportieren'); assert.equal(task.targetVersion,null); assert.equal(task.criteria.length,2);
  db.close();
});

test('existing software features gain empty criteria and a target-version field without losing data', t => {
  const file = tempDatabase(t);
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priority TEXT NOT NULL, description TEXT NOT NULL, kind TEXT NOT NULL) STRICT;
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priority TEXT NOT NULL, project_id INTEGER REFERENCES projects(id), completed INTEGER NOT NULL, description TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL, kind TEXT NOT NULL) STRICT;
    CREATE TABLE subtasks (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id), title TEXT NOT NULL, completed INTEGER NOT NULL) STRICT;
    CREATE TABLE task_dependencies (predecessor_id INTEGER NOT NULL REFERENCES tasks(id), successor_id INTEGER NOT NULL REFERENCES tasks(id), PRIMARY KEY (predecessor_id, successor_id)) STRICT;
    INSERT INTO projects VALUES (1,'App','normal','Softwareprojekt','software');
    INSERT INTO tasks VALUES (1,'Basis','high',1,1,'Bereits fertig',NULL,'done','task'),(2,'Export','normal',1,0,'CSV für Auswertungen','2027-01-01','in_progress','feature');
    INSERT INTO task_dependencies VALUES (1,2);
    INSERT INTO subtasks VALUES (1,2,'Spalten auswählen',0);`);
  old.close();
  const db = new PlannerDatabase(file); const w = db.read();
  const feature = w.tasks.find(task => task.id === 2);
  assert.equal(w.projects[0].kind, 'software'); assert.equal(feature.kind, 'feature');
  assert.equal(feature.description, 'CSV für Auswertungen'); assert.equal(feature.dueDate, '2027-01-01');
  assert.equal(feature.status, 'in_progress'); assert.equal(feature.targetVersion, null);
  assert.deepEqual(feature.criteria, []); assert.deepEqual(feature.predecessorIds, [1]);
  assert.equal(w.subtasks[0].title, 'Spalten auswählen');
  db.close();
});

test('deleting tasks and features removes only their own data and dependency links', t => {
  const file = tempDatabase(t);
  let db = new PlannerDatabase(file);
  db.saveProject(null, {title:'Software', priority:'normal', description:'', kind:'software'});
  const project = db.read().projects[0].id;
  db.saveTask(null, fields('Vorgänger', {projectId:project}));
  const pre = find(db,'Vorgänger').id;
  db.createRelease(project,'v1');
  db.saveTask(null, fields('Feature', {projectId:project,kind:'feature',releaseId:db.read().releases[0].id,predecessorIds:[pre],criteria:[{id:null,text:'Ergebnis prüfen',completed:false}]}));
  const feature = find(db,'Feature').id;
  db.addSubtask(feature,'Feature-Teilaufgabe');
  db.saveTask(null, fields('Nachfolger', {projectId:project,predecessorIds:[feature]}));
  const successor = find(db,'Nachfolger').id;
  db.deleteTask(feature);
  let workspace = db.read();
  assert.equal(workspace.tasks.length,2); assert.equal(workspace.projects.length,1);
  assert.deepEqual(find(db,'Vorgänger').successorIds,[]); assert.deepEqual(find(db,'Nachfolger').predecessorIds,[]);
  assert.equal(workspace.subtasks.length,0);
  assert.throws(() => db.deleteTask(feature),/nicht gefunden/);
  assert.throws(() => db.deleteTask(0),/ungültig/);
  db.addSubtask(pre,'Aufgaben-Teilaufgabe');
  db.deleteTask(pre);
  db.close(); db = new PlannerDatabase(file); workspace = db.read();
  assert.deepEqual(workspace.tasks.map(task => task.id),[successor]);
  assert.equal(workspace.subtasks.length,0); assert.equal(workspace.projects.length,1);
  db.close();
});

test('feature membership is persistent, project-scoped and independent of status and dependencies', t => {
  const file=tempDatabase(t); let db=new PlannerDatabase(file);
  db.saveProject(null,{title:'App A',kind:'software',priority:'normal',description:''});
  db.saveProject(null,{title:'App B',kind:'software',priority:'normal',description:''});
  const a=db.read().projects.find(p=>p.title==='App A').id, b=db.read().projects.find(p=>p.title==='App B').id;
  db.saveTask(null,fields('Feature XY',{kind:'feature',projectId:a}));
  db.saveTask(null,fields('Anderes Feature',{kind:'feature',projectId:b}));
  const feature=find(db,'Feature XY').id, other=find(db,'Anderes Feature').id;
  db.saveTask(null,fields('Feature XY definieren',{projectId:a,featureId:feature}));
  const task=find(db,'Feature XY definieren').id;
  db.saveTask(null,fields('Vorhandene Aufgabe',{projectId:a}));
  const existing=find(db,'Vorhandene Aufgabe').id;
  db.assignFeature(existing,feature);
  assert.throws(()=>db.assignFeature(task,other),/selben Softwareprojekt/);
  assert.throws(()=>db.assignFeature(feature,feature),/Aufgabe/);
  assert.throws(()=>db.saveTask(task,fields('Feature XY definieren',{projectId:b,featureId:feature})),/selben Softwareprojekt/);
  assert.throws(()=>db.saveTask(feature,fields('Feature XY',{kind:'feature',projectId:b})),/Zuordnung/);
  db.completeTask(task,true);
  assert.equal(find(db,'Feature XY').status,'planned');
  assert.deepEqual(find(db,'Feature XY definieren').predecessorIds,[]);
  db.close(); db=new PlannerDatabase(file);
  assert.equal(find(db,'Feature XY definieren').featureId,feature);
  assert.equal(find(db,'Vorhandene Aufgabe').featureId,feature);
  db.assignFeature(existing,null); assert.equal(find(db,'Vorhandene Aufgabe').featureId,null);
  db.deleteTask(feature); assert.equal(find(db,'Feature XY definieren').featureId,null);
  assert.equal(find(db,'Feature XY definieren').status,'done');
  db.close();
});

test('reassigning a task updates exactly one feature and project moves cannot retain a foreign feature', t => {
  const file=tempDatabase(t); const db=new PlannerDatabase(file);
  db.saveProject(null,{title:'A',kind:'software',priority:'normal',description:''});
  db.saveProject(null,{title:'B',kind:'software',priority:'normal',description:''});
  const a=db.read().projects.find(p=>p.title==='A').id, b=db.read().projects.find(p=>p.title==='B').id;
  db.saveTask(null,fields('F1',{kind:'feature',projectId:a})); db.saveTask(null,fields('F2',{kind:'feature',projectId:a}));
  const f1=find(db,'F1').id,f2=find(db,'F2').id;
  db.saveTask(null,fields('Task',{projectId:a,featureId:f1})); const id=find(db,'Task').id;
  db.assignFeature(id,f2); assert.equal(find(db,'Task').featureId,f2);
  assert.equal(db.read().tasks.filter(task=>task.featureId===f1).length,0);
  assert.throws(()=>db.saveTask(id,fields('Task',{projectId:b,featureId:f2})),/selben Softwareprojekt/);
  assert.equal(find(db,'Task').projectId,a); assert.equal(find(db,'Task').featureId,f2);
  db.saveTask(id,fields('Task',{projectId:b,featureId:null}));
  assert.equal(find(db,'Task').projectId,b); assert.equal(find(db,'Task').featureId,null);
  db.close();
});

test('fix migration preserves existing feature links, criteria and dependencies and retains foreign keys', t => {
  const file=tempDatabase(t); let old=new DatabaseSync(file);
  old.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE projects(id INTEGER PRIMARY KEY,title TEXT NOT NULL,priority TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'normal' CHECK(kind IN ('normal','software'))) STRICT;
    CREATE TABLE tasks(id INTEGER PRIMARY KEY,title TEXT NOT NULL,priority TEXT NOT NULL,project_id INTEGER REFERENCES projects(id),completed INTEGER NOT NULL DEFAULT 0,kind TEXT NOT NULL DEFAULT 'task' CHECK(kind IN ('task','feature')),description TEXT NOT NULL DEFAULT '',due_date TEXT,status TEXT NOT NULL DEFAULT 'planned',target_version TEXT,feature_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL) STRICT;
    CREATE TABLE subtasks(id INTEGER PRIMARY KEY,task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,title TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0) STRICT;
    CREATE TABLE acceptance_criteria(id INTEGER PRIMARY KEY,task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,text TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,position INTEGER NOT NULL) STRICT;
    CREATE TABLE task_dependencies(predecessor_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,successor_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,PRIMARY KEY(predecessor_id,successor_id)) STRICT;
    INSERT INTO projects VALUES(1,'App','normal','Projekt','software');
    INSERT INTO tasks VALUES(1,'Feature','normal',1,0,'feature','Beschreibung',NULL,'planned','v1',NULL),(2,'Aufgabe','normal',1,0,'task','',NULL,'planned',NULL,1);
    INSERT INTO acceptance_criteria VALUES(1,1,'Kriterium',1,0);
    INSERT INTO subtasks VALUES(1,2,'Unteraufgabe',0);
    INSERT INTO task_dependencies VALUES(1,2);`); old.close();
  let db=new PlannerDatabase(file); let w=db.read();
  assert.equal(w.projects[0].kind,'software'); assert.equal(w.tasks.find(x=>x.id===2).featureId,1);
  assert.equal(w.tasks.find(x=>x.id===1).criteria[0].completed,true); assert.deepEqual(w.tasks.find(x=>x.id===2).predecessorIds,[1]); assert.equal(w.subtasks[0].title,'Unteraufgabe');
  db.createRelease(1,'v2');
  db.saveTask(null,fields('Bugfix',{kind:'fix',projectId:1,releaseId:db.read().releases.find(r=>r.version==='v2').id,criteria:[{id:null,text:'Fehler behoben',completed:true}]}));
  const fix=find(db,'Bugfix').id; db.assignFeature(2,fix);
  assert.throws(()=>db.saveTask(null,fields('Ungültig',{kind:'fix'})),/Softwareprojekt/);
  db.close(); db=new PlannerDatabase(file); w=db.read();
  assert.equal(w.tasks.find(x=>x.id===2).featureId,fix); assert.equal(w.tasks.find(x=>x.id===fix).targetVersion,'v2');
  assert.equal(w.tasks.find(x=>x.id===fix).criteria[0].completed,true);
  db.deleteTask(fix); assert.equal(db.read().tasks.find(x=>x.id===2).featureId,null); db.close();
  old=new DatabaseSync(file); assert.equal(old.prepare('PRAGMA foreign_key_check').all().length,0); old.close();
});

test('a new process reloads fix details, checked criteria and linked task', t => {
  const { spawnSync } = require('node:child_process');
  const file = tempDatabase(t);
  const db = new PlannerDatabase(file);
  db.saveProject(null,{title:'App',kind:'software',priority:'normal',description:''});
  const projectId=db.read().projects[0].id;
  db.createRelease(projectId,'v0.4.0');
  db.saveTask(null,fields('Fix',{kind:'fix',projectId,releaseId:db.read().releases[0].id,criteria:[{id:null,text:'Fehler ist behoben',completed:true}]}));
  const fix=find(db,'Fix').id;
  db.saveTask(null,fields('Fix testen',{projectId,featureId:fix}));
  db.close();
  const script = `const { PlannerDatabase } = require('./dist/database'); const db = new PlannerDatabase(process.argv[1]); const w = db.read(); console.log(JSON.stringify(w)); db.close();`;
  const child=spawnSync(process.execPath,['-e',script,file],{cwd:process.cwd(),encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  const workspace=JSON.parse(child.stdout); const restored=workspace.tasks.find(task=>task.id===fix);
  assert.equal(restored.kind,'fix'); assert.equal(restored.targetVersion,'v0.4.0');
  assert.equal(restored.criteria[0].text,'Fehler ist behoben'); assert.equal(restored.criteria[0].completed,true);
  assert.equal(workspace.tasks.find(task=>task.title==='Fix testen').featureId,fix);
});

test('legacy target versions migrate to project-specific planned releases only once', t => {
  const file=tempDatabase(t); let db=new PlannerDatabase(file);
  for (const name of ['A','B']) db.saveProject(null,{title:name,kind:'software',priority:'normal',description:''});
  const a=db.read().projects.find(x=>x.title==='A').id, b=db.read().projects.find(x=>x.title==='B').id;
  db.saveTask(null,fields('Fix A',{kind:'fix',projectId:a})); db.saveTask(null,fields('Feature A',{kind:'feature',projectId:a})); db.saveTask(null,fields('Fix B',{kind:'fix',projectId:b})); db.close();
  const old=new DatabaseSync(file); old.exec("ALTER TABLE tasks DROP COLUMN release_id; UPDATE tasks SET target_version='v0.4.0' WHERE title IN ('Fix A','Feature A','Fix B');"); old.close();
  db=new PlannerDatabase(file); let w=db.read(); assert.equal(w.releases.length,2);
  const ra=w.releases.find(x=>x.projectId===a), rb=w.releases.find(x=>x.projectId===b);
  assert.equal(ra.version,'v0.4.0'); assert.equal(rb.version,'v0.4.0'); assert.equal(ra.published,false);
  assert.equal(w.tasks.find(x=>x.title==='Fix A').releaseId,ra.id); assert.equal(w.tasks.find(x=>x.title==='Feature A').releaseId,ra.id); assert.equal(w.tasks.find(x=>x.title==='Fix B').releaseId,rb.id);
  const fix=w.tasks.find(x=>x.title==='Fix A'); db.saveTask(fix.id,{...fix,releaseId:null}); db.publishRelease(ra.id); db.close();
  db=new PlannerDatabase(file); w=db.read(); assert.equal(w.releases.length,2); assert.equal(w.tasks.find(x=>x.id===fix.id).releaseId,null); assert.equal(w.releases.find(x=>x.id===ra.id).published,true); db.close();
});

test('parallel releases enforce project and publication rules without losing shipped items', t => {
  const file=tempDatabase(t); let db=new PlannerDatabase(file);
  for(const name of ['App','Other']) db.saveProject(null,{title:name,kind:'software',priority:'normal',description:''});
  const project=db.read().projects.find(x=>x.title==='App').id, other=db.read().projects.find(x=>x.title==='Other').id;
  db.createRelease(project,'v0.4.0'); db.createRelease(project,'v0.5.0'); db.createRelease(other,'v0.4.0');
  assert.throws(()=>db.createRelease(project,'v0.4.0'),/bereits vorhanden/);
  let w=db.read(); const v04=w.releases.find(x=>x.projectId===project&&x.version==='v0.4.0').id, v05=w.releases.find(x=>x.projectId===project&&x.version==='v0.5.0').id, foreign=w.releases.find(x=>x.projectId===other).id;
  db.saveTask(null,fields('Fix',{kind:'fix',projectId:project,releaseId:v04})); db.saveTask(null,fields('Feature',{kind:'feature',projectId:project,releaseId:v05}));
  const fix=find(db,'Fix'); db.publishRelease(v04);
  assert.throws(()=>db.saveTask(null,fields('Nachträglich',{kind:'fix',projectId:project,releaseId:v04})),/geplantes Release/);
  assert.throws(()=>db.saveTask(null,fields('Anderes Projekt',{kind:'fix',projectId:project,releaseId:foreign})),/geplantes Release/);
  assert.throws(()=>db.saveTask(null,fields('Aufgabe',{projectId:project,releaseId:v05})),/geplantes Release/);
  db.saveTask(fix.id,{...fix,description:'Bearbeitet'});
  db.close(); db=new PlannerDatabase(file); w=db.read();
  assert.equal(w.releases.find(x=>x.id===v04).published,true); assert.equal(w.releases.find(x=>x.id===v05).published,false);
  assert.equal(w.tasks.find(x=>x.id===fix.id).releaseId,v04); assert.equal(w.tasks.find(x=>x.id===fix.id).targetVersion,'v0.4.0');
  assert.equal(w.tasks.find(x=>x.title==='Feature').releaseId,v05); db.close();
});

test('releases can be renamed and assigned an optional due date without losing their content', t => {
  const file=tempDatabase(t); let db=new PlannerDatabase(file);
  db.saveProject(null,{title:'App',priority:'normal',description:'',kind:'software'}); const project=db.read().projects[0].id;
  db.createRelease(project,'v0.4.0','2026-12-15'); db.createRelease(project,'v0.5.0');
  const release=db.read().releases.find(x=>x.version==='v0.4.0');
  db.saveTask(null,fields('Fix',{kind:'fix',projectId:project,releaseId:release.id}));
  db.renameRelease(release.id,'v0.4.1','2026-12-20');
  assert.equal(find(db,'Fix').releaseId,release.id); assert.equal(find(db,'Fix').targetVersion,'v0.4.1');
  assert.throws(()=>db.renameRelease(release.id,'v0.5.0',null),/bereits vorhanden/);
  assert.throws(()=>db.renameRelease(release.id,'v0.4.2','2026-02-30'),/Fälligkeitsdatum/);
  db.publishRelease(release.id); db.renameRelease(release.id,'v0.4.2',null); db.close();
  db=new PlannerDatabase(file); const result=db.read().releases.find(x=>x.id===release.id);
  assert.equal(result.version,'v0.4.2'); assert.equal(result.dueDate,null); assert.equal(result.published,true);
  assert.equal(find(db,'Fix').targetVersion,'v0.4.2'); db.close();
});

test('existing releases receive an empty due date without losing assignments or publication state', t => {
  const file=tempDatabase(t); let db=new PlannerDatabase(file);
  db.saveProject(null,{title:'App',kind:'software',priority:'normal',description:''}); const project=db.read().projects[0].id;
  db.createRelease(project,'v1'); const release=db.read().releases[0].id;
  db.saveTask(null,fields('Fix',{kind:'fix',projectId:project,releaseId:release})); db.publishRelease(release); db.close();
  const old=new DatabaseSync(file); old.exec('ALTER TABLE releases DROP COLUMN due_date'); old.close();
  db=new PlannerDatabase(file); const workspace=db.read();
  assert.equal(workspace.releases[0].dueDate,null); assert.equal(workspace.releases[0].published,true);
  assert.equal(workspace.tasks[0].releaseId,release); assert.equal(workspace.tasks[0].targetVersion,'v1'); db.close();
});

test('deleting a release preserves linked features and fixes, clears their assignments and rolls back on failure', t => {
  const file=tempDatabase(t); let db=new PlannerDatabase(file);
  db.saveProject(null,{title:'App',priority:'normal',description:'',kind:'software'}); const project=db.read().projects[0].id;
  db.createRelease(project,'v1','2026-12-20'); db.createRelease(project,'v2');
  const old=db.read().releases.find(r=>r.version==='v1').id, other=db.read().releases.find(r=>r.version==='v2').id;
  db.saveTask(null,fields('Feature',{projectId:project,kind:'feature',releaseId:old,description:'bleibt'}));
  db.saveTask(null,fields('Fix',{projectId:project,kind:'fix',releaseId:old,criteria:[{id:null,text:'geprüft',completed:true}]}));
  db.saveTask(null,fields('Anderer Fix',{projectId:project,kind:'fix',releaseId:other}));
  db.publishRelease(old);
  const external=new DatabaseSync(file); external.exec("CREATE TRIGGER refuse_release_delete BEFORE DELETE ON releases BEGIN SELECT RAISE(ABORT, 'test failure'); END;"); external.close();
  assert.throws(()=>db.deleteRelease(old),/test failure/);
  assert.equal(find(db,'Feature').releaseId,old); assert.equal(find(db,'Fix').releaseId,old);
  const external2=new DatabaseSync(file); external2.exec('DROP TRIGGER refuse_release_delete'); external2.close();
  db.deleteRelease(old); assert.throws(()=>db.deleteRelease(old),/nicht gefunden/); db.close();
  db=new PlannerDatabase(file); const w=db.read();
  assert.equal(w.releases.length,1); assert.equal(w.releases[0].id,other);
  assert.equal(find(db,'Feature').releaseId,null); assert.equal(find(db,'Feature').targetVersion,null); assert.equal(find(db,'Feature').description,'bleibt');
  assert.equal(find(db,'Fix').releaseId,null); assert.equal(find(db,'Fix').criteria[0].completed,true); assert.equal(find(db,'Anderer Fix').releaseId,other);
  db.close();
});
