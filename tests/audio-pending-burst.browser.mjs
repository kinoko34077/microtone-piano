import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';

const HOST = 'http://127.0.0.1:8796';

async function launchHarness() {
  const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '8796', '--strictPort'], {
    stdio: 'ignore',
  });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 85; i++) {
      try {
        const res = await fetch(HOST + '/');
        if (res.ok) { ready = true; break; }
      } catch { /* Vite has not started yet */ }
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    assert.ok(ready, 'Vite development module server unavailable');
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(HOST + '/', {waitUntil: 'domcontentloaded'});
    return {server, browser, page, errors};
  } catch (error) {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    throw error;
  }
}

function fakeAudioGraph() {
  // Stringified into the browser below to avoid relying on a physical audio device.
  return null;
}

test('#30 deterministic burst: pending sample notes obey existing 32-voice capacity', {timeout: 60000}, async () => {
  const h = await launchHarness();
  try {
    const evidence = await h.page.evaluate(async () => {
      const {AudioEngine} = await import('/src/core/audio.ts');
      const gain = () => ({
        gain: {
          value: 0.5,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
          cancelScheduledValues() {},
        },
        connect() {},
        disconnect() {},
      });
      const ctx = {state: 'running', currentTime: 1, destination: {}, createGain: gain};
      const engine = new AudioEngine();
      engine.masterGain = gain();
      engine.ensureAudioContext = async () => ctx;
      engine.schedulePianoPreload = () => {};

      const delayed = [];
      engine.createSourcesForVoice = async () => new Promise(resolve => {
        delayed.push(resolve);
      });
      const startedAt = performance.now();
      const ids = await Promise.all(Array.from({length: 48}, (_, index) =>
        engine.noteOn(index, index, 440 + index, 1, 'stress-' + index)));
      const pendingBeforeRelease = engine.pendingVoices.size;
      const reportedPendingCount = engine.pendingVoiceCount;
      const cancelledBeforeRelease = delayed.length -
        [...engine.pendingVoices.values()].filter(x => !x.cancelled).length;
      for (const resolve of delayed) resolve({oscillators: [], sourceNodes: []});
      await new Promise(resolve => setTimeout(resolve, 35));
      const activeAfterResolve = engine.getActiveVoices().length;
      const pendingAfterResolve = engine.pendingVoices.size;
      engine.allNotesOff();
      return {issued: ids.length, pendingBeforeRelease, reportedPendingCount,
        cancelledBeforeRelease, activeAfterResolve, pendingAfterResolve,
        elapsedMs: performance.now() - startedAt};
    });
    console.log('AUDIO_PENDING_BURST_EVIDENCE', JSON.stringify(evidence));
    assert.equal(evidence.issued, 48);
    assert.ok(evidence.pendingBeforeRelease <= 32,
      '48 concurrent uncached notes must not retain >32 actionable pending voices');
    assert.ok(evidence.reportedPendingCount <= 32);
    assert.ok(evidence.activeAfterResolve <= 32);
    assert.equal(evidence.pendingAfterResolve, 0);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.browser.close();
    h.server.kill('SIGTERM');
  }
});

test('#30 allNotesOff during audio startup prevents the earlier note from sounding', {timeout: 60000}, async () => {
  const h = await launchHarness();
  try {
    const evidence = await h.page.evaluate(async () => {
      const {AudioEngine} = await import('/src/core/audio.ts');
      const gain = () => ({
        gain: {
          value: 0.5, setValueAtTime() {}, linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {}, cancelScheduledValues() {},
        },
        connect() {}, disconnect() {},
      });
      const ctx = {state: 'running', currentTime: 1, destination: {}, createGain: gain};
      const engine = new AudioEngine();
      engine.masterGain = gain();
      let finishStartup;
      engine.ensureAudioContext = () => new Promise(resolve => {finishStartup = resolve;});
      engine.schedulePianoPreload = () => {};
      let sourcesMade = 0;
      engine.createSourcesForVoice = async () => {
        sourcesMade++;
        return {oscillators: [], sourceNodes: []};
      };
      const waiting = engine.noteOn(0, 0, 440);
      engine.allNotesOff();
      finishStartup(ctx);
      await waiting;
      await new Promise(resolve => setTimeout(resolve, 25));
      return {sourcesMade, activeVoices: engine.getActiveVoices().length,
        pendingCount: engine.pendingVoiceCount};
    });
    console.log('AUDIO_STARTUP_CANCEL_EVIDENCE', JSON.stringify(evidence));
    assert.equal(evidence.sourcesMade, 0, 'An older keypress must not start after allNotesOff');
    assert.equal(evidence.activeVoices, 0);
    assert.equal(evidence.pendingCount, 0);
    assert.deepEqual(h.errors, []);
  } finally {
    await h.browser.close();
    h.server.kill('SIGTERM');
  }
});


test('#30 rendered keyboard prewarms real samples, two-row union and scroll reprioritization', {timeout: 90000}, async () => {
  const h = await launchHarness();
  try {
    await h.page.waitForFunction(async () => {
      const {globalAudioEngine: engine} = await import('/src/core/audio.ts');
      return (engine.visiblePianoSamples.get('lower')?.length ?? 0) > 0 &&
        engine.decodedSampleCache.size > 0;
    }, {timeout: 25000});
    const initial = await h.page.evaluate(async () => {
      const {globalAudioEngine: engine} = await import('/src/core/audio.ts');
      return {ids: engine.visiblePianoSamples.get('lower'), decoded: engine.decodedSampleCache.size,
        encoded: engine.encodedSampleCache.size,
        resumeStatus: engine.ctx?.state ?? null};
    });
    assert.ok(initial.ids.length > 0);
    assert.ok(initial.decoded > 0, 'at least one actual M4A buffer must decode before the first keypress');
    assert.ok(initial.encoded >= initial.decoded);
    console.log('VISIBLE_PREWARM_FIRST_VIEW', JSON.stringify(initial));

    await h.page.evaluate(() => {
      const viewport = document.querySelector('[data-keyboard-viewport="lower"]');
      assertViewport(viewport);
      viewport.scrollLeft = Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + 800);
      viewport.dispatchEvent(new Event('scroll', {bubbles: true}));
      function assertViewport(node) { if (!node) throw Error('lower viewport missing'); }
    });
    await h.page.waitForFunction(async (initialIds) => {
      const {globalAudioEngine: engine} = await import('/src/core/audio.ts');
      return JSON.stringify(engine.visiblePianoSamples.get('lower')) !== JSON.stringify(initialIds);
    }, {timeout: 10000}, initial.ids);

    await h.page.click('button[aria-label="メニューを開く"]');
    await h.page.evaluate(() => {
      const toggle = [...document.querySelectorAll('label')].find(label =>
        label.textContent.includes('上下2段で表示する'))?.querySelector('input');
      if (!toggle) throw Error('two-row toggle missing');
      toggle.click();
    });
    await h.page.waitForFunction(async () => {
      const {globalAudioEngine: engine} = await import('/src/core/audio.ts');
      return document.querySelectorAll('[data-keyboard-viewport]').length === 2 &&
        (engine.visiblePianoSamples.get('upper')?.length ?? 0) > 0 &&
        (engine.visiblePianoSamples.get('lower')?.length ?? 0) > 0;
    }, {timeout: 10000});
    const twoRow = await h.page.evaluate(async () => {
      const {globalAudioEngine: engine} = await import('/src/core/audio.ts');
      const upper = engine.visiblePianoSamples.get('upper');
      const lower = engine.visiblePianoSamples.get('lower');
      const bytes = [...engine.decodedSampleCache.values()].reduce(
        (sum, buffer) => sum + buffer.length * buffer.numberOfChannels * 4, 0);
      return {upper: upper.length, lower: lower.length,
        unique: new Set([...upper, ...lower]).size, decodedBytes: bytes};
    });
    console.log('VISIBLE_PREWARM_TWO_ROWS', JSON.stringify(twoRow));
    assert.ok(twoRow.upper > 0 && twoRow.lower > 0);
    assert.ok(twoRow.unique <= twoRow.upper + twoRow.lower, 'shared samples are deduplicated');
    assert.ok(twoRow.decodedBytes <= 32 * 1024 * 1024, 'decoded PCM exceeds hard memory budget');
    assert.deepEqual(h.errors, []);
  } finally {
    await h.browser.close();
    h.server.kill('SIGTERM');
  }
});
