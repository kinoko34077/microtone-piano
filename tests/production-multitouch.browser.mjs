import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';

// Real compiled React UI and native Chromium touch/pointer dispatch.
// This is NOT a physical iPhone digitizer or acoustic speaker measurement.
const PORT = 8897;
const URL = 'http://127.0.0.1:' + PORT + '/';
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function launchPreview() {
  const server = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', 'preview',
    '--host', '127.0.0.1', '--port', String(PORT), '--strictPort',
  ], {stdio: 'ignore'});
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Vite preview died before listening');
    try {
      if ((await fetch(URL)).ok) return server;
    } catch { /* preview not ready */ }
    await pause(100);
  }
  server.kill('SIGTERM');
  throw new Error('production preview could not start');
}

const percent = (values, q) => {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * q) - 1] * 100) / 100;
};

async function selectPoints(page, row, count) {
  const candidates = await page.evaluate((rowId) => {
    const viewport = document.querySelector('[data-keyboard-viewport="' + rowId + '"]');
    if (!viewport) return {error: 'Missing viewport ' + rowId, points: []};
    const box = viewport.getBoundingClientRect();
    const points = [...viewport.querySelectorAll('[data-key-color="white"]')]
      .map(key => {
        const keyBox = key.getBoundingClientRect();
        const segments = [...key.querySelectorAll('[data-depth]')]
          .filter(el => el.getAttribute('data-invalid') === 'false');
        const segment = segments.at(-1);
        if (!segment) return null;
        const seg = segment.getBoundingClientRect();
        const x = Math.round((keyBox.left + keyBox.right) / 2);
        const y = Math.round((seg.top + seg.bottom) / 2);
        if (keyBox.left < box.left + 3 || keyBox.right > box.right - 3 ||
            y < box.top + 3 || y > box.bottom - 3) return null;
        const target = document.elementFromPoint(x, y);
        if (target?.closest('[data-key-color="white"]') !== key) return null;
        return {x, y, column: key.dataset.keyColumn, depth: segment.dataset.depth};
      })
      .filter(Boolean);
    return {points};
  }, row);
  assert.ok(!candidates.error, candidates.error);
  assert.ok(candidates.points.length >= count,
    'Need ' + count + ' playable touch positions in ' + row + ': ' + JSON.stringify(candidates));
  return Array.from({length: count}, (_, i) =>
    candidates.points[Math.round(i * (candidates.points.length - 1) / Math.max(1, count - 1))]);
}

async function gesture(cdp, points, holdMs, releaseGapMs) {
  const touchPoints = points.map((p, i) => ({
    x: p.x, y: p.y, id: i + 1, radiusX: 5, radiusY: 5,
    force: 0.78, rotationAngle: 0,
  }));
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints});
  await pause(holdMs);
  await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await pause(releaseGapMs);
}

async function runRepeated(page, cdp, name, points, repetitions, holdMs, releaseGapMs) {
  for (let i = 0; i < repetitions; i++) {
    await page.evaluate(id => { window.__fingerBench.phase = id; }, name + '-' + i);
    await gesture(cdp, points, holdMs, releaseGapMs);
    await page.evaluate(() => { window.__fingerBench.phase = null; });
  }
  await pause(120);
  const result = await page.evaluate(({name, repetitions, fingerCount}) => {
    const p = window.__fingerBench;
    const details = [];
    for (let i = 0; i < repetitions; i++) {
      const id = name + '-' + i;
      const downs = p.pointer.filter(v => v.phase === id && v.event === 'pointerdown');
      const ups = p.pointer.filter(v => v.phase === id && v.event === 'pointerup');
      const starts = p.starts.filter(v => v.phase === id);
      const firstDown = downs.length ? Math.min(...downs.map(v => v.at)) : null;
      const lastUp = ups.length ? Math.max(...ups.map(v => v.at)) : null;
      details.push({
        id, downs: downs.length, ups: ups.length, starts: starts.length,
        eventToFirstStart: starts.length && firstDown !== null ?
          Math.min(...starts.map(v => v.at)) - firstDown : null,
        eventToLastStart: starts.length && firstDown !== null ?
          Math.max(...starts.map(v => v.at)) - firstDown : null,
        lateStarts: starts.filter(v => lastUp !== null && v.at > lastUp).length,
      });
    }
    const delays = details.filter(v => v.starts === fingerCount && v.downs === fingerCount)
      .map(v => v.eventToLastStart);
    const sorted = delays.slice().sort((a,b) => a-b);
    const percentile = q => sorted.length ?
      Math.round(sorted[Math.ceil(sorted.length*q)-1]*100)/100 : null;
    return {
      name, repetitions, fingerCount, pointerDowns: details.reduce((s,v)=>s+v.downs,0),
      pointerUps: details.reduce((s,v)=>s+v.ups,0),
      starts: details.reduce((s,v)=>s+v.starts,0),
      missedContacts: details.filter(v=>v.downs!==fingerCount).length,
      droppedSoundBursts: details.filter(v=>v.starts!==fingerCount).length,
      lateStarts: details.reduce((s,v)=>s+v.lateStarts,0),
      lastSourceDelayP50Ms: percentile(.50),
      lastSourceDelayP95Ms: percentile(.95),
      lastSourceDelayMaxMs: sorted.length ? Math.max(...sorted) : null,
      longTasksOver50Ms: p.longTasks.filter(v=>v.at>=p.startAt).length,
      decodedSamples: p.decode.length,
      fetchedSamples: p.fetch.length,
      diagnostics: details.filter(v=>v.downs!==fingerCount || v.ups!==fingerCount ||
        v.starts!==fingerCount || v.lateStarts>0).slice(0,12),
    };
  }, {name, repetitions, fingerCount: points.length});
  console.log('PRODUCTION_MULTITOUCH_RESULT', JSON.stringify(result));
  assert.equal(result.pointerDowns, repetitions * points.length,
    'native CDP touch contacts did not all reach React UI');
  assert.equal(result.pointerUps, repetitions * points.length,
    'native CDP touch releases did not all reach React UI');
  assert.equal(result.starts, repetitions * points.length,
    'one real AudioBufferSourceNode per warmed physical contact was expected');
  assert.equal(result.lateStarts, 0,
    'sample audio must not begin after the associated multi-touch fingers are lifted');
  return result;
}

test('#30 production-built mobile multi-finger tapping: 4/5-finger fast repetition and two-row/wide', {
  timeout: 240000,
}, async () => {
  const server = await launchPreview();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({
      width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    });
    await page.evaluateOnNewDocument(() => {
      const p = {phase: null, pointer: [], starts: [], stops: [], decode: [],
        fetch: [], longTasks: [], startAt: performance.now()};
      window.__fingerBench = p;
      for (const kind of ['pointerdown', 'pointerup', 'pointercancel']) {
        document.addEventListener(kind, event => {
          if (event.pointerType !== 'touch' ||
              !event.target?.closest?.('[data-keyboard-viewport]')) return;
          p.pointer.push({
            phase: p.phase, event: kind, pointerId: event.pointerId,
            at: performance.now(), x: event.clientX, y: event.clientY,
          });
        }, true);
      }
      const originalStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        p.starts.push({phase: p.phase, at: performance.now(),
          when: args[0] ?? 0, currentTime: this.context.currentTime,
          hasBuffer: Boolean(this.buffer)});
        return originalStart.apply(this, args);
      };
      const originalStop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.stop = function (...args) {
        p.stops.push({phase: p.phase, at: performance.now()});
        return originalStop.apply(this, args);
      };
      const originalDecode = AudioContext.prototype.decodeAudioData;
      AudioContext.prototype.decodeAudioData = async function (...args) {
        const at = performance.now();
        const result = await originalDecode.apply(this, args);
        p.decode.push({at, ms: performance.now() - at,
          frames: result.length, channels: result.numberOfChannels});
        return result;
      };
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (String(args[0]).includes('.m4a'))
          p.fetch.push({at: performance.now(), status: response.status});
        return response;
      };
      try {
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.duration >= 50)
              p.longTasks.push({at: entry.startTime, ms: entry.duration});
          }
        }).observe({entryTypes: ['longtask']});
      } catch { /* optional browser timing facility */ }
    });
    await page.goto(URL, {waitUntil: 'networkidle2'});
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
    await page.waitForSelector('[data-keyboard-viewport="lower"] [data-key-color="white"]');
    const five = await selectPoints(page, 'lower', 5);
    console.log('PRODUCTION_MULTITOUCH_TARGETS', JSON.stringify({five, viewport: '412x915@2'}));

    // Real first-use gesture, with real samples and user-gesture AudioContext start.
    await page.evaluate(() => {window.__fingerBench.phase = 'first-cold-5';});
    await gesture(cdp, five, 260, 220);
    await page.evaluate(() => {window.__fingerBench.phase = null;});
    await pause(1500); // allow visible prewarm to catch up; no engine mocks
    await page.evaluate(() => {window.__fingerBench.phase = 'warmup';});
    await gesture(cdp, five, 240, 200);
    await page.evaluate(() => {window.__fingerBench.phase = null;});
    await pause(450);

    await runRepeated(page, cdp, 'four-regular-mobile',
      five.slice(0, 4), 24, 80, 45);
    await runRepeated(page, cdp, 'five-regular-mobile',
      five, 24, 80, 45);
    await runRepeated(page, cdp, 'five-fast-mobile',
      five, 28, 30, 35);

    // Two independently scrolled rows: e.g. two fingers upper, three lower.
    await page.click('button[aria-label="メニューを開く"]');
    await page.evaluate(() => {
      const toggle = [...document.querySelectorAll('label')].find(el =>
        el.textContent.includes('上下2段で表示する'))?.querySelector('input');
      if (!toggle) throw Error('Two-row setting missing');
      if (!toggle.checked) toggle.click();
    });
    await page.click('button[aria-label="設定メニューを閉じる"]');
    await page.waitForSelector('[data-keyboard-viewport="upper"]');
    await pause(1000);
    const upper = await selectPoints(page, 'upper', 2);
    const lower = await selectPoints(page, 'lower', 3);
    const twoRows = [...upper, ...lower];
    await page.evaluate(() => {window.__fingerBench.phase = 'warmup-two';});
    await gesture(cdp, twoRows, 260, 220);
    await page.evaluate(() => {window.__fingerBench.phase = null;});
    await pause(350);
    await runRepeated(page, cdp, 'five-two-row-mobile', twoRows, 20, 80, 45);

    // Wide touch display exercises larger visible predecode set.
    await page.setViewport({
      width: 1180, height: 740, deviceScaleFactor: 1, isMobile: false, hasTouch: true,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', {enabled: true, maxTouchPoints: 5});
    await pause(650);
    const wide = await selectPoints(page, 'lower', 5);
    await page.evaluate(() => {window.__fingerBench.phase = 'warmup-wide';});
    await gesture(cdp, wide, 240, 250);
    await page.evaluate(() => {window.__fingerBench.phase = null;});
    await pause(300);
    await runRepeated(page, cdp, 'five-wide-touch-display', wide, 20, 80, 45);

    const final = await page.evaluate(() => {
      const p = window.__fingerBench;
      return {
        fullPath: 'Vite production build + React pointer handlers + native AudioBufferSourceNode',
        physicalTouchHardware: false, physicalAudioCapture: false,
        touchPointerEvents: p.pointer.length, starts: p.starts.length, stops: p.stops.length,
        decodedSamples: p.decode.length, fetchedSamples: p.fetch.length,
        longTaskCount: p.longTasks.length,
        longestLongTaskMs: p.longTasks.length ? Math.max(...p.longTasks.map(x => x.ms)) : 0,
        firstCold: {
          downs: p.pointer.filter(x=>x.phase==='first-cold-5'&&x.event==='pointerdown').length,
          starts: p.starts.filter(x=>x.phase==='first-cold-5').length,
        },
      };
    });
    console.log('PRODUCTION_MULTITOUCH_TOTAL', JSON.stringify(final));
    assert.deepEqual(errors, [], 'unexpected app runtime JavaScript error');
    assert.ok(final.decodedSamples >= 1, 'must have used actual M4A decoder');
    assert.ok(final.starts > 200, 'not enough actual source nodes to count as a stress run');
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
});
