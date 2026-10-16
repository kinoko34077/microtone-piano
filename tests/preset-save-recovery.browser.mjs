import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import puppeteer from "puppeteer-core";

test("#20 Chrome: rejected preset write retains draft and never persists its default ID", async()=>{
  const server=spawn("npm",["run","preview","--","--host","127.0.0.1","--port","8797","--strictPort"],{stdio:"ignore"});
  let browser;
  try{
    let ready=false;
    for(let i=0;i<50;i++){
      try{const res=await fetch("http://127.0.0.1:8797/");if(res.ok){ready=true;break;}}catch{}
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    assert.ok(ready,"Vite preview did not start");
    browser=await puppeteer.launch({
      executablePath:process.env.CHROME_BIN||"/usr/bin/google-chrome",
      headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]
    });
    const page=await browser.newPage();
    const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.evaluateOnNewDocument(()=>{
      const original=IDBObjectStore.prototype.put;
      window.__restorePresetPut=()=>{IDBObjectStore.prototype.put=original;};
      IDBObjectStore.prototype.put=function(...args){
        if(this.name==="layoutPresets"||this.name==="tuningPresets")
          throw new DOMException("Simulated quota", "QuotaExceededError");
        return original.apply(this,args);
      };
    });
    await page.goto("http://127.0.0.1:8797/",{waitUntil:"domcontentloaded"});
    await page.waitForSelector('button[aria-label="メニューを開く"]');
    await page.click('button[aria-label="メニューを開く"]');
    await page.waitForSelector('button[aria-label="鍵盤配置を複製"]');
    await page.click('button[aria-label="鍵盤配置を複製"]');
    await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('プリセット'));
    const failed=await page.evaluate(async()=>{
      const id=document.querySelector("#layout-select")?.value;
      const db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open("MultiMicrotonalKeyboardDB",1);
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      try{
        const tx=db.transaction("appSettings","readonly");
        const record=await new Promise((resolve,reject)=>{
          const req=tx.objectStore("appSettings").get("current_settings");
          req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
        });
        return {id,storedDefault:record?.value?.defaultLayoutPresetId??null};
      }finally{db.close();}
    });
    assert.ok(failed.id.startsWith("layout_custom_"));
    assert.notEqual(failed.storedDefault,failed.id,"Failed preset must not be saved as an active default");
    await page.evaluate(()=>window.__restorePresetPut());
    await page.evaluate(()=>{
      const button=[...document.querySelectorAll('[role="alert"] button')].find(
        b=>b.textContent.includes('保存を再試行'));
      if(!button)throw Error('Missing recovery action');
      button.click();
    });
    await page.waitForFunction(()=>![...document.querySelectorAll('[role="alert"]')].some(
      el=>el.textContent.includes('プリセット')));
    await page.waitForFunction(async()=>{
      const id=document.querySelector("#layout-select")?.value;
      const db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open("MultiMicrotonalKeyboardDB",1);
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      try{
        const tx=db.transaction(["layoutPresets","appSettings"],"readonly");
        const load=(store,key)=>new Promise((resolve,reject)=>{
          const req=tx.objectStore(store).get(key);
          req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
        });
        const [preset,settings]=await Promise.all([
          load("layoutPresets",id),load("appSettings","current_settings")]);
        return !!preset&&settings?.value?.defaultLayoutPresetId===id;
      }finally{db.close();}
    },{timeout:15000});
    assert.deepEqual(errors,[],"Expected storage denial should be handled, not an uncaught exception");
  }finally{
    if(browser)await browser.close();
    server.kill("SIGTERM");
  }
});
