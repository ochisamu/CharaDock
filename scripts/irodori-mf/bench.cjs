// Standalone Electron WebGPU experiment, not the normal CharaDock profile.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const [output,model,runtimeRoot,dependencies,mode='mf',reference,suite='short']=process.argv.slice(2);
if(!dependencies)throw new Error('bench.cjs OUTPUT MODEL RUNTIME_ROOT DEPENDENCIES [mf|rf] [REFERENCE_WAV] [short|long]');
if(!['short','long'].includes(suite))throw new Error('Unknown benchmark suite');
fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));
app.commandLine.appendSwitch('disable-background-timer-throttling');
ipcMain.handle('mf:config',()=>({output,model,runtimeRoot,dependencies,mode,reference,suite}));
ipcMain.on('mf:log',(_,value)=>{console.log(JSON.stringify(value));fs.appendFileSync(path.join(output,'results.jsonl'),JSON.stringify(value)+'\n');});
ipcMain.on('mf:done',(_,error)=>{if(error){fs.writeFileSync(path.join(output,'error.txt'),String(error));console.error(error);}app.exit(error?1:0);});
app.whenReady().then(()=>{
 const w=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'bench-preload.cjs'),nodeIntegration:true,contextIsolation:false,sandbox:false,backgroundThrottling:false}});
 w.webContents.on('console-message',(_, ...args)=>console.log(...args));
 w.loadFile(path.join(__dirname,'bench.html'));
});
setTimeout(()=>app.exit(2),15*60*1000);
