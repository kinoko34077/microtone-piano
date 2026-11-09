import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';

// #30 diagnostic only. No application audio code or user data is modified.
// Event -> AudioBufferSourceNode.start is NOT physical speaker onset.
const HOST = 'http://127.0.0.1:8795';
const REPETITIONS = 5;
const SCENARIOS = [
  {name: '4_distinct', frequencies: [261.625565, 329.627557, 391.995436, 440], minUnique: 4},
  {name: '5_distinct', frequencies: [261.625565, 329.627557, 391.995436, 440, 523.251131], minUnique: 5},
  {name: '5_shared', frequencies: [440, 441, 442, 443, 444], minUnique: 1},
];

async function waitForPreview() {
  const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1',
    '--port', '8795', '--strictPort'], {stdio: 'ignore'});
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Vite exited: ' + server.exitCode);
    try {
      if ((await fetch(HOST + '/')).ok) return server;
    } catch { /* waiting for Vite */ }
    await new Promise(resolve => setTimeout(resolve, 130));
  }
  server.kill('SIGTERM');
  throw new Error('Vite startup timeout');
}

const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * fraction) - 1] * 100) / 100;
};

test('#30 real M4A cold/warm chord schedule timing (5 isolated repeats per group)', {timeout: 240000}, async () => {
  const server = await waitForPreview();
  let browser;
  const records = [];
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
      headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage',
        '--autoplay-policy=no-user-gesture-required'],
    });
    for (const scenario of SCENARIOS) {
      for (let repeat = 0; repeat < REPETITIONS; repeat++) {
        // New isolated browser context: no prior HTTP cache / decoded AudioBuffer.
        const context = await browser.createBrowserContext();
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(18000);
          const pageErrors = [];
          page.on('pageerror', error => pageErrors.push(error.message));
          await page.goto(HOST + '/?chord-measure=' + repeat, {waitUntil: 'domcontentloaded'});
          const result = await page.evaluate(async (frequencies) => {
            const {AudioEngine} = await import('/src/core/audio.ts');
            const {findNearestPianoSample} = await import('/src/core/pianoSamples.ts');

            const sampleIds = frequencies.map(freq => {
              const sample = findNearestPianoSample(freq);
              return sample ? {id: sample.id, freq: sample.referenceFrequency, url: sample.url} : null;
            });
            const engine = new AudioEngine();
            // Isolate chord-start performance from the two-second idle preloader.
            engine.schedulePianoPreload = () => {};
            const ctx = await engine.ensureAudioContext();
            const originalDecode = ctx.decodeAudioData.bind(ctx);
            const originalBufferSource = ctx.createBufferSource.bind(ctx);
            const originalFetch = window.fetch.bind(window);
            const observed = {fetch: [], body: [], decode: [], start: [],
              peakFetches: 0, peakBodies: 0, peakDecodes: 0};
            let activeFetches = 0;
            let activeBodies = 0;
            let activeDecodes = 0;

            window.fetch = async (...args) => {
              const url = String(args[0]);
              const isSample = url.includes('.m4a');
              const at = performance.now();
              if (isSample) {
                activeFetches++;
                observed.peakFetches = Math.max(observed.peakFetches, activeFetches);
              }
              try {
                const response = await originalFetch(...args);
                if (isSample) {
                  observed.fetch.push({url, ms: performance.now() - at, status: response.status});
                  const originalArrayBuffer = response.arrayBuffer.bind(response);
                  response.arrayBuffer = async (...bodyArgs) => {
                    const bodyAt = performance.now();
                    activeBodies++;
                    observed.peakBodies = Math.max(observed.peakBodies, activeBodies);
                    try {
                      const data = await originalArrayBuffer(...bodyArgs);
                      observed.body.push({url, ms: performance.now() - bodyAt, bytes: data.byteLength});
                      return data;
                    } finally {
                      activeBodies--;
                    }
                  };
                }
                return response;
              } catch (error) {
                if (isSample) {
                  observed.fetch.push({url, ms: performance.now() - at, error: String(error)});
                }
                throw error;
              } finally {
                if (isSample) activeFetches--;
              }
            };
            ctx.decodeAudioData = async (...args) => {
              const at = performance.now();
              activeDecodes++;
              observed.peakDecodes = Math.max(observed.peakDecodes, activeDecodes);
              try {
                const buffer = await originalDecode(...args);
                observed.decode.push({ms: performance.now() - at,
                  encodedBytes: args[0].byteLength, decodedFrames: buffer.length,
                  channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate});
                return buffer;
              } catch (error) {
                observed.decode.push({ms: performance.now() - at, error: String(error)});
                throw error;
              } finally {
                activeDecodes--;
              }
            };
            ctx.createBufferSource = (...args) => {
              const node = originalBufferSource(...args);
              const originalStart = node.start.bind(node);
              node.start = (...startArgs) => {
                observed.start.push({time: performance.now(),
                  when: startArgs[0], ctxCurrentTime: ctx.currentTime});
                return originalStart(...startArgs);
              };
              return node;
            };

            const phases = [];
            for (const phaseName of ['cold', 'warm']) {
              const startIndex = observed.start.length;
              const fetchIndex = observed.fetch.length;
              const bodyIndex = observed.body.length;
              const decodeIndex = observed.decode.length;
              const eventTime = performance.now();
              const handles = await Promise.all(frequencies.map((freq, index) =>
                engine.noteOn(index, index, freq, 0.8, phaseName + '-' + index)));
              const deadline = performance.now() + 14000;
              while (observed.start.length < startIndex + frequencies.length &&
                performance.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 20));
              }
              // AudioBufferSourceNode.start() fires before the async voice
              // registration/finally microtasks finish. Do not misreport
              // transient pending entries as leaked voices.
              while (engine.pendingVoiceCount > 0 && performance.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 10));
              }
              const starts = observed.start.slice(startIndex);
              const started = starts.slice(0, frequencies.length);
              const requestSamples = observed.fetch.slice(fetchIndex);
              const bodySamples = observed.body.slice(bodyIndex);
              const decodeSamples = observed.decode.slice(decodeIndex);
              const cachedBuffers = [...engine.decodedSampleCache.values()];
              phases.push({
                phaseName,
                requested: frequencies.length,
                handles: handles.length,
                started: started.length,
                startDelaysMs: started.map(x => Math.round((x.time - eventTime) * 100) / 100),
                firstScheduledMs: starts.length ? starts[0].time - eventTime : null,
                lastScheduledMs: started.length ? started[started.length - 1].time - eventTime : null,
                networkFetches: requestSamples.length,
                fetchSamples: requestSamples,
                bodySamples,
                decodes: decodeSamples.length,
                decodeSamples,
                peakConcurrentFetches: observed.peakFetches,
                peakConcurrentBodies: observed.peakBodies,
                peakConcurrentDecodes: observed.peakDecodes,
                decodedPcmBytesEstimate: cachedBuffers.reduce(
                  (sum, buffer) => sum + buffer.length * buffer.numberOfChannels * 4, 0),
                activeAfterStart: engine.getActiveVoices().length,
                pendingAfterStart: engine.pendingVoiceCount,
              });
              engine.allNotesOff();
              await new Promise(resolve => setTimeout(resolve, 100));
            }

            window.fetch = originalFetch;
            await ctx.close();
            return {sampleIds, phases, engineState: 'real AudioBufferSourceNode', userAudioDeviceMeasured: false};
          }, scenario.frequencies);
          assert.deepEqual(pageErrors, [], 'unexpected app/browser runtime exceptions');
          const unique = new Set(result.sampleIds.map(s => s?.id));
          assert.ok(!unique.has(null), 'all test pitches must map to actual M4A files');
          assert.ok(unique.size >= scenario.minUnique, 'scenario sample diversity requirement');
          if (scenario.name.endsWith('_shared')) {
            assert.equal(unique.size, 1, 'shared sample chord must hit one physical sample file');
          }
          for (const phase of result.phases) {
            assert.equal(phase.started, phase.requested, JSON.stringify({
              scenario: scenario.name, repeat, phase,
            }));
            assert.ok(phase.activeAfterStart <= 32);
            assert.equal(phase.pendingAfterStart, 0);
          }
          assert.ok(result.phases[0].decodes >= 1, 'cold chord must perform real decodeAudioData');
          assert.equal(result.phases[1].decodes, 0, 'warm chord should reuse decoded AudioBuffers');
          assert.equal(result.phases[1].networkFetches, 0, 'warm chord should not fetch M4A again');
          records.push({name: scenario.name, repeat, sampleIds: result.sampleIds.map(s => s.id),
            cold: result.phases[0], warm: result.phases[1]});
        } finally {
          await context.close();
        }
      }
    }

    for (const scenario of SCENARIOS) {
      const entries = records.filter(row => row.name === scenario.name);
      const summary = {mainEquivalentCode: true, scenario: scenario.name, repeats: entries.length,
        noteCount: scenario.frequencies.length, sampleIds: entries[0].sampleIds,
        cold: {}, warm: {}};
      for (const phaseName of ['cold', 'warm']) {
        const rows = entries.map(row => row[phaseName]);
        const lastStartDelays = rows.map(row => row.lastScheduledMs);
        summary[phaseName] = {
          p50LastStartMs: percentile(lastStartDelays, 0.50),
          p95LastStartMs: percentile(lastStartDelays, 0.95),
          p50FirstStartMs: percentile(rows.map(row => row.firstScheduledMs), 0.50),
          p95SpreadMs: percentile(rows.map(row => row.lastScheduledMs - row.firstScheduledMs), 0.95),
          droppedNotes: rows.reduce((sum, row) => sum + (row.requested - row.started), 0),
          fetches: rows.map(row => row.networkFetches),
          decodes: rows.map(row => row.decodes),
          p50SlowestHeaderMs: percentile(rows.map(row => Math.max(0, ...row.fetchSamples.map(x => x.ms))), 0.50),
          p95SlowestHeaderMs: percentile(rows.map(row => Math.max(0, ...row.fetchSamples.map(x => x.ms))), 0.95),
          p50SlowestBodyMs: percentile(rows.map(row => Math.max(0, ...row.bodySamples.map(x => x.ms))), 0.50),
          p95SlowestBodyMs: percentile(rows.map(row => Math.max(0, ...row.bodySamples.map(x => x.ms))), 0.95),
          p50SlowestDecodeMs: percentile(rows.map(row => Math.max(0, ...row.decodeSamples.map(x => x.ms))), 0.50),
          p95SlowestDecodeMs: percentile(rows.map(row => Math.max(0, ...row.decodeSamples.map(x => x.ms))), 0.95),
          peakFetchConcurrency: Math.max(...rows.map(row => row.peakConcurrentFetches)),
          peakBodyConcurrency: Math.max(...rows.map(row => row.peakConcurrentBodies)),
          peakDecodeConcurrency: Math.max(...rows.map(row => row.peakConcurrentDecodes)),
          decodedPcmBytes: rows.map(row => row.decodedPcmBytesEstimate),
          fetchStatus: [...new Set(rows.flatMap(row => row.fetchSamples.map(f => f.status ?? f.error)))],
        };
      }
      console.log('REAL_SAMPLE_CHORD_METRICS', JSON.stringify(summary));
    }
    assert.equal(records.length, SCENARIOS.length * REPETITIONS);
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
});
