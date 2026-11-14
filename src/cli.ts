import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PlannerDatabase } from './database';
import type { CriterionFields, Task, TaskFields, Workspace } from './shared';

class CliError extends Error { constructor(readonly code: string, message: string, readonly exitCode: number) { super(message); } }
const fail = (code: string, message: string, exitCode = 2): never => { throw new CliError(code, message, exitCode); };
const help = `HQ CLI
  hq projects [--json]
  hq project (--project NAME | --project-id ID) [--json]
  hq releases (--project NAME | --project-id ID) [--json]
  hq release-create (--project NAME | --project-id ID) --version VERSION [--due YYYY-MM-DD]
  hq tasks --project NAME [--title TEXT] [--json]
  hq tasks --all --open [--kind task|feature|fix] [--json]
  hq show (--id ID | --project NAME --title TEXT) [--json]
  hq create (--project NAME | --project-id ID | --inbox) --title TEXT [--kind task|feature|fix] [options]
  hq edit (--id ID | --project NAME --title TEXT) [--new-title TEXT] [options]
  hq done (--id ID | --project NAME --title TEXT)
  hq subtask-add --id ID --text TEXT
  hq subtask-done --subtask ID [--undo]
  hq criterion-done --criterion ID [--undo]
Options: --description TEXT --priority low|normal|high --status planned|in_progress|paused|done
  --due YYYY-MM-DD|none --predecessors ID,ID|none --release ID|none
  --criteria JSON (array of {id:null|number,text:string,completed:boolean}); --move-to PROJECT_ID
  --project-id ID selects a project with a duplicate name; --db PATH; --json
Use task IDs to resolve ambiguous matches. Tasks without a title filter are suggestions only.\n`;
const options = Object.fromEntries(['project','project-id','move-to','title','new-title','id','kind','description','priority','status','due','predecessors','release','criteria','subtask','criterion','text','version','db'].map(key => [key,{type:'string' as const}]));
let args: ReturnType<typeof parseArgs>;
try { args = parseArgs({args:process.argv.slice(2), options:{...options,json:{type:'boolean'},undo:{type:'boolean'},help:{type:'boolean'},inbox:{type:'boolean'},all:{type:'boolean'},open:{type:'boolean'}},allowPositionals:true,strict:true}); }
catch (error) {
 const message=error instanceof Error ? error.message : 'Ungültige Argumente.';
 process.stderr.write(process.argv.includes('--json') ? JSON.stringify({ok:false,error:{code:'INVALID_ARGUMENT',message}})+'\n' : `INVALID_ARGUMENT: ${message}\n`);
 process.exit(2);
}
const v = args.values as Record<string,string|boolean|undefined>;
const json = v.json === true;
const command = args.positionals[0] ?? 'help';
const str = (key:string): string | undefined => typeof v[key] === 'string' ? v[key] as string : undefined;
function integer(value:string | undefined, label:string): number {
 if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return fail('INVALID_ARGUMENT', `${label} benötigt eine positive ID.`);
 return Number(value);
}
function projectFor(w:Workspace, name:string | undefined) {
 const projectId=str('project-id');
 if (projectId) return w.projects.find(p=>p.id===integer(projectId,'--project-id')) ?? fail('NOT_FOUND','Projekt nicht gefunden.',4);
 if (!name) return fail('INVALID_ARGUMENT','--project ist erforderlich.');
 const matches=w.projects.filter(p=>p.title.toLocaleLowerCase('de')===name.toLocaleLowerCase('de'));
 if (!matches.length) return fail('NOT_FOUND',`Projekt nicht gefunden: ${name}`,4);
 if (matches.length>1) return fail('AMBIGUOUS',`Mehrere Projekte heißen ${name}: ${matches.map(p=>p.id).join(', ')}. Bitte --project-id verwenden.`,3);
 return matches[0];
}
function findTask(w:Workspace):Task {
 const id=str('id');
 let matches:Task[];
 if (id) matches=w.tasks.filter(t=>t.id===integer(id,'--id'));
 else {
  const project=projectFor(w,str('project')); const term=str('title')?.trim();
  if (!term) return fail('INVALID_ARGUMENT','--title ist erforderlich.');
  matches=w.tasks.filter(t=>t.projectId===project.id && t.title.toLocaleLowerCase('de').includes(term.toLocaleLowerCase('de')));
 }
 if (!matches.length) return fail('NOT_FOUND','Kein passender Eintrag gefunden.',4);
 if (matches.length>1) return fail('AMBIGUOUS',`Mehrere Einträge gefunden: ${matches.sort((a,b)=>a.id-b.id).map(t=>`#${t.id} ${t.title}`).join('; ')}. Bitte --id verwenden.`,3);
 return matches[0];
}
function fields(base:TaskFields):TaskFields {
 const list = str('predecessors'); const criteria=str('criteria');
 let parsed:CriterionFields[]=base.criteria;
 if (criteria !== undefined) { try { parsed=JSON.parse(criteria) as CriterionFields[]; } catch { return fail('INVALID_ARGUMENT','--criteria muss gültiges JSON enthalten.'); } }
 const optionalId=(key:string, current:number|null) => str(key)===undefined ? current : str(key)==='none' ? null : integer(str(key),`--${key}`);
 return {...base,
  title:str('new-title') ?? base.title, description:str('description') ?? base.description,
  projectId:str('move-to') === undefined ? base.projectId : integer(str('move-to'),'--move-to'),
  priority:(str('priority') ?? base.priority) as TaskFields['priority'], status:(str('status') ?? base.status) as TaskFields['status'],
  dueDate:str('due')===undefined ? base.dueDate : str('due')==='none' ? null : str('due')!,
  predecessorIds:list===undefined ? base.predecessorIds : list==='none' ? [] : list.split(',').map(s=>integer(s.trim(),'--predecessors')),
  featureId:null, releaseId:optionalId('release',base.releaseId), criteria:parsed,
 };
}
function taskDetail(w:Workspace,t:Task) { return {...t,predecessorIds:[...t.predecessorIds].sort((a,b)=>a-b),successorIds:[...t.successorIds].sort((a,b)=>a-b),subtasks:w.subtasks.filter(s=>s.taskId===t.id).sort((a,b)=>a.id-b.id)}; }
function render(data:unknown):void {
 if (json) { process.stdout.write(JSON.stringify({ok:true,data})+'\n'); return; }
 if (Array.isArray(data)) { if (!data.length) { console.log('Keine Einträge gefunden.'); return; } for (const item of data) console.log(`#${item.id} ${item.title ?? item.version} ${item.status ? `[${item.status}]` : ''}`.trim()); return; }
 if (data && typeof data==='object' && 'title' in data) {
  if (!('status' in data)) {
   const project=data as Workspace['projects'][number];
   console.log(`#${project.id} ${project.title}\nTyp: ${project.kind} · Priorität: ${project.priority}\nProjektfrist: ${project.dueDate ?? '–'}\nBeschreibung: ${project.description || '–'}`);
   return;
  }
  const item=data as Task & {subtasks?:{id:number;title:string;completed:boolean}[]};
  console.log(`#${item.id} ${item.title}\nTyp: ${item.kind} · Status: ${item.status} · Priorität: ${item.priority}\nFällig: ${item.dueDate ?? '–'} · Release: ${item.releaseId ?? '–'}\nBeschreibung: ${item.description || '–'}\nVorgänger: ${item.predecessorIds?.join(', ') || '–'}`);
  for (const sub of item.subtasks ?? []) console.log(`  [${sub.completed?'x':' '}] Unteraufgabe #${sub.id}: ${sub.title}`);
  for (const criterion of item.criteria ?? []) console.log(`  [${criterion.completed?'x':' '}] Kriterium #${criterion.id}: ${criterion.text}`);
  return;
 }
 console.log(JSON.stringify(data,null,2));
}
function listTasks(workspace: Workspace): void {
  const term = str('title')?.toLocaleLowerCase('de');
  const matchesTitle = (task: Task) => !term || task.title.toLocaleLowerCase('de').includes(term);
  if (v.all) {
    if (str('project') || str('project-id') || v.inbox)
      fail('INVALID_ARGUMENT', '--all kann nicht mit einem Projekt oder --inbox kombiniert werden.');
    const kind = str('kind');
    if (kind && !['task', 'feature', 'fix'].includes(kind))
      fail('INVALID_ARGUMENT', 'Der Aufgabentyp ist ungültig.');
    const tasks = workspace.tasks.filter(task =>
      (!v.open || !task.completed) && (!kind || task.kind === kind) && matchesTitle(task));
    renderTaskList(workspace, tasks);
    return;
  }

  const project = projectFor(workspace, str('project'));
  const tasks = workspace.tasks.filter(task =>
    task.projectId === project.id && (term ? matchesTitle(task) : isActionable(workspace, task)));
  if (!json && !term)
    console.log('Offene, umsetzbare Einträge – bitte anhand der ID auswählen:');
  renderTaskList(workspace, tasks);
}

function isActionable(workspace: Workspace, task: Task): boolean {
  return !task.completed
    && task.predecessorIds.every(id => workspace.tasks.find(item => item.id === id)?.completed)
    && workspace.subtasks.every(item => item.taskId !== task.id || item.completed);
}

function renderTaskList(workspace: Workspace, tasks: Task[]): void {
  render(tasks.sort((a, b) => a.id - b.id).map(task => taskDetail(workspace, task)));
}

function createTask(db: PlannerDatabase, workspace: Workspace) {
  if (v.inbox && (str('project') || str('project-id') || str('move-to')))
    fail('INVALID_ARGUMENT', '--inbox kann nicht mit einem Projekt kombiniert werden.');
  const projectId = v.inbox ? null : projectFor(workspace, str('project')).id;
  const title = str('title') ?? fail('INVALID_ARGUMENT', '--title ist erforderlich.');
  const base: TaskFields = {
    title, projectId, description: '', priority: 'normal', status: 'planned', dueDate: null,
    kind: (str('kind') ?? 'task') as TaskFields['kind'],
    featureId: null, releaseId: null, criteria: [], predecessorIds: [],
  };
  db.saveTask(null, fields(base));
  const next = db.read();
  const ids = new Set(workspace.tasks.map(task => task.id));
  return taskDetail(next, next.tasks.find(task => !ids.has(task.id))!);
}

function createRelease(db: PlannerDatabase, workspace: Workspace) {
  const project = projectFor(workspace, str('project'));
  const version = str('version') ?? fail('INVALID_ARGUMENT', '--version ist erforderlich.');
  db.createRelease(project.id, version, str('due') ?? null);
  const ids = new Set(workspace.releases.map(release => release.id));
  return db.read().releases.find(release => !ids.has(release.id))!;
}

function readTaskDetail(db: PlannerDatabase, id: number) {
  const workspace = db.read();
  return taskDetail(workspace, workspace.tasks.find(task => task.id === id)!);
}

function editTask(db: PlannerDatabase, workspace: Workspace) {
  const task = findTask(workspace);
  db.saveTask(task.id, fields(task));
  return readTaskDetail(db, task.id);
}

function completeTask(db: PlannerDatabase, workspace: Workspace) {
  const task = findTask(workspace);
  db.completeTask(task.id, true);
  return readTaskDetail(db, task.id);
}

function addSubtask(db: PlannerDatabase, workspace: Workspace) {
  const parent = findTask(workspace);
  db.addSubtask(parent.id, str('text') ?? fail('INVALID_ARGUMENT', '--text ist erforderlich.'));
  return readTaskDetail(db, parent.id);
}

function completeSubtask(db: PlannerDatabase, workspace: Workspace) {
  const id = integer(str('subtask'), '--subtask');
  if (!workspace.subtasks.some(subtask => subtask.id === id))
    fail('NOT_FOUND', 'Unteraufgabe nicht gefunden.', 4);
  db.completeSubtask(id, !v.undo);
  return db.read().subtasks.find(subtask => subtask.id === id)!;
}

function completeCriterion(db: PlannerDatabase, workspace: Workspace) {
  const id = integer(str('criterion'), '--criterion');
  if (!workspace.tasks.some(task => task.criteria.some(criterion => criterion.id === id)))
    fail('NOT_FOUND', 'Akzeptanzkriterium nicht gefunden.', 4);
  db.completeCriterion(id, !v.undo);
  return db.read().tasks.flatMap(task => task.criteria).find(criterion => criterion.id === id)!;
}

const readCommands = new Map<string, (workspace: Workspace) => void>([
  ['projects', workspace => render([...workspace.projects].sort((a, b) => a.id - b.id))],
  ['project', workspace => render(projectFor(workspace, str('project')))],
  ['releases', workspace => {
    const project = projectFor(workspace, str('project'));
    render(workspace.releases.filter(release => release.projectId === project.id).sort((a, b) => a.id - b.id));
  }],
  ['tasks', listTasks],
  ['show', workspace => render(taskDetail(workspace, findTask(workspace)))],
]);

const writeCommands = new Map<string, (db: PlannerDatabase, workspace: Workspace) => unknown>([
  ['create', createTask],
  ['release-create', createRelease],
  ['edit', editTask],
  ['done', completeTask],
  ['subtask-add', addSubtask],
  ['subtask-done', completeSubtask],
  ['criterion-done', completeCriterion],
]);

function databasePath(): string {
  const defaultPath = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'HQ', 'hq.sqlite')
    : process.platform === 'win32' && process.env.APPDATA
      ? join(process.env.APPDATA, 'HQ', 'hq.sqlite')
      : '';
  const file = str('db') ?? defaultPath;
  if (!file || !existsSync(file))
    fail('DATABASE_NOT_FOUND', 'HQ-Datenbank nicht gefunden. Nutze --db für einen anderen Pfad.', 4);
  return file;
}

function run(): void {
  if (command === 'help' || v.help) {
    if (json) render({help});
    else process.stdout.write(help);
    return;
  }
  if (args.positionals.length !== 1)
    fail('INVALID_ARGUMENT', 'Ungültiger Befehl.');
  const read = readCommands.get(command);
  const write = writeCommands.get(command);
  if (!read && !write)
    fail('INVALID_ARGUMENT', `Unbekannter Befehl: ${command}`);

  const db = new PlannerDatabase(databasePath());
  try {
    const workspace = db.read();
    if (read) read(workspace);
    else if (write) render(db.mutate(workspace.revision, () => write(db, workspace)));
  } finally {
    db.close();
  }
}
try { run(); } catch (error) {
 const message=error instanceof Error ? error.message : 'Unbekannter Fehler.';
 const code=error instanceof CliError ? error.code : message.includes('zwischenzeitlich geändert') ? 'CONFLICT' : /database is locked|SQLITE_BUSY/i.test(message) ? 'DATABASE_BUSY' : 'VALIDATION_ERROR';
 const exitCode=error instanceof CliError ? error.exitCode : code==='CONFLICT'||code==='DATABASE_BUSY' ? 5 : 2;
 if (json) process.stderr.write(JSON.stringify({ok:false,error:{code,message}})+'\n'); else process.stderr.write(`${code}: ${message}\n`);
 process.exitCode=exitCode;
}
