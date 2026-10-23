import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
if(process.argv[2]!=='--write-approved'||process.argv[3]!=='--low-master-confirmed')throw new Error('Explicit session flags required');
const repo="C:\\Users\\ozkar\\Documents\\ChatGPT\\mcp\\boss-katana-mcp", folder=path.dirname(fileURLToPath(import.meta.url)),require=createRequire(repo+'/package.json');
const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')));
const {StdioClientTransport,getDefaultEnvironment}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const report={request:'arttır duyamıyorum',status:'RUNNING',startedAtUtc:new Date().toISOString(),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),operatorAttestation:{writesApprovedPreviously:true,physicalMasterLowConfirmedPreviously:true},calls:[],failure:null,cleanupFailure:null};
report.runnerSha256=hash(fileURLToPath(import.meta.url));report.guardSha256=hash(path.join(folder,'guard.mjs'));
const fd=fs.openSync(path.join(folder,'mcp-report.json'),'wx');
const save=()=>{fs.ftruncateSync(fd,0);fs.writeSync(fd,JSON.stringify(report,null,2)+'\n',0,'utf8');fs.fsyncSync(fd);};
const transport=new StdioClientTransport({command:process.execPath,args:['--import',pathToFileURL(path.join(folder,'guard.mjs')).href,path.join(repo,'dist/index.js')],cwd:repo,stderr:'pipe',env:{...getDefaultEnvironment(),NODE_OPTIONS:'',KATANA_BACKEND:'gen1',KATANA_GEN1_ENABLE_HARDWARE:'1',KATANA_GEN1_MODEL_CONFIRMED:'1',KATANA_GEN1_ALLOW_WRITES:'1',KATANA_GEN1_LOW_MASTER_CONFIRMED:'1',KATANA_COMMAND_REPO:repo,KATANA_COMMAND_AUDIT:path.join(folder,'midi-audit.jsonl')}});
report.stderr='';transport.stderr?.on('data',d=>{report.stderr=(report.stderr+String(d)).slice(-12000);});
const client=new Client({name:'operator-delay-reverb-command',version:'1'});let initialized=false;
async function call(name,args={}){const r={name,arguments:args};report.calls.push(r);save();r.result=await client.callTool({name,arguments:args},undefined,{timeout:15000});save();if(r.result.isError)throw new Error(JSON.stringify(r.result));return JSON.parse(r.result.content.find(c=>c.type==='text').text);}
try{
 save();await client.connect(transport);initialized=true;
 report.connection=await call('katana_gen1_connect');
 report.settings={};
 for(const key of ['TemporaryLevel','DelayTime','DelayFeedback','ReverbLevel','DelayLevel'])report.settings[key]=await call('katana_gen1_read',{key,explicitResearch:true});
 if(report.settings.TemporaryLevel.raw>10)throw new Error('Current LEVEL above software ceiling; stopped before writes');
 report.delay=await call('katana_gen1_set',{key:'DelayOn',value:1});
 report.reverb=await call('katana_gen1_set',{key:'ReverbOn',value:1});
 report.delayLevel=await call('katana_gen1_set',{key:'DelayLevel',value:25});
 report.reverbLevel=await call('katana_gen1_set',{key:'ReverbLevel',value:25});
 report.final={};
 for(const key of ['DelayOn','ReverbOn','TemporaryLevel','DelayLevel','ReverbLevel'])report.final[key]=await call('katana_gen1_read',{key,explicitResearch:true});
 if(report.final.DelayLevel.raw!==25||report.final.ReverbLevel.raw!==25||report.final.DelayOn.raw!==1||report.final.ReverbOn.raw!==1||report.final.TemporaryLevel.raw!==report.settings.TemporaryLevel.raw)throw new Error('Final readback differs');
 report.status='PASS';
}catch(e){report.status='FAIL';report.failure=String(e);process.exitCode=1;}
finally{
 if(initialized)try{report.disconnected=await call('katana_gen1_disconnect');}catch(e){report.cleanupFailure=String(e);report.status='FAIL';process.exitCode=1;}
 try{await client.close();}catch(e){report.cleanupFailure=String(e);report.status='FAIL';process.exitCode=1;}
 const audit=path.join(folder,'midi-audit.jsonl');if(fs.existsSync(audit)){const rows=fs.readFileSync(audit,'utf8').trim().split('\n').map(JSON.parse),tx=rows.filter(r=>r.direction==='TX_NATIVE_RETURNED');report.audit={sha256:hash(audit),identity:tx.filter(r=>r.kind==='identity').length,rq1:tx.filter(r=>r.kind==='read').length,dt1:tx.filter(r=>r.kind==='write').length,blocked:rows.filter(r=>r.direction==='BLOCKED_TX').length,rx:rows.filter(r=>r.direction==='RX').length};}
 report.completedAtUtc=new Date().toISOString();save();fs.closeSync(fd);console.log(JSON.stringify(report,null,2));
}
