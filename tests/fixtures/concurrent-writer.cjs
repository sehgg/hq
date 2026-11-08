const {PlannerDatabase}=require('../../dist/database');
const db=new PlannerDatabase(process.argv[2]);
const workspace=db.read(), project=workspace.projects[0];
process.send({ready:true});
process.on('message',()=>{
 try { db.mutate(workspace.revision,()=>db.saveProject(project.id,{...project,description:process.argv[3]})); process.send({result:'saved'}); }
 catch (error) { process.send({result:'conflict',message:error.message}); }
 finally { db.close(); process.disconnect(); }
});
