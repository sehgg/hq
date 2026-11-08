const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {spawnSync}=require('node:child_process');
const {PlannerDatabase}=require('../dist/database');

function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'hq-cli-'));
 const path=join(dir,'workspace.sqlite'), db=new PlannerDatabase(path);
 t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 db.saveProject(null,{title:'App',kind:'software',priority:'normal',description:'',dueDate:'2026-11-30'});
 db.createRelease(db.read().projects[0].id,'v1');
 const run=(...args)=>{
  const binary=process.env.HQ_CLI_EXEC;
  const r=spawnSync(binary || process.execPath,[...(binary ? [] : ['dist/cli.js']),...args,'--db',path,'--json'],{encoding:'utf8',cwd:binary ? dir : undefined,env:binary ? {...process.env,PATH:process.platform==='win32' ? process.env.PATH : '/usr/bin:/bin'} : {...process.env,NODE_NO_WARNINGS:'1'}});
  return {status:r.status,body:JSON.parse(r.status===0?r.stdout:r.stderr),stdout:r.stdout};
 };
 return {db,path,run};
}

test('CLI search, assignment, editing and completion rules share the database and stable JSON contract',t=>{
 const {db,run}=fixture(t); const project=db.read().projects[0].id, release=db.read().releases[0].id;
 assert.deepEqual(Object.keys(run('projects').body),['ok','data']); assert.equal(run('projects').body.data[0].id,project);
 assert.equal(run('releases','--project','App').body.data[0].id,release);
 const create=(...args)=>{const r=run('create','--project','App',...args); assert.equal(r.status,0,JSON.stringify(r.body));return r.body.data;};
 const blocker=create('--title','Vorarbeit');
 const feature=create('--title','Export','--kind','feature','--release',String(release),'--criteria',JSON.stringify([{id:null,text:'CSV vorhanden',completed:false}]));
 const task=create('--title','Export testen','--feature',String(feature.id),'--predecessors',String(blocker.id),'--due','2026-11-30','--description','Prüfen');
 assert.equal(task.featureId,feature.id); assert.equal(task.dueDate,'2026-11-30');
 assert.equal(run('tasks','--project','App').body.data.some(x=>x.id===task.id),false);
 const found=run('tasks','--project','App','--title','export').body.data; assert.deepEqual(found.map(x=>x.id),[feature.id,task.id]);
 create('--title','Export testen');
 let result=run('edit','--project','App','--title','Export testen','--new-title','Darf nicht speichern');
 assert.equal(result.status,3); assert.equal(result.body.error.code,'AMBIGUOUS'); assert.equal(db.read().tasks.some(x=>x.title==='Darf nicht speichern'),false);
 result=run('edit','--id',String(task.id),'--new-title','Export validieren','--status','in_progress'); assert.equal(result.body.data.status,'in_progress');
 result=run('done','--id',String(task.id)); assert.equal(result.status,2); assert.match(result.body.error.message,/Vorgänger/);
 let added=run('subtask-add','--id',String(task.id),'--text','Datei prüfen'); const sub=added.body.data.subtasks[0];
 assert.match(run('done','--id',String(task.id)).body.error.message,/Unteraufgaben/);
 assert.equal(run('subtask-done','--subtask',String(sub.id)).body.data.completed,true);
 assert.equal(run('done','--id',String(blocker.id)).status,0);
 assert.equal(run('done','--id',String(task.id)).body.data.status,'done');
 const criterion=run('show','--id',String(feature.id)).body.data.criteria[0];
 assert.equal(run('criterion-done','--criterion',String(criterion.id)).body.data.completed,true);
 assert.equal(run('edit','--id',String(feature.id),'--due','2026-12-01').body.error.code,'VALIDATION_ERROR');
 const bad=run('show','--wat'); assert.equal(bad.status,2); assert.equal(bad.body.error.code,'INVALID_ARGUMENT');
 assert.equal(db.read().tasks.find(x=>x.id===task.id).status,'done');
});

test('CLI and desktop connections reject stale writes and preserve both changes',t=>{
 const {db,path,run}=fixture(t);
 const project=db.read().projects[0].id; const desktopSnapshot=db.read();
 const created=run('create','--project','App','--title','Extern'); assert.equal(created.status,0);
 assert.throws(()=>db.mutate(desktopSnapshot.revision,()=>db.saveProject(project,{...desktopSnapshot.projects[0],title:'Alt'})),/zwischenzeitlich geändert/);
 assert.equal(db.read().projects[0].title,'App');
 const cliSnapshot=db.read(); const desktop=new PlannerDatabase(path); desktop.mutate(desktop.read().revision,()=>desktop.saveProject(project,{...desktop.read().projects[0],description:'Desktopänderung'})); desktop.close();
 assert.throws(()=>db.mutate(cliSnapshot.revision,()=>db.saveTask(created.body.data.id,{...created.body.data,title:'Alt'})),/zwischenzeitlich geändert/);
 assert.equal(db.read().tasks.find(x=>x.id===created.body.data.id).title,'Extern'); assert.equal(db.read().projects[0].description,'Desktopänderung');
});

test('duplicate project names require a project ID and never select one implicitly',t=>{
 const {db,run}=fixture(t);
 db.saveProject(null,{title:'App',kind:'software',priority:'normal',description:'',dueDate:null});
 const projects=db.read().projects.filter(p=>p.title==='App');
 const result=run('create','--project','App','--title','Mehrdeutig');
 assert.equal(result.status,3); assert.equal(result.body.error.code,'AMBIGUOUS'); assert.equal(db.read().tasks.length,0);
 const created=run('create','--project-id',String(projects[0].id),'--title','Eindeutig');
 assert.equal(created.status,0); assert.equal(created.body.data.projectId,projects[0].id);
});

test('simultaneous writers cannot silently overwrite each other',async t=>{
 const {db,path}=fixture(t);
 const {fork}=require('node:child_process');
 const writers=['one','two'].map(value=>fork(join('tests','fixtures','concurrent-writer.cjs'),[path,value],{silent:true,env:{...process.env,NODE_NO_WARNINGS:'1'}}));
 t.after(()=>writers.forEach(child=>child.kill()));
 for (const child of writers) { child.stderrText=''; child.stderr.on('data',data=>{child.stderrText+=data;}); }
 const waitFor=(child,key)=>new Promise((resolve,reject)=>{ child.on('message',function onMessage(message){if(key in message){child.off('message',onMessage);resolve(message);}}); child.once('error',reject); child.once('exit',code=>{if(code) reject(new Error(`Writer exited ${code}: ${child.stderrText}`));}); });
 await Promise.all(writers.map(child=>waitFor(child,'ready')));
 const exits=writers.map(child=>new Promise((resolve,reject)=>child.once('exit',code=>code ? reject(new Error(`Writer exited ${code}`)) : resolve())));
 const outcomes=writers.map(child=>waitFor(child,'result')); for(const child of writers) child.send('write');
 const results=await Promise.all(outcomes);
 assert.deepEqual(results.map(r=>r.result).sort(),['conflict','saved']); assert.match(results.find(r=>r.result==='conflict').message,/zwischenzeitlich geändert/);
 await Promise.all(exits);
 assert.ok(['one','two'].includes(db.read().projects[0].description));
});
