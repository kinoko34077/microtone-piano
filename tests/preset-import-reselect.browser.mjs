import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
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
