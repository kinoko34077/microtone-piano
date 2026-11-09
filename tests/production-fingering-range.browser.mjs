import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';

// #30 specific-chord regression: 12EDO lower/middle/upper register, 24EDO,
// 31EDO multi-depth, white/black mixed fingerings, changing chord identities.
// Real production build, native CDP 4/5-touch events and real M4A/Web Audio.
// This does not measure a physical digitizer, Safari or a speaker waveform.
const PORT = 8898;
const URL = 'http://127.0.0.1:' + PORT + '/';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const metric = (a, q) => a.length ?
  Math.round(a.slice().sort((x, y) => x - y)[Math.ceil(a.length * q) - 1] * 100) / 100 : null;

async function preview() {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview',
    '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {stdio: 'ignore'});
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw Error('preview process terminated');
    try { if ((await fetch(URL)).ok) return server; } catch { /* listen pending */ }
    await pause(130);
  }
  server.kill('SIGTERM');
  throw Error('production preview not ready');
}

async function setScroll(page, fraction) {
  const target = await page.evaluate(ratio => {
    const el = document.querySelector('[data-keyboard-viewport="lower"]');
    if (!el) throw Error('missing lower viewport');
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollLeft = max * ratio;
    el.dispatchEvent(new Event('scroll', {bubbles: true}));
    return {max, asked: ratio};
  }, fraction);
  await pause(260); // let React update and render the new visible columns
  const seen = await page.evaluate(() => {
    const el = document.querySelector('[data-keyboard-viewport="lower"]');
    const keys = [...el.querySelectorAll('[data-key-color="white"]')];
    return {fraction: el.scrollWidth > el.clientWidth ?
      el.scrollLeft / (el.scrollWidth - el.clientWidth) : 0,
      firstColumn: Number(keys[0]?.dataset.keyColumn),
      lastColumn: Number(keys.at(-1)?.dataset.keyColumn),
      visibleWhiteKeys: keys.length,
      scrollLeft: el.scrollLeft};
  });
  assert.ok(target.max > 1200, 'keyboard register span insufficient for low/mid/high test');
  assert.ok(Math.abs(seen.fraction - fraction) < 0.04,
    'React viewport did not keep requested scroll register: ' + JSON.stringify(seen));
  return seen;
}

async function getTargets(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-keyboard-viewport="lower"]');
    if (!root) throw Error('lower viewport not found');
    const frame = root.getBoundingClientRect();
    return [...root.querySelectorAll('[data-key-color]')].flatMap(key => {
      const keyRect = key.getBoundingClientRect();
      return [...key.querySelectorAll('[data-depth]')].flatMap(segment => {
        if (segment.getAttribute('data-invalid') !== 'false') return [];
        const box = segment.getBoundingClientRect();
        const x = Math.round((keyRect.left + keyRect.right) / 2);
        const y = Math.round((box.top + box.bottom) / 2);
        if (x < frame.left + 5 || x > frame.right - 5 ||
            y < frame.top + 5 || y > frame.bottom - 5) return [];
        if (document.elementFromPoint(x,y)?.closest('[data-key-color]') !== key) return [];
        return [{
          x,y,kind:key.dataset.keyColor,depth:Number(segment.dataset.depth),
          column:Number(key.dataset.keyColumn),
          signature:key.dataset.keyColor + ':' + key.dataset.keyColumn + ':' + segment.dataset.depth,
        }];
      });
    }).sort((a,b)=>a.column-b.column || a.depth-b.depth);
  });
}

function constructChord(targets, family, index, pitchMode) {
  const white = targets.filter(x=>x.kind==='white' && x.depth===0);
  const black = targets.filter(x=>x.kind==='black' && x.depth===0);
  const whiteColumns = [...new Set(white.map(x=>x.column))];
  assert.ok(whiteColumns.length >= 5, 'not enough playable visible white columns');
  const pickWhite = (n, shift) => Array.from({length:n},(_,i)=>
    white[(i+shift)%white.length]);

  let chord;
  if (family==='four-white-rotating') {
    chord = white.filter((_,i)=>i !== index % white.length).slice(0,4);
    if(chord.length!==4) chord=pickWhite(4,index);
  } else if (family==='five-mixed') {
    assert.ok(black.length>=2, 'mixed chord needs 2 actual playable black keys');
    const orderedWhite = [white[index%white.length],
      white[(index+2)%white.length],white[(index+4)%white.length]];
    const orderedBlack = [black[index%black.length],black[(index+1)%black.length]];
    chord = [...orderedWhite,...orderedBlack];
  } else if(family==='four-black-heavy') {
    assert.ok(black.length>=2);
    chord = [white[index%white.length],white[(index+3)%white.length],
      black[index%black.length],black[(index+1)%black.length]];
  } else if(family==='five-depth-rotating') {
    const depths = pitchMode===31 ? 3 : 2;
    const columns = whiteColumns.slice(0,5);
    chord = columns.map((col,i)=>{
      const preferred = (index+i)%depths;
      return targets.find(p=>p.kind==='white'&&p.column===col&&p.depth===preferred)
        ?? targets.find(p=>p.kind==='white'&&p.column===col&&p.depth===0);
    });
    assert.ok(new Set(chord.map(x=>x.depth)).size >= 2,
      'multi-depth test must use more than depth zero');
  } else {
    throw Error('unknown fingering family '+family);
  }
  assert.equal(chord.length, family.startsWith('four-')?4:5);
  assert.equal(new Set(chord.map(p=>p.signature)).size,chord.length,
    'same physical key/segment selected twice');
  // Fingers must be genuinely separated on glass and not collapse to one point.
  for(let i=0;i<chord.length;i++) for(let j=i+1;j<chord.length;j++) {
    assert.ok(Math.hypot(chord[i].x-chord[j].x,chord[i].y-chord[j].y)>=17,
      'finger targets too close: '+JSON.stringify([chord[i],chord[j]]));
  }
  return chord;
}

async function touch(cdp, points, hold=82, rest=42) {
  const p=points.map((v,i)=>({x:v.x,y:v.y,id:i+1,force:0.85,radiusX:5,radiusY:5}));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:p});
  await pause(hold);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await pause(rest);
}

async function runMatrixGroup(page,cdp,label,targets,family,mode,cycles=20) {
  // Exercise exact real samples on an initial held chord first. This allows a
  // subsequent warm steady-state comparison while retaining first-load data.
  const first = constructChord(targets,family,0,mode);
  await page.evaluate(id=>{window.__fingerMatrix.phase=id;},label+'-warmup');
  await touch(cdp,first,300,210);
  await page.evaluate(()=>{window.__fingerMatrix.phase=null;});
  const firstChord = await page.evaluate(({id, expected}) => {
    const p=window.__fingerMatrix;
    const downs=p.downs.filter(v=>v.phase===id);
    const ups=p.ups.filter(v=>v.phase===id);
    const starts=p.starts.filter(v=>v.phase===id);
    const eventAt=downs.length?Math.min(...downs.map(x=>x.at)):null;
    const releasedAt=ups.length?Math.max(...ups.map(x=>x.at)):null;
    return {
      expected,downs:downs.length,ups:ups.length,starts:starts.length,
      firstChordLastStartMs:eventAt!==null&&starts.length?
        Math.round((Math.max(...starts.map(x=>x.at))-eventAt)*100)/100:null,
      postRelease:starts.filter(x=>releasedAt!==null&&x.at>releasedAt).length,
      sampleBuffers:[...new Set(starts.map(x=>x.sampleId))],
    };
  },{id:label+'-warmup',expected:first.length});
  console.log('FINGERING_FIRST_AFTER_GROUP_CHANGE',JSON.stringify({group:label,...firstChord}));
  assert.equal(firstChord.downs,first.length);
  assert.equal(firstChord.ups,first.length);
  assert.equal(firstChord.postRelease,0,'new group sample started only after release: '+label);
  // Record first held chord separately from steady-state; a cancellation of
  // a not-ready sample is a real observation, not grounds to call warm latency.
  await pause(250);

  const signatures=new Set();
  for(let i=0;i<cycles;i++) {
    const chord=constructChord(targets,family,i,mode);
    signatures.add(chord.map(x=>x.signature).sort().join('|'));
    await page.evaluate(id=>{window.__fingerMatrix.phase=id;},label+'-'+i);
    await touch(cdp,chord,82,46);
    await page.evaluate(()=>{window.__fingerMatrix.phase=null;});
  }
  await pause(80);
  const result=await page.evaluate(({name,cycles})=>{
    const p=window.__fingerMatrix, rows=[];
    for(let i=0;i<cycles;i++){
      const id=name+'-'+i;
      const downs=p.downs.filter(v=>v.phase===id);
      const ups=p.ups.filter(v=>v.phase===id);
      const starts=p.starts.filter(v=>v.phase===id);
      const firstAt=downs.length?Math.min(...downs.map(v=>v.at)):null;
      const lastUp=ups.length?Math.max(...ups.map(v=>v.at)):null;
      rows.push({downs:downs.length,ups:ups.length,starts:starts.length,
        late:starts.filter(v=>lastUp!==null&&v.at>lastUp).length,
        suspended:starts.filter(v=>v.contextState!=='running').length,
        lastDelay:firstAt!==null&&starts.length?
          Math.max(...starts.map(v=>v.at))-firstAt:null,
        sampleIds:[...new Set(starts.map(v=>v.sampleId))]});
    }
    return {rows, longTasks:p.longTasks.length};
  },{name:label,cycles});
  const all=result.rows;
  const expected=first.length*cycles;
  const count=field=>all.reduce((sum,row)=>sum+row[field],0);
  const delays=all.filter(x=>x.starts===first.length&&x.downs===first.length)
    .map(x=>x.lastDelay);
  const report={
    group:label,mode,family,cycles,fingers:first.length,
    uniqueChordSignatures:signatures.size,
    firstKeys:first.map(x=>x.signature),
    firstChordAfterGroupSwitch:firstChord,
    receivedDowns:count('downs'),receivedUps:count('ups'),
    scheduledSourceStarts:count('starts'),
    expected,lateStarts:count('late'),suspendedStarts:count('suspended'),
    sampleBuffers:[...new Set(all.flatMap(v=>v.sampleIds))].sort((a,b)=>a-b),
    p50Ms:metric(delays,0.5),p95Ms:metric(delays,0.95),
    maxMs:delays.length?Math.max(...delays):null,
    firstFewFailures:all.map((row,i)=>({i,...row})).filter(x=>
      x.downs!==first.length||x.ups!==first.length||x.starts!==first.length||
      x.late>0||x.suspended>0).slice(0,8),
  };
  console.log('FINGERING_RANGE_GROUP',JSON.stringify(report));
  assert.ok(report.uniqueChordSignatures>=2,
    'constant fingering accidentally reused for '+label);
  assert.equal(report.receivedDowns,expected,'missing UI pointerdown '+label);
  assert.equal(report.receivedUps,expected,'missing UI pointerup '+label);
  assert.equal(report.scheduledSourceStarts,expected,'missing real sample starts '+label);
  assert.equal(report.lateStarts,0,'started after release '+label);
  assert.equal(report.suspendedStarts,0,'audio context not running '+label);
  return report;
}

async function selectEdo(page,edo){
  await page.click('button[aria-label="メニューを開く"]');
  await page.select('#layout-select','standard-layout-'+edo+'edo');
  await page.select('#tuning-select','standard-tuning-'+edo+'edo');
  await page.click('button[aria-label="設定メニューを閉じる"]');
  await page.waitForFunction(n=>{
    const v=document.querySelector('[data-keyboard-viewport="lower"]');
    return v?.querySelectorAll('[data-key-color="white"] [data-depth="'+(n===31?2:1)+'"]').length>=4;
  },{},edo);
  await pause(400);
}

test('#30 varied fingerings and register extremes on real compiled keyboard', {timeout:240000},async()=>{
  const server=await preview();
  let browser;
  try{
    browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',
      headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:412,height:915,deviceScaleFactor:2,isMobile:true,hasTouch:true});
    await page.evaluateOnNewDocument(()=>{
      const p={phase:null,downs:[],ups:[],starts:[],longTasks:[]};
      window.__fingerMatrix=p;
      const samples=new WeakMap();
      let nextSample=1;
      for(const event of ['pointerdown','pointerup']){
        document.addEventListener(event,e=>{
          if(e.pointerType!=='touch'||!e.target?.closest?.('[data-keyboard-viewport]'))return;
          p[event==='pointerdown'?'downs':'ups'].push({
            phase:p.phase,at:performance.now(),pointerId:e.pointerId
          });
        },true);
      }
      const nativeStart=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...a){
        if(this.buffer&&!samples.has(this.buffer))samples.set(this.buffer,nextSample++);
        p.starts.push({phase:p.phase,at:performance.now(),sampleId:samples.get(this.buffer)??0,
          contextState:this.context.state});
        return nativeStart.apply(this,a);
      };
      try{
        new PerformanceObserver(list=>{
          for(const e of list.getEntries())if(e.duration>=50)
            p.longTasks.push({at:e.startTime,ms:e.duration});
        }).observe({entryTypes:['longtask']});
      }catch{}
    });
    await page.goto(URL,{waitUntil:'networkidle2'});
    await page.waitForSelector('[data-keyboard-viewport="lower"] [data-key-color="white"]');
    const cdp=await page.createCDPSession();
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    const results=[];
    const locations=[];
    for(const [name,ratio] of [['low',0],['mid',0.5],['high',1]]){
      const range=await setScroll(page,ratio);
      const keys=await getTargets(page);
      locations.push({name,...range,keyCandidates:keys.length,
        blackCandidates:keys.filter(x=>x.kind==='black'&&x.depth===0).length});
      for(const family of ['four-white-rotating','five-mixed','four-black-heavy']){
        results.push(await runMatrixGroup(page,cdp,'12edo-'+name+'-'+family,
          keys,family,12,20));
      }
    }
    assert.ok(locations[0].firstColumn<locations[1].firstColumn &&
      locations[1].firstColumn<locations[2].firstColumn,
      'low/mid/high must be distinct actual keyboard registers');

    // Deep-key layouts: confirm combinations of 2- and 3-depth notes, not
    // merely repeated 12EDO white-key contacts.
    for(const mode of [24,31]){
      await selectEdo(page,mode);
      const range=await setScroll(page,0.5);
      const keys=await getTargets(page);
      const depths=[...new Set(keys.map(x=>x.depth))].sort();
      assert.ok(depths.length>1,'layout does not expose multi-depth playable keys');
      locations.push({name:mode+'edo-mid',...range,keyCandidates:keys.length,depths});
      for(const family of ['five-depth-rotating','five-mixed']){
        results.push(await runMatrixGroup(page,cdp,mode+'edo-mid-'+family,
          keys,family,mode,20));
      }
    }
    const totalExpected=results.reduce((n,r)=>n+r.expected,0);
    const allBuffers=[...new Set(results.flatMap(x=>x.sampleBuffers))];
    const report={
      compiledApp:true,physicalDigitizer:false,physicalSpeakerLatency:false,
      locations,groups:results.length,totalExpected,
      totalStarts:results.reduce((n,r)=>n+r.scheduledSourceStarts,0),
      uniqueFingerings:results.reduce((n,r)=>n+r.uniqueChordSignatures,0),
      distinctWebAudioBuffers:allBuffers.length,
      noErrors:errors.length===0,
      maxP95Ms:Math.max(...results.map(x=>x.p95Ms??0)),
    };
    console.log('FINGERING_RANGE_AGGREGATE',JSON.stringify(report));
    assert.ok(totalExpected>=1000,'not enough diverse multi-finger contacts');
    assert.ok(allBuffers.length>=5,'sample identity did not change across keyboard registers');
    assert.deepEqual(errors,[],'app browser errors');
  }finally{await browser?.close();server.kill('SIGTERM');}
});
