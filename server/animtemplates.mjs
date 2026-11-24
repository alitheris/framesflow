// Ready-made animation scenes (pure CSS / tiny deterministic JS). Each is a fragment that fillVars() customises.
// Units are vmin/vw so they work for 16:9 and 9:16 canvases. --ff-dur is the clip length (set by the renderer).
export const ANIMATION_TEMPLATES = [
  {
    id: 'title-card', label: 'Title card', description: 'Big title that rises in, an accent bar that draws, a subtitle, then a soft exit.',
    vars: [{ key: 'title', label: 'Title', def: 'The Deep Ocean' }, { key: 'subtitle', label: 'Subtitle', def: 'Earth’s last frontier' }, { key: 'accent', label: 'Accent colour', def: '#d8f36a' }],
    html: `<div class="wrap"><h1>{{title}}</h1><div class="bar"></div><p>{{subtitle}}</p></div>
<style>
.wrap{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:2.4vmin;padding:0 8vw;text-align:center;font-family:'Segoe UI','Montserrat',Arial,sans-serif;color:#fff;animation:out .5s ease-in calc(var(--ff-dur) - .5s) both}
h1{margin:0;font-size:10vmin;line-height:1.05;font-weight:800;letter-spacing:-.02em;text-shadow:0 .6vmin 3vmin #000a;animation:rise .8s cubic-bezier(.2,.9,.2,1) both}
.bar{height:1vmin;width:0;background:{{accent}};border-radius:1vmin;animation:grow .8s .25s cubic-bezier(.2,.9,.2,1) forwards}
p{margin:0;font-size:3.8vmin;opacity:0;color:#eef2e4;text-shadow:0 .3vmin 2vmin #000a;animation:fade .7s .5s ease-out forwards}
@keyframes rise{from{opacity:0;transform:translateY(6vmin) scale(.96)}to{opacity:1;transform:none}}
@keyframes grow{to{width:32vmin}}
@keyframes fade{to{opacity:1}}
@keyframes out{to{opacity:0;transform:translateY(-3vmin)}}
</style>`,
  },
  {
    id: 'lower-third', label: 'Lower third', description: 'Name + role bar that slides in from the left and slides out at the end.',
    vars: [{ key: 'name', label: 'Name', def: 'Jane Cousteau' }, { key: 'role', label: 'Role', def: 'Marine biologist' }, { key: 'accent', label: 'Accent colour', def: '#d8f36a' }],
    html: `<div class="lt"><i></i><div><b>{{name}}</b><span>{{role}}</span></div></div>
<style>
.lt{position:absolute;left:6vw;bottom:12vh;display:flex;align-items:stretch;gap:1.6vmin;font-family:'Segoe UI','Montserrat',Arial,sans-serif;animation:in .6s cubic-bezier(.2,.9,.2,1) both,out .5s ease-in calc(var(--ff-dur) - .5s) both}
.lt i{width:1.2vmin;background:{{accent}};border-radius:1vmin}
.lt div{display:grid;gap:.6vmin;padding:1.8vmin 3vmin 1.8vmin 2.2vmin;background:#10150be6;border-radius:1.4vmin;color:#fff}
b{font-size:4.6vmin;font-weight:800;letter-spacing:-.01em}
span{font-size:3vmin;opacity:.82}
@keyframes in{from{opacity:0;transform:translateX(-12vw)}to{opacity:1;transform:none}}
@keyframes out{to{opacity:0;transform:translateX(-12vw)}}
</style>`,
  },
  {
    id: 'big-number', label: 'Big number', description: 'A number that counts up with an ease-out, with a label underneath.',
    vars: [{ key: 'value', label: 'Number (digits only)', def: '36000' }, { key: 'prefix', label: 'Prefix', def: '' }, { key: 'suffix', label: 'Suffix', def: ' ft' }, { key: 'label', label: 'Label', def: 'deepest point in the ocean' }, { key: 'accent', label: 'Accent colour', def: '#d8f36a' }],
    html: `<div class="n"><span id="v">0</span></div><div class="l">{{label}}</div>
<style>
.n,.l{position:absolute;left:0;right:0;text-align:center;font-family:'Segoe UI','Montserrat',Arial,sans-serif;animation:out .5s ease-in calc(var(--ff-dur) - .5s) both}
.n{top:36%;font-size:17vmin;font-weight:900;color:{{accent}};letter-spacing:-.03em;text-shadow:0 .8vmin 4vmin #000a;animation:pop .6s cubic-bezier(.2,1.4,.3,1) both,out .5s ease-in calc(var(--ff-dur) - .5s) both}
.l{top:58%;font-size:4.4vmin;color:#fff;opacity:0;text-shadow:0 .4vmin 2vmin #000a;animation:fade .6s .5s ease-out forwards,out .5s ease-in calc(var(--ff-dur) - .5s) both}
@keyframes pop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:none}}
@keyframes fade{to{opacity:1}}
@keyframes out{to{opacity:0}}
</style>
<script>
const TARGET = Number({{json:value}}) || 0, PRE = {{json:prefix}}, SUF = {{json:suffix}};
const el = document.getElementById('v');
window.__ffSeek = t => { const k = Math.min(1, Math.max(0, t / 1.8)); const e = 1 - Math.pow(1 - k, 3); el.textContent = PRE + Math.round(TARGET * e).toLocaleString('en-US') + SUF; };
window.__ffSeek(0);
</script>`,
  },
  {
    id: 'bar-chart', label: 'Bar chart', description: 'Animated bars that grow one after another. Items as "Label:value, Label:value".',
    vars: [{ key: 'title', label: 'Title', def: 'Ocean depth (m)' }, { key: 'items', label: 'Items', def: 'Sunlight zone:200, Twilight:1000, Midnight:4000, Abyss:6000, Trench:11000' }, { key: 'accent', label: 'Accent colour', def: '#d8f36a' }],
    html: `<div class="card"><h2>{{title}}</h2><div id="rows"></div></div>
<style>
.card{position:absolute;left:50%;top:50%;width:76vw;max-width:150vmin;transform:translate(-50%,-50%);padding:4vmin 5vmin;background:#10150bea;border-radius:2vmin;font-family:'Segoe UI','Montserrat',Arial,sans-serif;color:#fff;animation:in .5s ease-out both,out .5s ease-in calc(var(--ff-dur) - .5s) both}
h2{margin:0 0 3vmin;font-size:4.6vmin;font-weight:800}
.row{display:grid;grid-template-columns:22vmin 1fr 12vmin;align-items:center;gap:2vmin;margin:1.6vmin 0;font-size:3vmin}
.track{height:3.4vmin;background:#ffffff1c;border-radius:2vmin;overflow:hidden}
.fill{height:100%;width:0;border-radius:2vmin;background:{{accent}};animation:grow 1s cubic-bezier(.2,.9,.2,1) forwards;animation-delay:calc(.35s + var(--i)*.18s)}
.val{text-align:right;font-weight:700;opacity:0;animation:fade .4s ease-out forwards;animation-delay:calc(.9s + var(--i)*.18s)}
@keyframes grow{to{width:var(--p)}}
@keyframes fade{to{opacity:1}}
@keyframes in{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}
@keyframes out{to{opacity:0}}
</style>
<script>
const items = {{json:items}}.split(',').map(s => s.split(':')).map(([l, v]) => [String(l).trim(), Number(v)]).filter(([l, v]) => l && isFinite(v)).slice(0, 8);
const max = Math.max(1, ...items.map(i => i[1]));
const rows = document.getElementById('rows');
items.forEach(([l, v], i) => {
  const r = document.createElement('div'); r.className = 'row'; r.style.setProperty('--i', i); r.style.setProperty('--p', (v / max * 100).toFixed(1) + '%');
  const a = document.createElement('span'); a.textContent = l;
  const t = document.createElement('div'); t.className = 'track'; const f = document.createElement('div'); f.className = 'fill'; t.appendChild(f);
  const n = document.createElement('span'); n.className = 'val'; n.textContent = v.toLocaleString('en-US');
  r.append(a, t, n); rows.appendChild(r);
});
</script>`,
  },
];

export const templateById = id => ANIMATION_TEMPLATES.find(t => t.id === id);
export const templateDefaults = t => Object.fromEntries(t.vars.map(v => [v.key, v.def]));
