import { expect, it } from 'vitest';
import type { BtsClient } from '../src/bts.js';
import { connectAndWait, type WaitDeps } from '../src/connect.js';
import type { ConnectStart } from '../src/page-agent.js';

/** Fake BTS: connect() answers from `starts` in order (last one repeats); the amp shows up after `connectedAfter` status calls. */
function fakeBts(starts: ConnectStart[], connectedAfter = Infinity) {
  let statusCalls = 0;
  const connects: ConnectStart[] = [];
  const bts: BtsClient = {
    status: async () => ({ connected: statusCalls++ >= connectedAfter, patchName: statusCalls > connectedAfter ? 'DELI' : 'KATANA', colors: [0, 0, 0, 0, 0] }),
    connect: async () => { const r = starts[Math.min(connects.length, starts.length - 1)]; connects.push(r); return r; },
    index: async () => [], read: async () => ({}), write: async () => ({}),
    controls: async () => ({ gafc: true, readings: [] }),
  };
  return { bts, connects };
}

function clock(): WaitDeps {
  let t = 0;
  return { now: () => t, sleep: async ms => { t += ms; } };
}

it('returns at once when the amp is already connected', async () => {
  const { bts, connects } = fakeBts([{ started: false, already: true }], 0);
  expect(await connectAndWait(bts, 15000, clock())).toEqual({ ampConnected: true, patchName: 'DELI' });
  expect(connects).toEqual([]);
});

it('starts the connect and waits until BTS reports the amp', async () => {
  const { bts, connects } = fakeBts([{ started: true, device: 'KATANA3' }, { started: false, pending: true }], 4);
  expect(await connectAndWait(bts, 15000, clock())).toEqual({ ampConnected: true, patchName: 'DELI' });
  expect(connects.filter(c => c.started)).toHaveLength(1);
});

it('passes on the reason when it cannot connect', async () => {
  const reason = 'No KATANA MIDI device is listed. Is the amp on and connected over USB?';
  const { bts } = fakeBts([{ started: false, reason }]);
  expect(await connectAndWait(bts, 15000, clock())).toEqual({ ampConnected: false, patchName: 'KATANA', message: reason });
});

it('gives up after the timeout instead of hanging', async () => {
  const { bts } = fakeBts([{ started: true }, { started: false, pending: true }]);
  const r = await connectAndWait(bts, 3000, clock());
  expect(r.ampConnected).toBe(false);
  expect(r.message).toContain('did not connect within 3s');
});
