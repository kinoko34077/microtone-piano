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
