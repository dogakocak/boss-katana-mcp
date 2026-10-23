#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createCdpBts } from './bts.js';
import { launch } from './launcher.js';
import { createCdpLibrary } from './library.js';
import { registerLibraryTools } from './library-tools.js';
import { registerKatanaTools } from './tools.js';

const server = new McpServer({ name: 'boss-katana-mcp', version: '0.1.0' });
registerKatanaTools(server, { bts: createCdpBts(), launch: () => launch() });
registerLibraryTools(server, { lib: createCdpLibrary() });
await server.connect(new StdioServerTransport());
