// End-to-end MCP check against a running studio:  node tests/mcp-smoke.mjs   (uses both the stdio bridge and the HTTP endpoint)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT || 4317;

async function exercise(label, transport) {
  const client = new Client({ name: 'smoke', version: '1.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const status = JSON.parse((await client.callTool({ name: 'get_status', arguments: {} })).content[0].text);
  const bad = await client.callTool({ name: 'place_clip', arguments: { beatId: 'nope' } });
  const prompts = await client.listPrompts();
  const prompt = await client.getPrompt({ name: 'make_faceless_video', arguments: { voiceover_path: 'C:/x.mp3' } });
  console.log(`[${label}] ${tools.length} tools · ffmpeg=${status.ffmpeg.ok} yt-dlp=${status.ytdlp.ok} whisper=${status.whisper.ok} · project "${status.project.name}" · prompts: ${prompts.prompts.map(p => p.name)} (${prompt.messages[0].content.text.length} chars) · bad call isError=${!!bad.isError}`);
  const look = await client.callTool({ name: 'inspect_youtube', arguments: { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', startMs: 2000, endMs: 12000, frames: 6 } });
  console.log(`[${label}] inspect_youtube content types:`, look.content.map(c => c.type + (c.type === 'image' ? ` (${Math.round(c.data.length * 0.75 / 1024)} KB ${c.mimeType})` : '')).join(', '));
  await client.close();
}

await exercise('http', new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
await exercise('stdio', new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp', 'stdio.mjs')], env: { ...process.env, PORT: String(port) } }));
process.exit(0);
