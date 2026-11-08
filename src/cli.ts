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
  hq tasks --project NAME [--title TEXT] [--json]
  hq show (--id ID | --project NAME --title TEXT) [--json]
  hq create --project NAME --title TEXT [--kind task|feature|fix] [options]
  hq edit (--id ID | --project NAME --title TEXT) [--new-title TEXT] [options]
  hq done (--id ID | --project NAME --title TEXT)
  hq subtask-add --id ID --text TEXT
  hq subtask-done --subtask ID [--undo]
  hq criterion-done --criterion ID [--undo]
Options: --description TEXT --priority low|normal|high --status planned|in_progress|paused|done
  --due YYYY-MM-DD|none --predecessors ID,ID|none --feature ID|none --release ID|none
  --criteria JSON (array of {id:null|number,text:string,completed:boolean}); --move-to PROJECT_ID
  --project-id ID selects a project with a duplicate name; --db PATH; --json
Use task IDs to resolve ambiguous matches. Tasks without a title filter are suggestions only.\n`;
const options = Object.fromEntries(['project','project-id','move-to','title','new-title','id','kind','description','priority','status','due','predecessors','feature','release','criteria','subtask','criterion','text','db'].map(key => [key,{type:'string' as const}]));
let args: ReturnType<typeof parseArgs>;
try { args = parseArgs({args:process.argv.slice(2), options:{...options,json:{type:'boolean'},undo:{type:'boolean'},help:{type:'boolean'}},allowPositionals:true,strict:true}); }
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
  featureId:optionalId('feature',base.featureId), releaseId:optionalId('release',base.releaseId), criteria:parsed,
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
  console.log(`#${item.id} ${item.title}\nTyp: ${item.kind} · Status: ${item.status} · Priorität: ${item.priority}\nFällig: ${item.dueDate ?? '–'} · Feature: ${item.featureId ?? '–'} · Release: ${item.releaseId ?? '–'}\nBeschreibung: ${item.description || '–'}\nVorgänger: ${item.predecessorIds?.join(', ') || '–'}`);
  for (const sub of item.subtasks ?? []) console.log(`  [${sub.completed?'x':' '}] Unteraufgabe #${sub.id}: ${sub.title}`);
  for (const criterion of item.criteria ?? []) console.log(`  [${criterion.completed?'x':' '}] Kriterium #${criterion.id}: ${criterion.text}`);
  return;
 }
 console.log(JSON.stringify(data,null,2));
}
function run():void {
 if (command==='help' || v.help) { if (json) render({help}); else process.stdout.write(help); return; }
 if (args.positionals.length!==1) return fail('INVALID_ARGUMENT','Ungültiger Befehl.');
 const allowed=['projects','project','releases','tasks','show','create','edit','done','subtask-add','subtask-done','criterion-done'];
 if (!allowed.includes(command)) return fail('INVALID_ARGUMENT',`Unbekannter Befehl: ${command}`);
 const defaultPath=process.platform==='darwin' ? join(homedir(),'Library','Application Support','HQ','hq.sqlite') : process.platform==='win32' && process.env.APPDATA ? join(process.env.APPDATA,'HQ','hq.sqlite') : '';
 const file=str('db') ?? defaultPath;
 if (!file || !existsSync(file)) return fail('DATABASE_NOT_FOUND','HQ-Datenbank nicht gefunden. Nutze --db für einen anderen Pfad.',4);
 const db=new PlannerDatabase(file);
 try {
  const w=db.read();
  if (command==='projects') return render([...w.projects].sort((a,b)=>a.id-b.id));
  if (command==='project') return render(projectFor(w,str('project')));
  if (command==='releases') { const project=projectFor(w,str('project')); return render(w.releases.filter(r=>r.projectId===project.id).sort((a,b)=>a.id-b.id)); }
  if (command==='tasks') {
   const project=projectFor(w,str('project')); const term=str('title')?.toLocaleLowerCase('de');
   const items=w.tasks.filter(t=>t.projectId===project.id && (term ? t.title.toLocaleLowerCase('de').includes(term) : !t.completed && t.predecessorIds.every(id=>w.tasks.find(x=>x.id===id)?.completed) && w.subtasks.filter(x=>x.taskId===t.id).every(x=>x.completed))).sort((a,b)=>a.id-b.id);
   if (!json && !term) console.log('Offene, umsetzbare Einträge – bitte anhand der ID auswählen:');
   return render(items.map(t=>taskDetail(w,t)));
  }
  if (command==='show') return render(taskDetail(w,findTask(w)));
  const result=db.mutate(w.revision,()=>{
   if (command==='create') {
    const project=projectFor(w,str('project')); const name=str('title') ?? fail('INVALID_ARGUMENT','--title ist erforderlich.');
    const base:TaskFields={title:name,description:'',priority:'normal',status:'planned',dueDate:null,kind:(str('kind') ?? 'task') as TaskFields['kind'],projectId:project.id,featureId:null,releaseId:null,criteria:[],predecessorIds:[]};
    db.saveTask(null,fields(base)); const next=db.read(); const ids=new Set(w.tasks.map(t=>t.id)); return taskDetail(next,next.tasks.find(t=>!ids.has(t.id))!);
   }
   if (command==='edit') { const old=findTask(w); db.saveTask(old.id,fields(old)); const next=db.read(); return taskDetail(next,next.tasks.find(t=>t.id===old.id)!); }
   if (command==='done') { const old=findTask(w); db.completeTask(old.id,true); const next=db.read(); return taskDetail(next,next.tasks.find(t=>t.id===old.id)!); }
   if (command==='subtask-add') { const parent=findTask(w); db.addSubtask(parent.id,str('text') ?? fail('INVALID_ARGUMENT','--text ist erforderlich.')); const next=db.read(); return taskDetail(next,next.tasks.find(t=>t.id===parent.id)!); }
   if (command==='subtask-done') { const id=integer(str('subtask'),'--subtask'); if(!w.subtasks.some(s=>s.id===id)) return fail('NOT_FOUND','Unteraufgabe nicht gefunden.',4); db.completeSubtask(id,!v.undo); return db.read().subtasks.find(s=>s.id===id)!; }
   const id=integer(str('criterion'),'--criterion'); if(!w.tasks.some(t=>t.criteria.some(c=>c.id===id))) return fail('NOT_FOUND','Akzeptanzkriterium nicht gefunden.',4); db.completeCriterion(id,!v.undo); return db.read().tasks.flatMap(t=>t.criteria).find(c=>c.id===id)!;
  });
  render(result);
 } finally { db.close(); }
}
try { run(); } catch (error) {
 const message=error instanceof Error ? error.message : 'Unbekannter Fehler.';
 const code=error instanceof CliError ? error.code : message.includes('zwischenzeitlich geändert') ? 'CONFLICT' : /database is locked|SQLITE_BUSY/i.test(message) ? 'DATABASE_BUSY' : 'VALIDATION_ERROR';
 const exitCode=error instanceof CliError ? error.exitCode : code==='CONFLICT'||code==='DATABASE_BUSY' ? 5 : 2;
 if (json) process.stderr.write(JSON.stringify({ok:false,error:{code,message}})+'\n'); else process.stderr.write(`${code}: ${message}\n`);
 process.exitCode=exitCode;
}
