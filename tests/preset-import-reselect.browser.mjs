import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,writeFile,readFile,readdir,rm} from "node:fs/promises";
import {gzipSync,gunzipSync} from "node:zlib";
import {tmpdir} from "node:os";
import {join} from "node:path";
import puppeteer from "puppeteer-core";

test("#21 invalid JSON can be selected repeatedly in real Chromium",async()=>{
  const server=spawn("npm",["run","preview","--","--host","127.0.0.1","--port","8796","--strictPort"],{stdio:"ignore"});
  let browser;const dir=await mkdtemp(join(tmpdir(),"preset-reselect-"));
  try{
    let ready=false;
    for(let i=0;i<55;i++){
      try{const res=await fetch("http://127.0.0.1:8796/");if(res.ok){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,180));
    }
    assert.ok(ready,"Vite preview did not start");
    const file=join(dir,"invalid.json");
    await writeFile(file,JSON.stringify({version:999,notAPreset:true}));
    browser=await puppeteer.launch({
      executablePath:process.env.CHROME_BIN||"/usr/bin/google-chrome",
      headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]
    });
    const page=await browser.newPage();
    const errors=[];
    let dialogs=0;
    page.on("pageerror",error=>errors.push(String(error.message)));
    page.on("dialog",async dialog=>{dialogs++;await dialog.dismiss();});
    await page.goto("http://127.0.0.1:8796/",{waitUntil:"domcontentloaded"});
    await page.waitForSelector('button[aria-label="メニューを開く"]');
    await page.click('button[aria-label="メニューを開く"]');
    const input=await page.$('input[type="file"][accept=".json,.bin"]');
    assert.ok(input,"Preset import input must be present");
    for(let attempt=1;attempt<=2;attempt++){
      await input.uploadFile(file);
      for(let i=0;i<40&&dialogs<attempt;i++)await new Promise(resolve=>setTimeout(resolve,50));
      assert.equal(dialogs,attempt,"Same invalid file must be independently processed on each selection");
      const state=await page.evaluate(()=>{
        const input=document.querySelector('input[type="file"][accept=".json,.bin"]');
        return {value:input.value,files:input.files.length};
      });
      assert.deepEqual(state,{value:"",files:0},"Input selection must be cleared after validation error");
    }
    assert.deepEqual(errors,[],"Rejected import must not raise uncaught errors");
  }finally{
    if(browser)await browser.close();
    server.kill("SIGTERM");
    await rm(dir,{recursive:true,force:true});
  }
});


test("#34 real Chromium downloads gzip BIN, reimports it and accepts legacy BIN",async()=>{
  const server=spawn("npm",["run","preview","--","--host","127.0.0.1","--port","8798","--strictPort"],{stdio:"ignore"});
  let browser;
  const dir=await mkdtemp(join(tmpdir(),"preset-binary-"));
  try{
    let ready=false;
    for(let i=0;i<55;i++){
      try{const res=await fetch("http://127.0.0.1:8798/");if(res.ok){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,180));
    }
    assert.ok(ready,"Vite preview did not start");
    browser=await puppeteer.launch({
      executablePath:process.env.CHROME_BIN||"/usr/bin/google-chrome",
      headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]
    });
    const page=await browser.newPage();
    const client=await page.createCDPSession();
    await client.send("Page.setDownloadBehavior",{behavior:"allow",downloadPath:dir});
    const pageErrors=[];const dialogs=[];
    page.on("pageerror",error=>pageErrors.push(error.message));
    page.on("dialog",async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
    await page.goto("http://127.0.0.1:8798/",{waitUntil:"domcontentloaded"});
    await page.waitForSelector('button[aria-label="メニューを開く"]');
    await page.click('button[aria-label="メニューを開く"]');

    const clickExport=async label=>{
      const buttons=await page.$$('aside[role="dialog"] button');
      for(const button of buttons){
        if((await button.evaluate(el=>el.textContent?.trim()))===label){
          await button.click();
          return;
        }
      }
      throw Error(`Missing export button: ${label}`);
    };
    const known=new Set();
    const waitForDownload=async suffix=>{
      for(let i=0;i<100;i++){
        for(const name of await readdir(dir)){
          if(name.endsWith(suffix)&&!known.has(name)){
            known.add(name);
            return join(dir,name);
          }
        }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      throw Error(`No ${suffix} download after clicking export`);
    };

    await clickExport("JSON");
    const originalJson=JSON.parse(await readFile(await waitForDownload(".json"),"utf8"));
    await clickExport("BIN");
    const initialBin=await readFile(await waitForDownload(".bin"));
    assert.equal(initialBin.subarray(0,4).toString("utf8"),"MMPK");
    assert.equal(initialBin[4],1);
    assert.equal(initialBin[5],1);
    const decoded=JSON.parse(gunzipSync(initialBin.subarray(12)).toString("utf8"));
    assert.deepEqual(decoded.layoutPreset,originalJson.layoutPreset);
    assert.deepEqual(decoded.tuningPreset,originalJson.tuningPreset);

    const prettyBytes=Buffer.byteLength(JSON.stringify(originalJson,null,2));
    const legacyBytes=Buffer.byteLength(JSON.stringify(originalJson));
    const compressedBytes=initialBin.byteLength;
    assert.ok(compressedBytes<legacyBytes,"default layout+tuning should compress over minified legacy BIN");
    process.stdout.write(`#34 Chromium file bytes: JSON=${prettyBytes}, legacyBIN=${legacyBytes}, gzipBIN=${compressedBytes}; gzip/legacy=${(compressedBytes/legacyBytes).toFixed(3)}\n`);

    const makePackage=(layoutName,tuningName)=>{
      const copy=structuredClone(originalJson);
      copy.layoutPreset.name=layoutName;
      copy.tuningPreset.name=tuningName;
      return copy;
    };
    const gzipPackage=makePackage("gzip再読込レイアウト","gzip再読込音高");
    const raw=Buffer.from(JSON.stringify(gzipPackage),"utf8");
    const header=Buffer.alloc(12);
    header.write("MMPK",0,"ascii");
    header[4]=1;header[5]=1;header.writeUInt32LE(raw.length,8);
    const importedGzipPath=join(dir,"import-fixture.bin");
    await writeFile(importedGzipPath,Buffer.concat([header,gzipSync(raw)]));
    const input=await page.$('input[type="file"][accept=".json,.bin"]');
    assert.ok(input);
    await input.uploadFile(importedGzipPath);
    await page.waitForFunction(()=>document.querySelector('input[type="file"]')?.files.length===0,{timeout:10000});
    await new Promise(resolve=>setTimeout(resolve,100));
    await clickExport("JSON");
    const afterGzip=JSON.parse(await readFile(await waitForDownload(".json"),"utf8"));
    assert.equal(afterGzip.layoutPreset.name,gzipPackage.layoutPreset.name);
    assert.equal(afterGzip.tuningPreset.name,gzipPackage.tuningPreset.name);

    const legacyPackage=makePackage("旧BIN再読込レイアウト","旧BIN再読込音高");
    const importedLegacyPath=join(dir,"legacy-fixture.bin");
    await writeFile(importedLegacyPath,JSON.stringify(legacyPackage),"utf8");
    await input.uploadFile(importedLegacyPath);
    await page.waitForFunction(()=>document.querySelector('input[type="file"]')?.files.length===0,{timeout:10000});
    await new Promise(resolve=>setTimeout(resolve,100));
    await clickExport("JSON");
    const afterLegacy=JSON.parse(await readFile(await waitForDownload(".json"),"utf8"));
    assert.equal(afterLegacy.layoutPreset.name,legacyPackage.layoutPreset.name);
    assert.equal(afterLegacy.tuningPreset.name,legacyPackage.tuningPreset.name);
    assert.deepEqual(pageErrors,[]);
    assert.deepEqual(dialogs,[]);
  }finally{
    if(browser)await browser.close();
    server.kill("SIGTERM");
    await rm(dir,{recursive:true,force:true});
  }
});


test("#37 Chromium import is durable, collision-safe, and atomic on write rejection",async()=>{
  const server=spawn("npm",["run","preview","--","--host","127.0.0.1","--port","8799","--strictPort"],{stdio:"ignore"});
  let browser;
  const dir=await mkdtemp(join(tmpdir(),"preset-import-37-"));
  try{
    let ready=false;
    for(let i=0;i<70;i++){
      try{if((await fetch("http://127.0.0.1:8799/")).ok){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    assert.ok(ready,"Vite preview did not start");
    browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||"/usr/bin/google-chrome",
      headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
    const page=await browser.newPage();
    const client=await page.createCDPSession();
    await client.send("Page.setDownloadBehavior",{behavior:"allow",downloadPath:dir});
    const dialogs=[];const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    page.on("dialog",async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
    await page.goto("http://127.0.0.1:8799/",{waitUntil:"domcontentloaded"});
    await page.click('button[aria-label="メニューを開く"]');

    const jsonButton=(await page.$$('aside[role="dialog"] button'));
    let exported=false;
    for(const button of jsonButton){
      if((await button.evaluate(el=>el.textContent?.trim()))==="JSON"){
        await button.click();exported=true;break;
      }
    }
    assert.ok(exported,"JSON export button missing");
    let exportedPath;
    for(let attempt=0;attempt<100;attempt++){
      exportedPath=(await readdir(dir)).find(name=>name.endsWith(".json"));
      if(exportedPath)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(exportedPath,"Cannot obtain baseline package");
    const pkg=JSON.parse(await readFile(join(dir,exportedPath),"utf8"));
    pkg.layoutPreset.name="#37 復元検証用配置";
    pkg.tuningPreset.name="#37 復元検証用音高";
    const fixture=join(dir,"import-package.json");
    await writeFile(fixture,JSON.stringify(pkg),"utf8");
    const input=await page.$('input[type="file"][accept=".json,.bin"]');
    assert.ok(input);

    const state=async()=>page.evaluate(async()=>{
      const layoutId=document.querySelector("#layout-select")?.value;
      const tuningId=document.querySelector("#tuning-select")?.value;
      const db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open("MultiMicrotonalKeyboardDB",1);
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      try{
        const tx=db.transaction(["layoutPresets","tuningPresets","appSettings"],"readonly");
        const record=(store,id)=>new Promise((resolve,reject)=>{
          const req=tx.objectStore(store).get(id);
          req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
        });
        const all=(store)=>new Promise((resolve,reject)=>{
          const req=tx.objectStore(store).getAll();
          req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
        });
        const [layout,tuning,settings,allLayouts,allTunings]=await Promise.all([
          record("layoutPresets",layoutId),record("tuningPresets",tuningId),
          record("appSettings","current_settings"),all("layoutPresets"),all("tuningPresets")
        ]);
        return {layoutId,tuningId,layout,tuning,
          settings:settings?.value,layoutCount:allLayouts.length,tuningCount:allTunings.length};
      }finally{db.close();}
    });
    const waitSaved=async()=>{
      let last;
      for(let attempt=0;attempt<110;attempt++){
        last=await state();
        if(last.layout?.name===pkg.layoutPreset.name&&last.tuning?.name===pkg.tuningPreset.name&&
          last.settings?.defaultLayoutPresetId===last.layoutId&&last.settings?.defaultPitchPresetId===last.tuningId)
          return last;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      throw Error("Imported package not durable: "+JSON.stringify(last));
    };

    await input.uploadFile(fixture);
    const first=await waitSaved();
    assert.ok(first.layoutId.startsWith("layout_custom_import_"));
    assert.ok(first.tuningId.startsWith("tuning_custom_import_"));
    assert.equal(first.layout.defaultTuningId,first.tuningId);
    assert.equal(first.layout.isStandard,false);
    assert.equal(first.tuning.isStandard,false);
    assert.deepEqual(first.layout.mapping,pkg.layoutPreset.mapping,"all 256 mappings must be lossless");
    await page.reload({waitUntil:"domcontentloaded"});
    await page.click('button[aria-label="メニューを開く"]');
    const restored=await waitSaved();
    assert.equal(restored.layoutId,first.layoutId);
    assert.equal(restored.tuningId,first.tuningId);

    await page.evaluate(()=>{
      const original=IDBObjectStore.prototype.add;
      window.__restoreImportAdd=()=>{IDBObjectStore.prototype.add=original;};
      IDBObjectStore.prototype.add=function(...args){
        if(this.name==="tuningPresets")
          throw new DOMException("isolated quota test","QuotaExceededError");
        return original.apply(this,args);
      };
    });
    const inputAfter=await page.$('input[type="file"][accept=".json,.bin"]');
    await inputAfter.uploadFile(fixture);
    for(let i=0;i<100&&!dialogs.length;i++)await new Promise(resolve=>setTimeout(resolve,50));
    assert.ok(dialogs.length>0,"A rejected package must show an error");
    const rejected=await state();
    assert.equal(rejected.layoutId,first.layoutId,"Rejected import must not switch current layout");
    assert.equal(rejected.tuningId,first.tuningId,"Rejected import must not switch current tuning");
    assert.equal(rejected.layoutCount,first.layoutCount,"Layout half must roll back");
    assert.equal(rejected.tuningCount,first.tuningCount,"Tuning half must roll back");
    await page.evaluate(()=>window.__restoreImportAdd());

    await inputAfter.uploadFile(fixture);
    let second;
    for(let i=0;i<90;i++){
      second=await state();
      if(second.layoutCount===first.layoutCount+1&&second.tuningCount===first.tuningCount+1)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(second.layoutId!==first.layoutId,"Repeated import creates a new ID rather than overwrite");
    assert.equal(second.layoutCount,first.layoutCount+1);
    assert.equal(second.tuningCount,first.tuningCount+1);
    assert.equal(second.layout.defaultTuningId,second.tuningId);
    assert.deepEqual(errors,[]);
  }finally{
    if(browser)await browser.close();
    server.kill("SIGTERM");
    await rm(dir,{recursive:true,force:true});
  }
});
