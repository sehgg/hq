import { DatabaseSync } from 'node:sqlite';
import type { Priority, Project, ProjectFields, Task, TaskFields, TaskStatus, Subtask, Workspace } from './shared';
const byPriority = "CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END";
function title(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw new Error('Der Name muss zwischen 1 und 120 Zeichen haben.'); return value.trim(); }
function description(value: unknown): string { if (typeof value !== 'string' || value.length > 10000) throw new Error('Die Beschreibung ist ungültig.'); return value.trim(); }
function priority(value: unknown): Priority { if (value !== 'high' && value !== 'normal' && value !== 'low') throw new Error('Diese Priorität ist ungültig.'); return value; }
function identifier(value: number): number { if (!Number.isSafeInteger(value) || value < 1) throw new Error('Dieser Eintrag ist ungültig.'); return value; }
function status(value: unknown): TaskStatus { if (value !== 'planned' && value !== 'in_progress' && value !== 'paused' && value !== 'done') throw new Error('Dieser Status ist ungültig.'); return value; }
export class PlannerDatabase {
 private readonly db: DatabaseSync;
 constructor(path: string) {
  this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  this.db.exec(`CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120), priority TEXT NOT NULL CHECK (priority IN ('low','normal','high'))) STRICT;
  CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120), priority TEXT NOT NULL CHECK (priority IN ('low','normal','high')), project_id INTEGER REFERENCES projects(id), completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1))) STRICT;`);
  this.db.exec('BEGIN');
  try {
   const columns = (table: string) => new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {name:string}[]).map(c => c.name));
   const pc = columns('projects'); const tc = columns('tasks');
   if (!pc.has('description')) this.db.exec("ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''");
   if (!tc.has('description')) this.db.exec("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''");
   if (!tc.has('due_date')) this.db.exec('ALTER TABLE tasks ADD COLUMN due_date TEXT');
   if (!tc.has('status')) { this.db.exec("ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','paused','done'))"); this.db.exec("UPDATE tasks SET status = 'done' WHERE completed = 1"); }
   this.db.exec(`CREATE TABLE IF NOT EXISTS subtasks (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120), completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0,1))) STRICT;
   CREATE TABLE IF NOT EXISTS task_dependencies (predecessor_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, successor_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, PRIMARY KEY (predecessor_id, successor_id), CHECK (predecessor_id != successor_id)) STRICT; COMMIT;`);
  } catch (error) { this.db.exec('ROLLBACK'); throw error; }
 }
 read(): Workspace {
  const projects = this.db.prepare(`SELECT id, title, priority, description FROM projects ORDER BY ${byPriority}, id DESC`).all() as unknown as Project[];
  const rows = this.db.prepare(`SELECT id, title, priority, description, project_id AS projectId, due_date AS dueDate, status, completed FROM tasks ORDER BY due_date IS NULL, due_date ASC, ${byPriority}, id DESC`).all() as unknown as Array<Omit<Task,'completed'|'predecessorIds'|'successorIds'> & {completed:number}>;
  const edges = this.db.prepare('SELECT predecessor_id AS predecessorId, successor_id AS successorId FROM task_dependencies').all() as unknown as {predecessorId:number; successorId:number}[];
  const subs = this.db.prepare('SELECT id, task_id AS taskId, title, completed FROM subtasks ORDER BY id').all() as unknown as Array<Omit<Subtask,'completed'> & {completed:number}>;
  return { projects, tasks: rows.map(row => ({...row, completed: !!row.completed, predecessorIds: edges.filter(e => e.successorId === row.id).map(e => e.predecessorId), successorIds: edges.filter(e => e.predecessorId === row.id).map(e => e.successorId)})), subtasks: subs.map(s => ({...s, completed: !!s.completed})) };
 }
 saveProject(id: number | null, fields: ProjectFields): void {
  const args = [title(fields.title), priority(fields.priority), description(fields.description)] as const;
  if (id === null) { this.db.prepare('INSERT INTO projects (title, priority, description) VALUES (?, ?, ?)').run(...args); return; }
  if (!this.db.prepare('UPDATE projects SET title=?, priority=?, description=? WHERE id=?').run(...args, identifier(id)).changes) throw new Error('Das Projekt wurde nicht gefunden.');
 }
 private ensureCanComplete(id: number): void {
  if (this.db.prepare('SELECT 1 FROM subtasks WHERE task_id=? AND completed=0').get(id)) throw new Error('Schließe zuerst alle Unteraufgaben ab.');
  if (this.db.prepare('SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id=d.predecessor_id WHERE d.successor_id=? AND t.completed=0').get(id)) throw new Error('Schließe zuerst alle Vorgänger ab.');
 }
 private ensureCanReopen(id: number): void { if (this.db.prepare('SELECT 1 FROM task_dependencies d JOIN tasks t ON t.id=d.successor_id WHERE d.predecessor_id=? AND t.completed=1').get(id)) throw new Error('Öffne zuerst die erledigten Folgeaufgaben wieder.'); }
 saveTask(id: number | null, fields: TaskFields): void {
  const name=title(fields.title), rank=priority(fields.priority), desc=description(fields.description), state=status(fields.status);
  const projectId=fields.projectId === null ? null : identifier(fields.projectId);
  const due=fields.dueDate;
  if (due !== null && (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due)) || new Date(due).toISOString().slice(0,10)!==due)) throw new Error('Das Fälligkeitsdatum ist ungültig.');
  if (!Array.isArray(fields.predecessorIds)) throw new Error('Die Vorgänger sind ungültig.');
  const predecessors = [...new Set(fields.predecessorIds.map(identifier))];
  this.db.exec('BEGIN');
  try {
   let taskId: number;
   if (id === null) { taskId=Number(this.db.prepare('INSERT INTO tasks (title,priority,description,project_id,due_date,status,completed) VALUES (?,?,?,?,?,?,?)').run(name,rank,desc,projectId,due,'planned',0).lastInsertRowid); }
   else { taskId=identifier(id); if (!this.db.prepare('SELECT 1 FROM tasks WHERE id=?').get(taskId)) throw new Error('Die Aufgabe wurde nicht gefunden.'); }
   if (state !== 'done') this.ensureCanReopen(taskId);
   this.db.prepare('DELETE FROM task_dependencies WHERE successor_id=?').run(taskId);
   for (const predecessor of predecessors) {
    if (predecessor === taskId || this.db.prepare(`WITH RECURSIVE reachable(id) AS (SELECT successor_id FROM task_dependencies WHERE predecessor_id=? UNION SELECT d.successor_id FROM task_dependencies d JOIN reachable r ON d.predecessor_id=r.id) SELECT 1 FROM reachable WHERE id=?`).get(taskId,predecessor)) throw new Error('Diese Verknüpfung würde einen Kreis erzeugen.');
    this.db.prepare('INSERT INTO task_dependencies (predecessor_id,successor_id) VALUES (?,?)').run(predecessor,taskId);
   }
   if (state === 'done') this.ensureCanComplete(taskId);
   this.db.prepare('UPDATE tasks SET title=?, priority=?, description=?, project_id=?, due_date=?, status=?, completed=? WHERE id=?').run(name,rank,desc,projectId,due,state,Number(state==='done'),taskId);
   this.db.exec('COMMIT');
  } catch(error) { this.db.exec('ROLLBACK'); throw error; }
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
 close(): void { this.db.close(); }
}
