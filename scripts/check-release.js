const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const files=['manifest.json','background.js','volc.js','transcript-parts.js','audio-jobs.js','offscreen.html','offscreen.mjs','audio-chunks.mjs','audio-compact.mjs','speaker-audio.mjs','vendor/mp4box/mp4box.all.mjs','vendor/mp4box/styp-9TIZZDLN.mjs','vendor/mp4box/rolldown-runtime-w6R9maHv.mjs','vendor/mp4box/LICENSE','page-bridge.js','ai.js','core.js','content.js','settings.js','sidepanel.html','sidepanel.css','sidepanel.js','options.html','options.css','options.js','prompts/analysis.md','prompts/explain.md','icons/icon16.png','icons/icon48.png','icons/icon128.png','LICENSE','NOTICE.md','README.zh-CN.md','PRIVACY.md'];
files.push('library-config.js','library-core.js','library-db.js','library-background.js','library-files.js','library.html','library.css','library.js');
function check(){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 assert.equal(manifest.name,'抖音精读');assert.equal(manifest.version,pkg.version);assert.equal(manifest.manifest_version,3);
 assert.deepEqual(manifest.permissions,['sidePanel','storage','tabs','offscreen','declarativeNetRequestWithHostAccess']);
 assert.deepEqual(manifest.host_permissions,['https://www.douyin.com/*','https://api.supadata.ai/*','https://api.deepseek.com/*','https://openspeech.bytedance.com/*','https://*.douyinvod.com/*']);
 for(const file of files){const full=path.join(root,file);assert.ok(fs.statSync(full).isFile());
  if(/\.m?js$/.test(file))cp.execFileSync(process.execPath,['--check',full]);
  if(/\.(m?js|html|css)$/.test(file)){
   const source=fs.readFileSync(full,'utf8');assert.ok(!/translateContent|translationGeneration|bilingual|youtube\.com|youtube-digest|ytd_settings|ytd_notes/.test(source),`leftover platform/translation code: ${file}`);
   assert.ok(!/\b(?:eval|new Function)\s*\(/.test(source));assert.ok(!/innerHTML\s*=/.test(source),`unsafe HTML write: ${file}`);
   assert.ok(!/sk-[A-Za-z0-9]{16,}/.test(source),`potential secret: ${file}`);
  }
 }
 for(const name of ['sidepanel','options','offscreen','library']){
  const html=fs.readFileSync(path.join(root,name+'.html'),'utf8');
  for(const m of html.matchAll(/(?:src|href)="([^"#]+)"/g))if(!m[1].startsWith('https:'))assert.ok(fs.existsSync(path.join(root,m[1])));
  for(const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))assert.equal(script[1].trim(),'');
 }
 assert.match(fs.readFileSync(path.join(root,'LICENSE'),'utf8'),/MIT License/);
 return files;
}
if(require.main===module){check();process.stdout.write(`Release check passed: ${files.length} allowlisted files.\n`);}
module.exports={root,files,check};
