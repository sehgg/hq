import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (!['darwin','win32'].includes(process.platform)) throw new Error('Build the CLI on macOS or Windows for its native platform.');
const runtime=process.env.HQ_NODE ?? process.execPath;
const version=spawnSync(runtime,['--version'],{encoding:'utf8'});
if (version.status!==0 || Number(version.stdout.trim().replace(/^v/, '').split('.')[0])<24) throw new Error('HQ_NODE must point to Node.js 24 or later with single executable application support.');
const out=resolve('out',`cli-${process.platform}-${process.arch}`);
mkdirSync(out,{recursive:true});
const main = join(out, 'bundle.cjs');
const moduleNames = ['database-migrations', 'database-history', 'database', 'cli'];
const factories = moduleNames.map(name => {
  const source = readFileSync(join('dist', `${name}.js`), 'utf8');
  return `  './${name}': (require, module, exports) => {\n${source}\n  },`;
});
writeFileSync(main, `
process.removeAllListeners('warning');
const factories = {
${factories.join('\n')}
};
const cache = new Map();
function localRequire(id) {
  if (!Object.hasOwn(factories, id)) return require(id);
  if (cache.has(id)) return cache.get(id).exports;
  const module = { exports: {} };
  cache.set(id, module);
  factories[id](localRequire, module, module.exports);
  return module.exports;
}
localRequire('./cli');
`);
const config=join(out,'sea.json'), blob=join(out,'sea.blob');
const output=join(out,process.platform==='win32'?'hq.exe':'hq');
writeFileSync(config,JSON.stringify({main:relative(process.cwd(),main),output:relative(process.cwd(),blob),disableExperimentalSEAWarning:true}));
function run(command,args) { const result=spawnSync(command,args,{stdio:'inherit'}); if (result.status!==0) throw new Error(`Command failed: ${command}`); }
run(runtime,[`--experimental-sea-config=${config}`]);
copyFileSync(runtime,output); chmodSync(output,0o755);
if (process.platform==='darwin' && spawnSync('codesign',['-dv',output],{stdio:'ignore'}).status===0) run('codesign',['--remove-signature',output]);
const postject=resolve('node_modules','postject','dist','cli.js');
run(process.execPath,[postject,output,'NODE_SEA_BLOB',blob,'--sentinel-fuse','NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',...(process.platform==='darwin'?['--macho-segment-name','NODE_SEA']:[])]);
if (process.platform==='darwin') run('codesign',['--sign','-',output]);
console.log(output);
