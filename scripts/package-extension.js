const {root,check}=require('./check-release.js'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const files=check(),version=require('../manifest.json').version;
assert.match(version,/^\d+\.\d+\.\d+$/);
const dist=path.join(root,'dist');fs.mkdirSync(dist,{recursive:true});const temp=fs.mkdtempSync(path.join(dist,'.package-'));
try{
 const zip=path.join(temp,'douyin-digest.zip');cp.execFileSync('zip',['-X','-q',zip,...files],{cwd:root});
 const actual=cp.execFileSync('unzip',['-Z1',zip],{encoding:'utf8'}).trim().split('\n');assert.deepEqual(actual.sort(),[...files].sort());
 cp.execFileSync('unzip',['-t',zip]);
 const output=path.join(dist,`douyin-digest-v${version}.zip`);assert.ok(!fs.existsSync(output),'该版本安装包已存在，请升级版本号再打包。');fs.renameSync(zip,output);
 const hash=crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');fs.writeFileSync(output+'.sha256',`${hash}  ${path.basename(output)}\n`);
 process.stdout.write(`Created ${output}\nSHA-256 ${hash}\n`);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
