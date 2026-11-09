import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';

// #30: real compiled React keyboard, real original M4A and WebAudio.
// The *network* is held back on purpose. No oscillator or audio-engine mock.
// Mobile Chromium CDP contacts are not physical iPhone touch/speaker output.
const PORT = 8899;
const URL = 'http://127.0.0.1:' + PORT + '/';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startPreview() {
  const server = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', 'preview',
    '--host', '127.0.0.1', '--port', String(PORT), '--strictPort',
  ], {stdio:'ignore'});
  for (let i=0;i<100;i++) {
    if (server.exitCode !== null) throw Error('preview exited before server listening');
    try { if ((await fetch(URL)).ok) return server; } catch { /* retry */ }
    await sleep(125);
  }
  server.kill('SIGTERM');
  throw Error('production build preview startup timed out');
}

async function freshPage(browser, {gateSamples, throttleCpu=4, width=412}={}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  const assets = {blocked:[], requests:[], released:false, delayMs:220, delivered:0};
  page.on('pageerror', error=>errors.push(error.message));
  await page.setViewport({
    width, height:width>600?740:915,
    deviceScaleFactor:width>600?1:2,
    isMobile:width<=600, hasTouch:true,
  });
  await page.setBypassServiceWorker(true);
  await page.setCacheEnabled(false);
  if (gateSamples) {
    await page.setRequestInterception(true);
    const releaseRequest = async request => {
      try {
        await sleep(assets.delayMs);
        await request.continue();
        assets.delivered++;
      } catch (error) {
        assets.errors ??= [];
        assets.errors.push(String(error));
      }
    };
    page.on('request', request => {
      if (/\.m4a(?:\?|$)/i.test(request.url())) {
        assets.requests.push(request.url());
        if (!assets.released) assets.blocked.push(request);
        else void releaseRequest(request);
      } else {
        void request.continue();
      }
    });
    assets.release = async () => {
      assets.released = true;
      const q=assets.blocked.splice(0);
      await Promise.all(q.map(releaseRequest));
    };
  }
  await page.evaluateOnNewDocument(() => {
    const logs={phase:null,pointers:[],starts:[],decodes:[],longTasks:[],createdAt:performance.now()};
    const ids=new WeakMap();let nextId=1;
    window.__coldTouch=logs;
    for (const name of ['pointerdown','pointerup','pointercancel']) {
      document.addEventListener(name,e=>{
        if (e.pointerType!=='touch' || !e.target?.closest?.('[data-keyboard-viewport]')) return;
        logs.pointers.push({phase:logs.phase,type:name,id:e.pointerId,at:performance.now(),
          x:e.clientX,y:e.clientY});
      },true);
    }
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args) {
      if (this.buffer && !ids.has(this.buffer)) ids.set(this.buffer,nextId++);
      logs.starts.push({phase:logs.phase,at:performance.now(),
        bufferId:ids.get(this.buffer)??null,
        contextState:this.context.state,scheduledAt:args[0]??0});
      return start.apply(this,args);
    };
    const decode=AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData=async function(...args) {
      const t=performance.now();
      const buffer=await decode.apply(this,args);
      if (!ids.has(buffer)) ids.set(buffer,nextId++);
      logs.decodes.push({at:t,ms:performance.now()-t,
        pcmBytes:buffer.length*buffer.numberOfChannels*4,
        bufferId:ids.get(buffer),compressedBytes:args[0]?.byteLength??null});
      return buffer;
    };
    try {
      new PerformanceObserver(list=>{
        for(const t of list.getEntries()) if(t.duration>=50)
          logs.longTasks.push({at:t.startTime,ms:t.duration});
      }).observe({entryTypes:['longtask']});
    } catch { /* longtask API optional */ }
  });
  // Gated sample requests must NOT deadlock navigation.
  await page.goto(URL, {waitUntil:'domcontentloaded'});
  await page.waitForSelector('[data-keyboard-viewport="lower"] [data-key-color="white"]');
  const cdp=await page.createCDPSession();
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  if(throttleCpu>1) await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttleCpu});
  return {page,context,cdp,assets,errors};
}

async function scrollTo(page, ratio) {
  await page.evaluate(frac=>{
    const el=document.querySelector('[data-keyboard-viewport="lower"]');
    if(!el) throw Error('missing real keyboard');
    el.scrollLeft=(el.scrollWidth-el.clientWidth)*frac;
    el.dispatchEvent(new Event('scroll',{bubbles:true}));
  },ratio);
  await sleep(180);
  const position=await page.evaluate(()=>{
    const el=document.querySelector('[data-keyboard-viewport="lower"]');
    const whites=[...el.querySelectorAll('[data-key-color="white"]')];
    return {scrollLeft:el.scrollLeft,firstColumn:Number(whites[0]?.dataset.keyColumn),
      fraction:el.scrollLeft/Math.max(1,el.scrollWidth-el.clientWidth)};
  });
  assert.ok(Math.abs(position.fraction-ratio)<0.055,
    'scroll did not reach requested register '+JSON.stringify(position));
  return position;
}

async function playablePoints(page, fingerCount=5, spread=true) {
  const keys=await page.evaluate(()=>{
    const root=document.querySelector('[data-keyboard-viewport="lower"]');
    const viewport=root.getBoundingClientRect();
    return [...root.querySelectorAll('[data-key-color="white"]')].flatMap(key=>{
      const segment=[...key.querySelectorAll('[data-depth]')]
        .find(x=>x.dataset.depth==='0'&&x.dataset.invalid==='false');
      if(!segment)return [];
      const rect=segment.getBoundingClientRect();
      const x=Math.round((rect.left+rect.right)/2);
      const y=Math.round((rect.top+rect.bottom)/2);
      if(x<viewport.left+7||x>viewport.right-7||
        y<viewport.top+7||y>viewport.bottom-7||
        document.elementFromPoint(x,y)?.closest('[data-key-color="white"]')!==key)return [];
      return [{x,y,column:Number(key.dataset.keyColumn)}];
    });
  });
  assert.ok(keys.length>=fingerCount,'insufficient selectable visible white keys: '+keys.length);
  const chosen=Array.from({length:fingerCount},(_,i)=>
    keys[spread?Math.round(i*(keys.length-1)/Math.max(1,fingerCount-1)):i]);
  assert.equal(new Set(chosen.map(x=>x.column)).size,fingerCount);
  return chosen;
}

async function phase(page,label) {
  await page.evaluate(name=>{window.__coldTouch.phase=name;},label);
}
async function startContacts(cdp,points) {
  await cdp.send('Input.dispatchTouchEvent',{
    type:'touchStart',touchPoints:points.map((p,i)=>({
      x:p.x,y:p.y,id:i+1,radiusX:5,radiusY:5,force:.85,rotationAngle:0,
    })),
  });
}
async function endContacts(cdp) {
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
async function readPhase(page,name) {
  return page.evaluate(id=>{
    const p=window.__coldTouch;
    const down=p.pointers.filter(x=>x.phase===id&&x.type==='pointerdown');
    const up=p.pointers.filter(x=>x.phase===id&&x.type==='pointerup');
    const starts=p.starts.filter(x=>x.phase===id);
    const releasedAt=up.length?Math.max(...up.map(x=>x.at)):null;
    const firstAt=down.length?Math.min(...down.map(x=>x.at)):null;
    return {
      downs:down.length,ups:up.length,starts:starts.length,
      lateStarts:starts.filter(x=>releasedAt!==null&&x.at>releasedAt).length,
      suspendedStarts:starts.filter(x=>x.contextState!=='running').length,
      startToLastMs:starts.length&&firstAt!==null?
        Math.round((Math.max(...starts.map(x=>x.at))-firstAt)*100)/100:null,
      uniqueDecodedBuffers:[...new Set(starts.map(x=>x.bufferId))],
      decodeCount:p.decodes.length,
      decodedPCMBytes:p.decodes.reduce((sum,x)=>sum+x.pcmBytes,0),
      maxDecodeMs:p.decodes.length?Math.max(...p.decodes.map(x=>x.ms)):0,
      longTasks:p.longTasks.length,
    };
  },name);
}

async function coldHeld(browser,fingers,ratio) {
  const env=await freshPage(browser,{gateSamples:true,throttleCpu:4});
  try {
    const {page,cdp,assets}=env;
    const position=await scrollTo(page,ratio);
    const points=await playablePoints(page,fingers);
    assert.equal((await readPhase(page,'no-touch')).decodeCount,0,
      'not a truly uncached context; pre-gesture decoder already ran');
    await phase(page,'cold-held');
    await startContacts(cdp,points);
    await sleep(90);
    const before=await readPhase(page,'cold-held');
    assert.equal(before.downs,fingers);
    assert.equal(before.starts,0,'sample started while all real sample requests are held back');
    assert.ok(assets.blocked.length>=1,'no real M4A request was intercepted');
    const gateAt=Date.now();
    await assets.release();
    await sleep(800);
    await endContacts(cdp);
    await sleep(110);
    const result=await readPhase(page,'cold-held');
    const report={case:'cold-held',fingers,position,sampleRequests:assets.requests.length,
      blockedUntilGesture:true,networkReleaseDelayMs:assets.delayMs,
      gateWallMs:Date.now()-gateAt, ...result};
    console.log('COLD_REGISTER_CHORD',JSON.stringify(report));
    assert.equal(result.downs,fingers);
    assert.equal(result.ups,fingers);
    assert.equal(result.starts,fingers,
      'held fresh chord failed to start all real piano sample sources');
    assert.equal(result.lateStarts,0);
    assert.equal(result.suspendedStarts,0);
    assert.ok(result.decodeCount>=1,'no native compressed M4A decode');
    assert.ok(result.startToLastMs>=90,
      'no observable delay despite intentionally blocked sample requests');
    assert.deepEqual(env.errors,[]);
    return report;
  }finally{
    if(env.assets.release&&!env.assets.released)await env.assets.release();
    await env.context.close();
  }
}

async function coldShortThenRetry(browser) {
  const env=await freshPage(browser,{gateSamples:true,throttleCpu:4});
  try {
    const {page,cdp,assets}=env;
    const position=await scrollTo(page,1);
    const five=await playablePoints(page,5);
    await phase(page,'short-before-network');
    await startContacts(cdp,five);
    await sleep(35);
    await endContacts(cdp);
    await sleep(95);
    const before=await readPhase(page,'short-before-network');
    assert.equal(before.starts,0,'blocked audio unexpectedly started in first 35ms tap');
    assert.ok(assets.blocked.length>=1);
    await assets.release();
    await sleep(600);
    const short=await readPhase(page,'short-before-network');
    // A 35ms tap with an unavailable sample cannot become audible later.
    assert.equal(short.downs,5);
    assert.equal(short.ups,5);
    assert.equal(short.starts,0,'cancelled notes must not start after sample decode');
    await phase(page,'retry-after-decode');
    await startContacts(cdp,five);
    await sleep(380);
    await endContacts(cdp);
    await sleep(120);
    const retry=await readPhase(page,'retry-after-decode');
    console.log('COLD_SHORT_RETRY',JSON.stringify({
      position,blockedM4a:assets.requests.length,short,retry,
    }));
    assert.equal(retry.downs,5);
    assert.equal(retry.ups,5);
    assert.equal(retry.starts,5,'real samples not reused on next chord');
    assert.equal(retry.lateStarts,0);
    assert.equal(retry.suspendedStarts,0);
    assert.deepEqual(env.errors,[]);
  }finally{
    if(env.assets.release&&!env.assets.released)await env.assets.release();
    await env.context.close();
  }
}

async function staleMidToHigh(browser) {
  const env=await freshPage(browser,{gateSamples:true,throttleCpu:4});
  try{
    const {page,cdp,assets}=env;
    const mid=await scrollTo(page,.5);
    const first=await playablePoints(page,5);
    await phase(page,'stale-mid-35ms');
    await startContacts(cdp,first);
    await sleep(35);
    await endContacts(cdp);
    // Move to an actually different register while all old fetches are pending.
    const high=await scrollTo(page,1);
    const second=await playablePoints(page,5);
    await phase(page,'new-high-held');
    await startContacts(cdp,second);
    await sleep(85);
    const before=await readPhase(page,'new-high-held');
    assert.equal(before.starts,0,'new register notes started before M4A response');
    await assets.release();
    await sleep(850);
    await endContacts(cdp);
    await sleep(100);
    const stale=await readPhase(page,'stale-mid-35ms');
    const active=await readPhase(page,'new-high-held');
    console.log('COLD_MID_HIGH_INFLIGHT',JSON.stringify({
      mid,high,blockedM4a:assets.requests.length,stale,active,
    }));
    assert.ok(mid.firstColumn<high.firstColumn,'register did not change');
    assert.equal(stale.downs,5);
    assert.equal(stale.ups,5);
    assert.equal(stale.starts,0,
      'stale earlier finger started piano after it was released and scrolled away');
    assert.equal(active.downs,5);
    assert.equal(active.ups,5);
    assert.equal(active.starts,5,'new register 5-finger chord failed during old fetch');
    assert.equal(active.lateStarts,0);
    assert.equal(active.suspendedStarts,0);
    assert.deepEqual(env.errors,[]);
  }finally{
    if(env.assets.release&&!env.assets.released)await env.assets.release();
    await env.context.close();
  }
}

async function naturalCacheChurn(browser) {
  const env=await freshPage(browser,{gateSamples:false,throttleCpu:2,width:1180});
  try {
    const {page,cdp}=env;
    const windows=[];
    let firstIds=[];
    for(const [index,ratio] of [0,.125,.25,.375,.5,.625,.75,.875,1,0].entries()) {
      const position=await scrollTo(page,ratio);
      const five=await playablePoints(page,5);
      const id='churn-'+index;
      await phase(page,id);
      await startContacts(cdp,five);
      await sleep(380);
      await endContacts(cdp);
      await sleep(200);
      const obs=await readPhase(page,id);
      const report={index,ratio,position,starts:obs.starts,
        sampleBufferIds:obs.uniqueDecodedBuffers,decodedPCMBytesTotal:obs.decodedPCMBytes,
        decodeCountTotal:obs.decodeCount};
      windows.push(report);
      if(index===0)firstIds=obs.uniqueDecodedBuffers;
      assert.equal(obs.downs,5);
      assert.equal(obs.ups,5);
      assert.equal(obs.lateStarts,0);
      assert.equal(obs.suspendedStarts,0);
    }
    const last=windows.at(-1);
    const newBuffers=last.sampleBufferIds.filter(id=>!firstIds.includes(id));
    const totalDistinctBuffers=new Set(windows.flatMap(x=>x.sampleBufferIds)).size;
    console.log('NATURAL_PCM_CHURN',JSON.stringify({
      note:'Re-decode after scrolling is evidence of actual cache eviction; no forced internal cache mutation',
      windows,firstIds,lastIds:last.sampleBufferIds,
      firstReturnDifferentBufferCount:newBuffers.length,totalDistinctBuffers,
      decodedPCMBytesTotal:last.decodedPCMBytesTotal,
      errors:env.errors,
    }));
    assert.ok(windows[0].position.firstColumn < windows[8].position.firstColumn);
    assert.ok(totalDistinctBuffers>=10,
      'walking the keyboard did not use enough distinct real audio sample buffers');
    // This is a diagnostic: eviction might not be reached under an exact set
    // of display widths and source sample sizes. Never claim it if absent.
    assert.deepEqual(env.errors,[]);
  } finally {await env.context.close();}
}

test('#30 real cold five-finger / short release / rapid register switch, plus natural PCM churn', {
  timeout:300000,
},async()=>{
  const server=await startPreview();
  let browser;
  try{
    browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',
      headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const reports=[];
    reports.push(await coldHeld(browser,4,.5));
    reports.push(await coldHeld(browser,5,1));
    await coldShortThenRetry(browser);
    await staleMidToHigh(browser);
    await naturalCacheChurn(browser);
    console.log('COLD_MULTI_TOUCH_ACCEPTED',JSON.stringify({
      contexts:5,coldHeldRuns:reports.length,realSampleRequestsHeld:true,
      cpuThrottled:true,productionBuild:true,
      physicalAudioCapture:false,physicalIOSDevice:false,
    }));
  }finally{
    await browser?.close();
    server.kill('SIGTERM');
  }
});
