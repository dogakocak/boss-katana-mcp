import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCdpBts } from './bts.js';
import { launch } from './launcher.js';
import { registerKatanaTools } from './tools.js';
import { Gen1MidiAdapter, type MidiBackend } from './gen1/adapter.js';
import { createNativeMidiBackend } from './gen1/native-midi.js';
import { registerGen1Tools } from './gen1/tools.js';

export function registerBackend(server: McpServer, env: NodeJS.ProcessEnv = process.env,
  midi: MidiBackend = createNativeMidiBackend()): void {
  const backend = env.KATANA_BACKEND ?? 'gen3';
  if (backend === 'gen3') {
    registerKatanaTools(server, { bts: createCdpBts(), launch: () => launch() });
  } else if (backend === 'gen1') {
    registerGen1Tools(server, new Gen1MidiAdapter(midi, {
      hardwareEnabled: env.KATANA_GEN1_ENABLE_HARDWARE === '1',
      modelConfirmed: env.KATANA_GEN1_MODEL_CONFIRMED === '1',
      allowWrites: env.KATANA_GEN1_ALLOW_WRITES === '1',
      lowMasterConfirmed: env.KATANA_GEN1_LOW_MASTER_CONFIRMED === '1',
    }));
  } else throw new Error(`Unknown KATANA_BACKEND: ${backend}. Use gen3 (default) or gen1.`);
}
