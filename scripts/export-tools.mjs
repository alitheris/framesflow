// Writes cloud/worker/src/tools.json: every MCP tool (name, description, JSON schema) + which ones the browser can run alone.
// The hosted MCP Worker serves this list; run `npm run manifest` in cloud/worker (or this script) before deploying.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { tools } from '../server/tools.mjs';
import { LOCAL_TOOL_NAMES } from '../web/src/local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'cloud', 'worker', 'src', 'tools.json');
const manifest = {
  tools: tools.map(t => {
    const schema = zodToJsonSchema(z.object(t.shape || {}), { target: 'jsonSchema7', $refStrategy: 'none' });
    delete schema.$schema;
    return { name: t.name, description: t.description, inputSchema: schema };
  }),
  browserTools: LOCAL_TOOL_NAMES,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(manifest));
console.log(`Wrote ${manifest.tools.length} tools (${manifest.browserTools.length} run in the browser) → ${path.relative(root, out)}`);
process.exit(0);
