export interface CdpTarget { type: string; url: string; webSocketDebuggerUrl?: string }

export class BtsUnavailableError extends Error {}

const NOT_RUNNING =
  'BOSS TONE STUDIO is not reachable on the debug port. Open it with katana_launch, ' +
  'or run scripts/Enable-BossKatanaMcp.ps1 once and reopen BOSS TONE STUDIO.';

export function pickTarget(list: CdpTarget[]): CdpTarget | undefined {
  return list.find(t => t.type === 'page' && t.url.startsWith('file:///') && t.url.endsWith('/html/index.html'));
}

/** True when `url` is a DevTools websocket endpoint on this machine's own debug port. */
export function isLocalDebuggerUrl(url: string, port: number): boolean {
  return url.startsWith(`ws://127.0.0.1:${port}/`);
}

async function listTargets(port: number): Promise<CdpTarget[]> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    return (await res.json()) as CdpTarget[];
  } catch {
    throw new BtsUnavailableError(NOT_RUNNING);
  }
}

export async function btsReachable(port = 9222): Promise<boolean> {
  try { return pickTarget(await listTargets(port)) !== undefined; } catch { return false; }
}

/** Opens a one-shot CDP session to the BTS page, evaluates, closes. */
export async function evaluateInBts<T>(expression: string, port = 9222, timeoutMs = 10000): Promise<T> {
  const target = pickTarget(await listTargets(port));
  if (!target?.webSocketDebuggerUrl) throw new BtsUnavailableError(NOT_RUNNING);
  if (!isLocalDebuggerUrl(target.webSocketDebuggerUrl, port)) {
    throw new BtsUnavailableError(`Unexpected DevTools endpoint: ${target.webSocketDebuggerUrl}`);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new BtsUnavailableError(NOT_RUNNING));
      }, 5000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new BtsUnavailableError(NOT_RUNNING)); }, { once: true });
    });
    return await new Promise<T>((resolve, reject) => {
      const settle = (fn: () => void) => {
        clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        ws.removeEventListener('close', onClose);
        ws.removeEventListener('error', onClose);
        fn();
      };
      const timer = setTimeout(() => settle(() => reject(new Error('CDP evaluate timed out'))), timeoutMs);
      const onClose = () => settle(() => reject(new BtsUnavailableError('BOSS TONE STUDIO closed the DevTools connection before replying.')));
      const onMessage = (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.id !== 1) return;
        settle(() => {
          if (msg.error) return reject(new Error(`CDP error: ${msg.error.message}`));
          const r = msg.result;
          if (r.exceptionDetails) {
            return reject(new Error(`BTS page error: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`));
          }
          resolve(r.result.value as T);
        });
      };
      ws.addEventListener('message', onMessage);
      ws.addEventListener('close', onClose, { once: true });
      ws.addEventListener('error', onClose, { once: true });
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  } finally {
    ws.close();
  }
}
