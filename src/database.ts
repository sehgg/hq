import { DatabaseSync } from 'node:sqlite';
import type { Priority, Project, ProjectFields, Task, TaskFields, TaskStatus, Subtask, Workspace, Release, ReleaseStatus, HistoryKind, HistoryEntry } from './shared';
const byPriority = "CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END";
function title(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw new Error('Der Name muss zwischen 1 und 120 Zeichen haben.'); return value.trim(); }
function description(value: unknown): string { if (typeof value !== 'string' || value.length > 10000) throw new Error('Die Beschreibung ist ungültig.'); return value.trim(); }
function priority(value: unknown): Priority { if (value !== 'high' && value !== 'normal' && value !== 'low') throw new Error('Diese Priorität ist ungültig.'); return value; }
function identifier(value: number): number { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Dieser Eintrag ist ungültig.'); return value; }
function validDate(value: unknown): string | null { if (value === null) return null; if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Das Fälligkeitsdatum ist ungültig.'); return value; }
function status(value: unknown): TaskStatus { if (value !== 'planned' && value !== 'in_progress' && value !== 'paused' && value !== 'done') throw new Error('Dieser Status ist ungültig.'); return value; }
export class PlannerDatabase {
 private readonly db: DatabaseSync;
 constructor(path: string) {
  this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  this.db.exec('PRAGMA busy_timeout = 5000');
  this.db.exec(`CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120), priority TEXT NOT NULL CHECK (priority IN ('low','normal','high'))) STRICT;
  CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120), priority TEXT NOT NULL CHECK (priority IN ('low','normal','high')), project_id INTEGER REFERENCES projects(id), completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1))) STRICT;`);
  this.db.exec('PRAGMA foreign_keys = OFF');
  this.db.exec('BEGIN IMMEDIATE');
  try {
   const columns = (table: string) => new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {name:string}[]).map(c => c.name));
   const pc = columns('projects'); const tc = columns('tasks');
   if (!pc.has('kind')) this.db.exec("ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal','software'))");
   if (!tc.has('kind')) this.db.exec("ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task','feature'))");
   if (!pc.has('due_date')) this.db.exec('ALTER TABLE projects ADD COLUMN due_date TEXT');
   if (!pc.has('description')) this.db.exec("ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''");
   if (!tc.has('feature_id')) this.db.exec('ALTER TABLE tasks ADD COLUMN feature_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL');
   if (!tc.has('target_version')) this.db.exec('ALTER TABLE tasks ADD COLUMN target_version TEXT');
   if (!tc.has('description')) this.db.exec("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''");
   if (!tc.has('due_date')) this.db.exec('ALTER TABLE tasks ADD COLUMN due_date TEXT');
   if (!tc.has('status')) { this.db.exec("ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','paused','done'))"); this.db.exec("UPDATE tasks SET status = 'done' WHERE completed = 1"); }
   const taskSchema = this.db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name='tasks'").get() as {sql:string};
   if (!taskSchema.sql.includes("'fix'")) {
    const auxiliary = this.db.prepare("SELECT sql FROM sqlite_schema WHERE tbl_name='tasks' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as unknown as {sql:string}[];
    this.db.exec(`CREATE TABLE tasks_new (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
     priority TEXT NOT NULL CHECK (priority IN ('low','normal','high')),
     project_id INTEGER REFERENCES projects(id),
     completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)),
     kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task','feature','fix')),
     description TEXT NOT NULL DEFAULT '', due_date TEXT,
     status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','paused','done')),
     target_version TEXT, feature_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL
    ) STRICT;
    INSERT INTO tasks_new (id,title,priority,project_id,completed,kind,description,due_date,status,target_version,feature_id)
     SELECT id,title,priority,project_id,completed,kind,description,due_date,status,target_version,feature_id FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;`);
    for (const object of auxiliary) this.db.exec(object.sql);
   }
   this.db.exec(`CREATE TABLE IF NOT EXISTS releases (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
    version TEXT NOT NULL CHECK (length(trim(version)) BETWEEN 1 AND 120),
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
    UNIQUE(project_id,version)
   ) STRICT;`);
   const releaseColumns = columns('releases');
   if (!releaseColumns.has('due_date')) this.db.exec('ALTER TABLE releases ADD COLUMN due_date TEXT');
   if (!releaseColumns.has('status')) {
    this.db.exec("ALTER TABLE releases ADD COLUMN status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','paused','published'))");
    this.db.exec("UPDATE releases SET status='published' WHERE published=1");
   }
   if (!tc.has('release_id')) {
    this.db.exec(`ALTER TABLE tasks ADD COLUMN release_id INTEGER REFERENCES releases(id);
     INSERT INTO releases (project_id, version)
      SELECT DISTINCT t.project_id, trim(t.target_version) FROM tasks t JOIN projects p ON p.id=t.project_id
      WHERE t.kind IN ('feature','fix') AND p.kind='software' AND t.target_version IS NOT NULL AND length(trim(t.target_version))>0
      ON CONFLICT(project_id,version) DO NOTHING;
     UPDATE tasks SET release_id=(SELECT r.id FROM releases r WHERE r.project_id=tasks.project_id AND r.version=trim(tasks.target_version))
      WHERE kind IN ('feature','fix') AND target_version IS NOT NULL AND length(trim(target_version))>0;`);
   }
   this.db.exec(`CREATE TABLE IF NOT EXISTS subtasks (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120), completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1))) STRICT;
   CREATE TABLE IF NOT EXISTS acceptance_criteria (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 1000), completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1)), position INTEGER NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS task_dependencies (predecessor_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, successor_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, PRIMARY KEY (predecessor_id, successor_id), CHECK (predecessor_id != successor_id)) STRICT;`);
   this.db.exec('CREATE TABLE IF NOT EXISTS workspace_revision (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL) STRICT; INSERT OR IGNORE INTO workspace_revision VALUES (1,0)');
   for (const table of ['projects','tasks','releases','subtasks','acceptance_criteria','task_dependencies']) for (const action of ['INSERT','UPDATE','DELETE']) this.db.exec(`CREATE TRIGGER IF NOT EXISTS revision_${table}_${action.toLowerCase()} AFTER ${action} ON ${table} BEGIN UPDATE workspace_revision SET revision=revision+1 WHERE id=1; END`);
   this.db.exec(`CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY, entity_kind TEXT NOT NULL, entity_id INTEGER NOT NULL, project_id INTEGER,
    entity_title TEXT NOT NULL, date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    field TEXT NOT NULL, old_value TEXT, new_value TEXT, manual INTEGER NOT NULL DEFAULT 0
   ) STRICT;
   CREATE TRIGGER IF NOT EXISTS revision_history_insert AFTER INSERT ON history BEGIN UPDATE workspace_revision SET revision=revision+1 WHERE id=1; END;`);
   this.db.exec('UPDATE tasks SET feature_id=NULL WHERE feature_id IS NOT NULL');
   if (this.db.prepare('PRAGMA foreign_key_check').get()) throw new Error('Die Datenbank enthält ungültige Verknüpfungen.');
   this.db.exec('COMMIT');
  } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  finally { this.db.exec('PRAGMA foreign_keys = ON'); }
 }
 read(): Workspace {
  this.db.exec('SAVEPOINT workspace_read');
  try {
  const revision = (this.db.prepare('SELECT revision FROM workspace_revision WHERE id=1').get() as {revision:number}).revision;
  const projects = this.db.prepare(`SELECT id, title, priority, description, kind, due_date AS dueDate FROM projects ORDER BY ${byPriority}, id DESC`).all() as unknown as Project[];
  const releases = this.db.prepare('SELECT id, project_id AS projectId, version, due_date AS dueDate, status, published FROM releases ORDER BY id DESC').all() as unknown as Array<Omit<Release,'published'> & {published:number}>;
  const rows = this.db.prepare(`SELECT t.id, t.title, t.priority, t.description, t.kind, t.feature_id AS featureId, t.release_id AS releaseId, r.version AS targetVersion, t.project_id AS projectId, t.due_date AS dueDate, t.status, t.completed FROM tasks t LEFT JOIN releases r ON r.id=t.release_id ORDER BY t.due_date IS NULL, t.due_date ASC, CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.id DESC`).all() as unknown as Array<Omit<Task,'completed'|'predecessorIds'|'successorIds'|'criteria'> & {completed:number}>;
  const edges = this.db.prepare('SELECT predecessor_id AS predecessorId, successor_id AS successorId FROM task_dependencies').all() as unknown as {predecessorId:number; successorId:number}[];
  const criteria = this.db.prepare('SELECT id, task_id AS taskId, text, completed FROM acceptance_criteria ORDER BY position, id').all() as unknown as {id:number; taskId:number; text:string; completed:number}[];
  const subs = this.db.prepare('SELECT id, task_id AS taskId, title, completed FROM subtasks ORDER BY id').all() as unknown as Array<Omit<Subtask,'completed'> & {completed:number}>;
  const history = (this.db.prepare('SELECT id, entity_kind AS entityKind, entity_id AS entityId, project_id AS projectId, entity_title AS entityTitle, date, field, old_value AS oldValue, new_value AS newValue, manual FROM history ORDER BY id DESC').all() as unknown as Array<Omit<HistoryEntry,'manual'> & {manual:number}>).map(entry => ({...entry, manual: !!entry.manual}));
  const workspace = { revision, history, releases: releases.map(r => ({...r, published: !!r.published})), projects, tasks: rows.map(row => ({...row, completed: !!row.completed, criteria: criteria.filter(c => c.taskId === row.id).map(c => ({id:c.id, text:c.text, completed:!!c.completed})), predecessorIds: edges.filter(e => e.successorId === row.id).map(e => e.predecessorId), successorIds: edges.filter(e => e.predecessorId === row.id).map(e => e.successorId)})), subtasks: subs.map(s => ({...s, completed: !!s.completed})) };
  this.db.exec('RELEASE workspace_read'); return workspace;
  } catch (error) { this.db.exec('ROLLBACK TO workspace_read; RELEASE workspace_read'); throw error; }
 }
 mutate<T>(expectedRevision: number, operation: () => T): T {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Der Datenstand ist ungültig.');
  this.db.exec('BEGIN IMMEDIATE');
  try {
   const revision = (this.db.prepare('SELECT revision FROM workspace_revision WHERE id=1').get() as {revision:number}).revision;
   if (revision !== expectedRevision) throw new Error('Der Arbeitsbereich wurde zwischenzeitlich geändert. Bitte neu laden und erneut versuchen.');
   const before = this.read();
   const result = operation();
   this.recordChanges(before, this.read());
   const refreshed = result && typeof result === 'object' && 'revision' in result ? this.read() as T : result;
   this.db.exec('COMMIT'); return refreshed;
  } catch (error) { this.db.exec('ROLLBACK'); throw error; }
 }
 private nextEntityId(table: 'projects' | 'tasks' | 'releases', kind: HistoryKind): number {
  const row = this.db.prepare(`SELECT max(COALESCE((SELECT max(id) FROM ${table}),0), COALESCE((SELECT max(entity_id) FROM history WHERE entity_kind=?),0)) + 1 AS id`).get(kind) as {id:number};
  return row.id;
 }
 private recordChanges(before: Workspace, after: Workspace): void {
  const insert = this.db.prepare('INSERT INTO history (entity_kind,entity_id,project_id,entity_title,field,old_value,new_value) VALUES (?,?,?,?,?,?,?)');
  const emit = (kind: HistoryKind, id: number, projectId: number | null, name: string, field: string, oldValue: string | null, newValue: string | null) => {
   insert.run(kind,id,projectId,name,field,oldValue,newValue);
  };
  const value = (item: unknown): string | null => {
   if (item === null || item === undefined || item === '') return null;
   if (Array.isArray(item)) return item.length ? JSON.stringify(item) : null;
   return String(item);
  };
  const compare = (kind: HistoryKind, oldItems: any[], newItems: any[], fields: [string,string][]) => {
   const ids = new Set([...oldItems.map(item => item.id), ...newItems.map(item => item.id)]);
   for (const id of ids) {
    const old = oldItems.find(item => item.id === id);
    const next = newItems.find(item => item.id === id);
    const item = next ?? old;
    const name = kind === 'release' ? item.version : item.title;
    const projectId = kind === 'project' ? id : item.projectId;
    const record = (field: string, previous: string | null, current: string | null) => {
     emit(kind,id,projectId,name,field,previous,current);
     if (kind === 'task' && old && next && old.projectId !== next.projectId && old.projectId !== null)
      emit('project',old.projectId,old.projectId,name, `${name} · ${field}`,previous,current);
    };
    if (!old || !next) { record(next ? 'Erstellt' : 'Gelöscht', old ? name : null, next ? name : null); continue; }
    for (const [key, label] of fields) {
     if (kind === 'task' && key === 'projectName' && old.projectId === next.projectId) continue;
     if (kind === 'task' && key === 'releaseName' && old.releaseId === next.releaseId) continue;
     if (kind === 'task' && key === 'predecessorNames' && JSON.stringify(old.predecessorIds) === JSON.stringify(next.predecessorIds)) continue;
     if (kind === 'task' && key === 'successorNames' && JSON.stringify(old.successorIds) === JSON.stringify(next.successorIds)) continue;
     const previous = value(old[key]), current = value(next[key]);
     if (previous !== current) record(label,previous,current);
    }
   }
  };
  compare('project',before.projects,after.projects,[['title','Titel'],['description','Beschreibung'],['priority','Priorität'],['kind','Projekttyp'],['dueDate','Fälligkeit']]);
  compare('release',before.releases,after.releases,[['version','Version'],['dueDate','Fälligkeit'],['status','Status']]);
  const childChanges = (label: string, oldChildren: {id:number; taskId:number; text:string; completed:boolean}[], newChildren: {id:number; taskId:number; text:string; completed:boolean}[]) => {
   for (const id of new Set([...oldChildren.map(child => child.id), ...newChildren.map(child => child.id)])) {
    const old = oldChildren.find(child => child.id === id), next = newChildren.find(child => child.id === id);
    const child = next ?? old!;
    const task = after.tasks.find(item => item.id === child.taskId) ?? before.tasks.find(item => item.id === child.taskId);
    if (!task) continue;
    const format = (entry: typeof child | undefined) => entry ? `${entry.text} (${entry.completed ? 'erledigt' : 'offen'})` : null;
    if (format(old) !== format(next)) emit('task',task.id,task.projectId,task.title,label,format(old),format(next));
   }
  };
  childChanges('Unteraufgabe',before.subtasks.map(s => ({...s,text:s.title})),after.subtasks.map(s => ({...s,text:s.title})));
  const criteria = (workspace: Workspace) => workspace.tasks.flatMap(task => task.criteria.map(criterion => ({...criterion,id:criterion.id!,taskId:task.id})));
  childChanges('Akzeptanzkriterium',criteria(before),criteria(after));
  const tasks = (workspace: Workspace) => workspace.tasks.map(task => ({
   ...task,
   criteria: task.criteria.map(({text,completed}) => ({text,completed})),
   subtasks: workspace.subtasks.filter(subtask => subtask.taskId === task.id).map(({title,completed}) => ({title,completed})),
   projectName: workspace.projects.find(project => project.id === task.projectId)?.title ? `${workspace.projects.find(project => project.id === task.projectId)!.title} (#${task.projectId})` : (task.projectId === null ? 'Posteingang' : String(task.projectId)),
   releaseName: workspace.releases.find(release => release.id === task.releaseId)?.version ?? null,
   predecessorNames: [...task.predecessorIds].sort((a,b) => a-b).map(id => workspace.tasks.find(item => item.id === id)?.title ?? String(id)),
   successorNames: [...task.successorIds].sort((a,b) => a-b).map(id => workspace.tasks.find(item => item.id === id)?.title ?? String(id)),
  }));
  compare('task',tasks(before),tasks(after),[['title','Titel'],['description','Beschreibung'],['priority','Priorität'],['kind','Typ'],['projectName','Projekt'],['dueDate','Fälligkeit'],['status','Status'],['releaseName','Release'],['predecessorNames','Vorgänger'],['successorNames','Folgeaufgaben']]);
 }
 addHistoryNote(kind: HistoryKind, id: number, text: string): void {
  identifier(id);
  if (!['project','task','release'].includes(kind)) throw new Error('Dieser Eintrag ist ungültig.');
  const note = description(text);
  if (!note) throw new Error('Die Meldung darf nicht leer sein.');
  const workspace = this.read();
  const item = kind === 'project' ? workspace.projects.find(project => project.id === id) : kind === 'task' ? workspace.tasks.find(task => task.id === id) : workspace.releases.find(release => release.id === id);
  if (!item) throw new Error('Der Eintrag wurde nicht gefunden.');
  const projectId = kind === 'project' ? id : (item as Task | Release).projectId;
  const name = 'version' in item ? item.version : item.title;
  this.db.prepare('INSERT INTO history (entity_kind,entity_id,project_id,entity_title,field,new_value,manual) VALUES (?,?,?,?,?,?,1)').run(kind,id,projectId,name,'Meldung',note);
 }
 saveProject(id: number | null, fields: ProjectFields): void {
  if (fields.kind !== 'normal' && fields.kind !== 'software') throw new Error('Der Projekttyp ist ungültig.');
  const deadline = validDate(fields.dueDate ?? null);
  const args = [title(fields.title), priority(fields.priority), description(fields.description), fields.kind, deadline] as const;
  if (id === null) { this.db.prepare('INSERT INTO projects (id, title, priority, description, kind, due_date) VALUES (?, ?, ?, ?, ?, ?)').run(this.nextEntityId('projects','project'), ...args); return; }
  identifier(id);
  this.db.exec('SAVEPOINT hq_operation');
  try {
   if (fields.kind === 'normal' && (this.db.prepare("SELECT 1 FROM tasks WHERE project_id=? AND kind IN ('feature','fix')").get(id) || this.db.prepare('SELECT 1 FROM releases WHERE project_id=?').get(id))) throw new Error('Verschiebe zuerst die Features und Fixes in ein anderes Softwareprojekt.');
   if (deadline !== null) {
    const conflicts = this.db.prepare('SELECT title, due_date AS dueDate FROM tasks WHERE project_id=? AND due_date>? ORDER BY due_date, id').all(id,deadline) as unknown as {title:string;dueDate:string}[];
    if (conflicts.length) throw new Error('Diese Einträge liegen nach der Projektfrist: ' + conflicts.map(item => `${item.title} (${item.dueDate.split('-').reverse().join('.')})`).join('; '));
   }
   if (!this.db.prepare('UPDATE projects SET title=?, priority=?, description=?, kind=?, due_date=? WHERE id=?').run(...args, id).changes) throw new Error('Das Projekt wurde nicht gefunden.');
   this.db.exec('RELEASE hq_operation');
  } catch (error) { this.db.exec('ROLLBACK TO hq_operation; RELEASE hq_operation'); throw error; }
 }
 createRelease(projectId: number, version: string, dueDate: string | null = null): void {
  identifier(projectId); const name = title(version); const date = validDate(dueDate);
  if (!this.db.prepare("SELECT 1 FROM projects WHERE id=? AND kind='software'").get(projectId)) throw new Error('Releases benötigen ein Softwareprojekt.');
  if (this.db.prepare('SELECT 1 FROM releases WHERE project_id=? AND version=?').get(projectId,name)) throw new Error('Diese Version ist in diesem Projekt bereits vorhanden.');
  this.db.prepare('INSERT INTO releases (id,project_id,version,due_date) VALUES (?,?,?,?)').run(this.nextEntityId('releases','release'),projectId,name,date);
 }
 renameRelease(id: number, version: string, dueDate: string | null, status?: ReleaseStatus): void {
  identifier(id); const name = title(version); const date = validDate(dueDate);
  if (status !== undefined && !['planned','in_progress','paused','published'].includes(status)) throw new Error('Der Releasestatus ist ungültig.');
  const release = this.db.prepare('SELECT project_id AS projectId, status FROM releases WHERE id=?').get(id) as {projectId: number; status: ReleaseStatus} | undefined;
  if (!release) throw new Error('Das Release wurde nicht gefunden.');
  if (this.db.prepare('SELECT 1 FROM releases WHERE project_id=? AND version=? AND id<>?').get(release.projectId,name,id)) throw new Error('Diese Version ist in diesem Projekt bereits vorhanden.');
  const nextStatus = status ?? release.status;
  if (nextStatus === 'published' && release.status !== 'published') this.ensureReleaseCanPublish(id);
  this.db.prepare('UPDATE releases SET version=?, due_date=?, published=?, status=? WHERE id=?').run(name,date,Number(nextStatus === 'published'),nextStatus,id);
 }
 deleteRelease(id: number): void {
  identifier(id);
  this.db.exec('SAVEPOINT hq_operation');
  try {
   if (!this.db.prepare('SELECT 1 FROM releases WHERE id=?').get(id)) throw new Error('Das Release wurde nicht gefunden.');
   this.db.prepare('UPDATE tasks SET release_id=NULL, target_version=NULL WHERE release_id=?').run(id);
   this.db.prepare('DELETE FROM releases WHERE id=?').run(id);
   this.db.exec('RELEASE hq_operation');
  } catch (error) { this.db.exec('ROLLBACK TO hq_operation; RELEASE hq_operation'); throw error; }
 }
 private ensureReleaseCanPublish(id: number): void {
  const open = this.db.prepare("SELECT title, kind FROM tasks WHERE release_id=? AND status<>'done' ORDER BY id").all(id) as unknown as {title:string; kind:string}[];
  if (open.length) throw new Error('Schließe zuerst diese Einträge ab: ' + open.map(item => `${item.kind === 'task' ? 'Aufgabe' : item.kind === 'fix' ? 'Fix' : 'Feature'}: ${item.title}`).join('; '));
 }
 publishRelease(id: number): void {
  identifier(id);
  if (!this.db.prepare('SELECT 1 FROM releases WHERE id=? AND published=0').get(id)) throw new Error('Das Release wurde nicht gefunden oder ist bereits veröffentlicht.');
  this.ensureReleaseCanPublish(id);
  this.db.prepare("UPDATE releases SET published=1, status='published' WHERE id=?").run(id);
 }
 private ensureCanComplete(id: number): void {
  if (this.db.prepare('SELECT 1 FROM subtasks WHERE task_id=? AND completed=0').get(id)) throw new Error('Schließe zuerst alle Unteraufgaben ab.');
  if (this.db.prepare('SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id=d.predecessor_id WHERE d.successor_id=? AND t.completed=0').get(id)) throw new Error('Schließe zuerst alle Vorgänger ab.');
 }
 private ensureCanReopen(id: number): void { if (this.db.prepare('SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id=d.successor_id WHERE d.predecessor_id=? AND t.completed=1').get(id)) throw new Error('Öffne zuerst die erledigten Folgeaufgaben wieder.'); }
 saveTask(id: number | null, fields: TaskFields): void {
  const name=title(fields.title), rank=priority(fields.priority), desc=description(fields.description), state=status(fields.status);
  const projectId=fields.projectId === null ? null : identifier(fields.projectId);
  if (fields.kind !== 'task' && fields.kind !== 'feature' && fields.kind !== 'fix') throw new Error('Der Aufgabentyp ist ungültig.');
  if (fields.kind !== 'task' && (projectId === null || !this.db.prepare("SELECT 1 FROM projects WHERE id=? AND kind='software'").get(projectId))) throw new Error('Features und Fixes benötigen ein Softwareprojekt.');
  const releaseId = fields.releaseId === null ? null : identifier(fields.releaseId);
  if (releaseId !== null) {
   const release = this.db.prepare('SELECT project_id AS projectId, published FROM releases WHERE id=?').get(releaseId) as {projectId:number; published:number} | undefined;
   const existing = id === null ? undefined : this.db.prepare('SELECT release_id AS releaseId FROM tasks WHERE id=?').get(identifier(id)) as {releaseId:number | null} | undefined;
   if (!release || release.projectId !== projectId || (release.published && existing?.releaseId !== releaseId)) throw new Error('Wähle ein geplantes Release desselben Softwareprojekts.');
  }
  if (!Array.isArray(fields.criteria)) throw new Error('Die Akzeptanzkriterien sind ungültig.');
  if (fields.kind === 'task' && fields.criteria.length) throw new Error('Akzeptanzkriterien gehören zu einem Feature oder Fix.');
  const criteria = fields.criteria.map(criterion => {
   if (!criterion || typeof criterion.text !== 'string' || !criterion.text.trim() || criterion.text.trim().length > 1000 || typeof criterion.completed !== 'boolean') throw new Error('Ein Akzeptanzkriterium muss zwischen 1 und 1000 Zeichen haben.');
   return { id: criterion.id === null ? null : identifier(criterion.id), text: criterion.text.trim(), completed: criterion.completed };
  });
  const existingIds = criteria.filter(c => c.id !== null).map(c => c.id);
  if (new Set(existingIds).size !== existingIds.length) throw new Error('Ein Akzeptanzkriterium wurde mehrfach angegeben.');
  if (fields.featureId !== null) throw new Error('Aufgaben-Zuordnungen werden nicht mehr unterstützt.');
  const featureId = null;
  const due=validDate(fields.dueDate);
  if (!Array.isArray(fields.predecessorIds)) throw new Error('Die Vorgänger sind ungültig.');
  const predecessors = [...new Set(fields.predecessorIds.map(identifier))];
  this.db.exec('SAVEPOINT hq_operation');
  try {
   if (projectId !== null && due !== null) {
    const project = this.db.prepare('SELECT due_date AS dueDate FROM projects WHERE id=?').get(projectId) as {dueDate:string | null} | undefined;
    if (!project) throw new Error('Das Projekt wurde nicht gefunden.');
    if (project.dueDate !== null && due > project.dueDate) throw new Error(`Das Fälligkeitsdatum darf nicht nach der Projektfrist am ${project.dueDate.split('-').reverse().join('.')} liegen.`);
   }
   let taskId: number;
   if (id === null) { taskId=Number(this.db.prepare('INSERT INTO tasks (id,title,priority,description,project_id,due_date,status,completed,kind) VALUES (?,?,?,?,?,?,?,?,?)').run(this.nextEntityId('tasks','task'),name,rank,desc,projectId,due,'planned',0,fields.kind).lastInsertRowid); }
   else { taskId=identifier(id); if (!this.db.prepare('SELECT 1 FROM tasks WHERE id=?').get(taskId)) throw new Error('Die Aufgabe wurde nicht gefunden.'); }
   for (const criterion of criteria) if (criterion.id !== null && !this.db.prepare('SELECT 1 FROM acceptance_criteria WHERE id=? AND task_id=?').get(criterion.id, taskId)) throw new Error('Das Akzeptanzkriterium wurde nicht gefunden.');
   if (state !== 'done') this.ensureCanReopen(taskId);
   this.db.prepare('DELETE FROM task_dependencies WHERE successor_id=?').run(taskId);
   for (const predecessor of predecessors) {
    if (predecessor === taskId || this.db.prepare(`WITH RECURSIVE reachable(id) AS (SELECT successor_id FROM task_dependencies WHERE predecessor_id=? UNION SELECT d.successor_id FROM task_dependencies d JOIN reachable r ON d.predecessor_id=r.id) SELECT 1 FROM reachable WHERE id=?`).get(taskId,predecessor)) throw new Error('Diese Verknüpfung würde einen Kreis erzeugen.');
    this.db.prepare('INSERT INTO task_dependencies (predecessor_id,successor_id) VALUES (?,?)').run(predecessor,taskId);
   }
   if (state === 'done') this.ensureCanComplete(taskId);
   this.db.prepare('UPDATE tasks SET title=?, priority=?, description=?, project_id=?, due_date=?, status=?, completed=?, kind=?, target_version=NULL, feature_id=?, release_id=? WHERE id=?').run(name,rank,desc,projectId,due,state,Number(state==='done'),fields.kind,featureId,releaseId,taskId);
   this.db.prepare('DELETE FROM acceptance_criteria WHERE task_id=?').run(taskId);
   for (const [position, criterion] of criteria.entries()) if (criterion.id !== null) this.db.prepare('INSERT INTO acceptance_criteria (id,task_id,text,completed,position) VALUES (?,?,?,?,?)').run(criterion.id,taskId,criterion.text,Number(criterion.completed),position);
   for (const [position, criterion] of criteria.entries()) if (criterion.id === null) this.db.prepare('INSERT INTO acceptance_criteria (task_id,text,completed,position) VALUES (?,?,?,?)').run(taskId,criterion.text,Number(criterion.completed),position);
   this.db.exec('RELEASE hq_operation');
  } catch(error) { this.db.exec('ROLLBACK TO hq_operation; RELEASE hq_operation'); throw error; }
 }
 deleteTask(id: number): void {
  identifier(id);
  this.db.exec('SAVEPOINT hq_operation');
  try {
   if (!this.db.prepare('SELECT 1 FROM tasks WHERE id=?').get(id)) throw new Error('Der Eintrag wurde nicht gefunden.');
   this.db.prepare('UPDATE tasks SET feature_id=NULL WHERE feature_id=?').run(id);
   this.db.prepare('DELETE FROM task_dependencies WHERE predecessor_id=? OR successor_id=?').run(id,id);
   this.db.prepare('DELETE FROM subtasks WHERE task_id=?').run(id);
   this.db.prepare('DELETE FROM acceptance_criteria WHERE task_id=?').run(id);
   this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
   this.db.exec('RELEASE hq_operation');
  } catch (error) { this.db.exec('ROLLBACK TO hq_operation; RELEASE hq_operation'); throw error; }
 }

 completeTask(id: number, completed: boolean): void {
  identifier(id); if (typeof completed !== 'boolean') throw new Error('Dieser Aufgabenstatus ist ungültig.');
  if (completed) this.ensureCanComplete(id); else this.ensureCanReopen(id);
  if (!this.db.prepare('UPDATE tasks SET completed=?, status=? WHERE id=?').run(Number(completed),completed?'done':'planned',id).changes) throw new Error('Die Aufgabe wurde nicht gefunden.');
 }
 addSubtask(taskId: number, value: string): void {
  identifier(taskId); if (this.db.prepare('SELECT 1 FROM tasks WHERE id=? AND completed=1').get(taskId)) throw new Error('Öffne die Aufgabe zuerst wieder.');
  this.db.prepare('INSERT INTO subtasks (task_id,title) VALUES (?,?)').run(taskId,title(value));
 }
 completeSubtask(id: number, completed: boolean): void {
  identifier(id); if (typeof completed !== 'boolean') throw new Error('Dieser Status ist ungültig.');
  if (!completed && this.db.prepare('SELECT 1 FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE s.id=? AND t.completed=1').get(id)) throw new Error('Öffne die übergeordnete Aufgabe zuerst wieder.');
  if (!this.db.prepare('UPDATE subtasks SET completed=? WHERE id=?').run(Number(completed),id).changes) throw new Error('Die Unteraufgabe wurde nicht gefunden.');
 }
 completeCriterion(id: number, completed: boolean): void {
  identifier(id); if (typeof completed !== 'boolean') throw new Error('Dieser Status ist ungültig.');
  if (!this.db.prepare('UPDATE acceptance_criteria SET completed=? WHERE id=?').run(Number(completed),id).changes) throw new Error('Das Akzeptanzkriterium wurde nicht gefunden.');
 }
 close(): void { this.db.close(); }
}
