// npm run doctor — checks everything Framesflow needs and says how to fix what is missing.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const need = (name, cmd, args, fix, optional = false) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' && !cmd.includes('.exe') });
  const ok = r.status === 0 || (r.stdout || r.stderr || '').length > 0 && !r.error;
  const line = ((r.stdout || r.stderr || '').split('\n')[0] || '').trim().slice(0, 80);
  console.log(`${ok ? '✔' : optional ? '○' : '✘'} ${name.padEnd(10)} ${ok ? line : `not found — ${fix}`}`);
  return ok || optional;
};

const major = Number(process.versions.node.split('.')[0]);
console.log(`${major >= 20 ? '✔' : '✘'} node       v${process.versions.node}${major >= 20 ? '' : ' — Node 20 or newer is required'}`);
let good = major >= 20;
good = need('ffmpeg', 'ffmpeg', ['-version'], 'install from https://ffmpeg.org/download.html and add it to PATH') && good;
good = need('ffprobe', 'ffprobe', ['-version'], 'ships with ffmpeg') && good;
good = need('yt-dlp', 'yt-dlp', ['--version'], 'https://github.com/yt-dlp/yt-dlp#installation  (pip install -U yt-dlp)') && good;
need('whisper', 'whisper', ['--help'], 'pip install openai-whisper  — optional, gives millisecond word timing (otherwise timings are estimated)', true);
try { const { findBrowser } = await import('../server/htmlanim.mjs'); console.log(`✔ browser    ${findBrowser()} (HTML animations)`); } catch (e) { console.log(`○ browser    ${e.message} (optional, needed only for HTML animations)`); }
try { createRequire(import.meta.url).resolve('@napi-rs/canvas'); console.log('✔ canvas     graphics renderer ready'); } catch { console.log('✘ canvas     run npm install'); good = false; }
console.log(good ? '\nAll set. Run: npx framesflow-studio start  (or npm start in a source checkout)' : '\nFix the ✘ items above, then run: npx framesflow-studio start');
process.exit(good ? 0 : 1);
