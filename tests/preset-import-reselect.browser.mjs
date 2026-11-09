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
