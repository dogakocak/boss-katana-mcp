#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerBackend } from './backend.js';

const server = new McpServer({ name: 'boss-katana-mcp', version: '0.1.0' });
registerBackend(server);
await server.connect(new StdioServerTransport());
