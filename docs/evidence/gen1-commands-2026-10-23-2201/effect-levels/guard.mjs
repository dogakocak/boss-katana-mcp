import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const repo = process.env.KATANA_COMMAND_REPO;
if (!repo || process.env.KATANA_GEN1_ALLOW_WRITES !== '1' || process.env.KATANA_GEN1_LOW_MASTER_CONFIRMED !== '1') throw new Error('Missing explicit session gates');
const { parameter } = await import(pathToFileURL(repo + '/dist/gen1/parameters.js'));
const { encodeRead, encodeData, identityRequest } = await import(pathToFileURL(repo + '/dist/gen1/protocol.js'));
const hex = a => Array.from(a,n=>n.toString(16).padStart(2,'0').toUpperCase()).join(' ');
const allow = new Map([[hex(identityRequest()),{key:'Identity',kind:'identity'}]]);
for (const key of ['DelayOn','ReverbOn','DelayTime','DelayFeedback','ReverbLevel','TemporaryLevel','DelayLevel']) {
 const p=parameter(key,true); allow.set(hex(encodeRead(p.address,p.length)),{key,kind:'read'});
 if (key==='DelayOn'||key==='ReverbOn') allow.set(hex(encodeData(p.address,[1])),{key,kind:'write'});
 if (key==='DelayLevel'||key==='ReverbLevel') allow.set(hex(encodeData(p.address,[15])),{key,kind:'write'});
}
const fd=fs.openSync(process.env.KATANA_COMMAND_AUDIT,'wx'); let sequence=0; const counts=new Map();
function log(e){fs.writeSync(fd,JSON.stringify({sequence:++sequence,timeUtc:new Date().toISOString(),...e})+'\n');fs.fsyncSync(fd);}
const require=createRequire(repo+'/package.json'), midi=require('@julusian/midi'), send=midi.Output.prototype.sendMessage;
midi.Output.prototype.sendMessage=function(data){
 const frame=hex(data),r=allow.get(frame),k=r&&r.kind+':'+r.key,n=(counts.get(k)||0)+1;
 if(!r||n>(r.kind==='write'||r.kind==='identity'?1:5)){log({direction:'BLOCKED_TX',hex:frame});throw new Error('Unapproved/repeated frame blocked');}
 counts.set(k,n);log({direction:'TX_ATTEMPT',...r,hex:frame});const result=send.call(this,data);log({direction:'TX_NATIVE_RETURNED',...r,hex:frame});return result;
};
const emit=midi.Input.prototype.emit;
midi.Input.prototype.emit=function(event,...args){if(event==='message')log({direction:'RX',hex:hex(args[1])});return emit.call(this,event,...args);};
log({direction:'GUARD_READY',mode:'enable-delay-reverb-with-wet15-only'});
process.once('exit',()=>{fs.fsyncSync(fd);fs.closeSync(fd);});
