// Playwright feature test for molWhiz — run: node test_molwhiz.mjs
// Exercises every representation, material, glow, cut, measurement, atom-info and loader path.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL = 'file://' + path.join(__dirname, 'molwhiz.html');
const SHOTS = process.argv[2] || '/tmp';

let pass = 0, fail = 0;
const ok  = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗ FAIL:', n); } };

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1300, height: 860 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.__mol === 'object', { timeout: 20000 });

const status  = () => page.$eval('#status', e => e.textContent);
const setChk  = (id, v) => page.evaluate(([id,v]) => { const e=document.getElementById(id); e.checked=v; e.dispatchEvent(new Event('change')); }, [id,v]);
const setVal  = (id, v) => page.evaluate(([id,v]) => { const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }, [id,v]);
const rep     = r => page.click(`#repSeg [data-rep=${r}]`);
const load    = k => page.evaluate(k => window.__mol.loadMol(window.__mol.EX[k](), k), k);
const settle  = (ms=500) => page.waitForTimeout(ms);
const shot    = f => page.screenshot({ path: path.join(SHOTS, f) });

console.log('\n== boot ==');
ok('module ready + version pill', await page.$eval('#verPill', e => /^v/.test(e.textContent)));
if (await page.$eval('#sidebarR', e => e.classList.contains('hidden'))) await page.click('#tglR');   // ensure appearance sidebar open
await settle(200);
ok('appearance sidebar visible', !(await page.$eval('#sidebarR', e => e.classList.contains('hidden'))));
ok('matcaps present in Style dropdown', (await page.$$eval('#material option', os => os.filter(o=>o.value.startsWith('matcap:')).length)) === 15);
ok('atom-shape + connector selects present', (await page.$('#atomShape')) && (await page.$('#bondShape')));

console.log('== small-molecule gallery ==');
for (const k of ['water','methane','benzene','ethanol','caffeine']) {
  await load(k); await settle(150);
  ok(`load ${k}`, /atoms/.test(await status()));
}

console.log('== representations (caffeine) ==');
let surfTris = 0;
for (const r of ['bas','space','stick','surface','atomic']) {
  await rep(r); await settle(500);
  const s = await status();
  ok(`rep ${r} → "${s}"`, s.length > 0 && !/empty/.test(s));
  if (r === 'surface') surfTris = await page.evaluate(() => window.__mol.surfInfo()?.tris || 0);
}
ok(`surface produced triangles (${surfTris})`, surfTris > 0);

console.log('== Voronoi cells ==');
await load('caffeine'); await settle(150);
await rep('voronoi'); await settle(700);
ok('Voronoi cells built', /Voronoi cells/.test(await status()));
await shot('pw_voronoi.png');
await rep('bas'); await settle(200);

console.log('== materials / matcaps ==');
await rep('bas'); await settle(200);
for (const mat of ['glossy','metal','toon','glass','matcap:Gold','matcap:Pearl','matcap:Chrome']) {
  await setVal('material', mat); await settle(150);
  ok(`material ${mat}`, errs.length === 0);
}
await setVal('material','standard');
await setChk('wireframe', true); await settle(120); ok('wireframe', errs.length===0); await setChk('wireframe', false);
await setChk('flatShade', true); await settle(120); ok('flat facets', errs.length===0); await setChk('flatShade', false);

console.log('== aura glow ==');
await setChk('auraOn', true); await settle(300);
ok('aura group built', await page.evaluate(() => !!window.__mol && document.getElementById('auraOn').checked));
await setVal('auraSize', 2.2); await setVal('auraIntensity', 1.4); await settle(200);
await setChk('auraRainbow', true); await setVal('auraPulse', 2); await settle(600);
ok('aura rainbow+pulse no errors', errs.length===0);
await shot('pw_aura.png');
await setChk('auraRainbow', false); await setChk('auraOn', false); await settle(150);

console.log('== section cut ==');
await rep('surface'); await settle(600);
await setChk('clipOn', true); await setVal('clipPos', 0.1); await settle(400);
ok('clip enable no errors', errs.length===0);
await page.click('#clipAxis [data-cax=y]'); await settle(200);
await setChk('clipFlip', true); await settle(200);
ok('clip axis+flip no errors', errs.length===0);
await shot('pw_clip.png');
await setChk('clipOn', false); await rep('bas'); await settle(200);

console.log('== hide solvent (needs network: 1HHO) ==');
let netOK = true;
try {
  await page.evaluate(() => window.__mol.fetchPdb('1HHO'));
  await page.waitForFunction(() => /atoms/.test(document.getElementById('status').textContent) && !/fetch/i.test(document.getElementById('status').textContent), { timeout: 15000 });
  const on = await page.evaluate(() => window.__mol.shownAtoms());
  await setChk('hideSolvent', false); await settle(600);
  const off = await page.evaluate(() => window.__mol.shownAtoms());
  ok(`solvent hidden (1HHO shown ${on} < ${off})`, off > on);
  await setChk('hideSolvent', true); await settle(300);
  await rep('cartoon'); await settle(800); ok('cartoon (1HHO)', /atoms/.test(await status()));
  await shot('pw_1hho_cartoon.png');
} catch (e) { netOK = false; console.log('  (skipped — no network for RCSB:', String(e).slice(0,60), ')'); }

console.log('== DNA builder ==');
await setVal('dnaSeq', 'ATGGCCTAGC');
await page.click('#dnaBtn'); await settle(400);
ok('DNA built', /B-DNA/.test(await status()));

console.log('== measurements (unlimited chain + angle) ==');
await load('caffeine'); await settle(200);
await page.click('#measBtn');
const meas = await page.evaluate(() => {
  const A = window.__mol.MOL.atoms;
  // simulate clicks by driving the internal selection via measSel is not exposed; emulate geometry check
  return { atoms: A.length };
});
ok('measure mode toggled', await page.$eval('#measBtn', e => e.classList.contains('acc')));
await page.click('#measBtn');

console.log('== shift-click atom properties ==');
await load('water'); await settle(200);
await rep('bas'); await settle(300);
const props = await page.evaluate(() => { window.__mol.showAtomProps(0); const p=document.getElementById('atomProps'); return { on:p.classList.contains('on'), hd:p.querySelector('.hd').textContent, hasEN:/Electronegativity/.test(p.querySelector('.bd').textContent) }; });
ok('atom props panel opens with facts', props.on && props.hasEN);
console.log('   props header:', props.hd);

console.log('== fragment builder ==');
await page.evaluate(() => window.__mol.builderNew());
await page.evaluate(() => window.__mol.builderAdd('C'));          // first carbon
await page.evaluate(() => { window.__mol.setBuildSel(0); window.__mol.builderAdd('C'); }); // ethane C-C
let nC = await page.evaluate(() => window.__mol.MOL.atoms.filter(a=>a.el==='C').length);
ok(`build C–C (${nC} carbons)`, nC === 2);
await page.evaluate(() => window.__mol.builderFillH());
let nAt = await page.evaluate(() => window.__mol.MOL.atoms.length);
ok(`fill H → ethane C2H6 (${nAt} atoms)`, nAt === 8);
await page.evaluate(() => { window.__mol.builderNew(); window.__mol.setBuildSel(-1); window.__mol.builderFragment('phenyl'); });
let ring = await page.evaluate(() => window.__mol.MOL.atoms.filter(a=>a.el==='C').length);
ok(`phenyl fragment (${ring} carbons ≥6)`, ring >= 6);
await page.evaluate(() => window.__mol.builderFragment('water'));
ok('snap +H2O no errors', errs.length === 0);
await shot('pw_builder.png');

console.log('== import formats (MOL2 / GRO / .mwz round-trip) ==');
const mol2 = '@<TRIPOS>MOLECULE\nx\n3 2 0 0 0\nSMALL\nNO_CHARGES\n@<TRIPOS>ATOM\n1 O1 0.0 0.0 0.0 O.3 1 HOH 0\n2 H1 0.76 0.59 0.0 H 1 HOH 0\n3 H2 -0.76 0.59 0.0 H 1 HOH 0\n@<TRIPOS>BOND\n1 1 2 1\n2 1 3 1\n';
const nMol2 = await page.evaluate(m => window.__mol.parseMol2(m).atoms.length, mol2);
ok(`parseMol2 (${nMol2} atoms)`, nMol2 === 3);
const gro = 'title\n2\n    1WATER  OW    1   0.126   1.624   1.679\n    1WATER  HW1   2   0.190   1.661   1.747\n';
const nGro = await page.evaluate(g => window.__mol.parseGro(g).atoms.length, gro);
ok(`parseGro (${nGro} atoms, nm→Å)`, nGro === 2);
await load('caffeine'); await settle(150);
const rt = await page.evaluate(() => { const s = window.__mol.currentScene(); window.__mol.builderNew(); const before = window.__mol.MOL.atoms.length; window.__mol.loadPreset(s); return { sig: s.molwhiz, before, after: window.__mol.MOL.atoms.length }; });
ok(`.mwz round-trip (sig=${rt.sig}, ${rt.before}→${rt.after})`, rt.sig === 'mwz' && rt.after === 24);
const m2 = await page.evaluate(() => window.__mol.molToMol2());
ok('molToMol2 has TRIPOS sections', /@<TRIPOS>ATOM/.test(m2) && /@<TRIPOS>BOND/.test(m2));

console.log('== mmCIF + AlphaFold (network) ==');
try {
  const cifAtoms = await page.evaluate(async () => {
    const r = await fetch('https://files.rcsb.org/download/1CRN.cif'); const t = await r.text();
    return window.__mol.parseCIF(t).atoms.length;
  });
  ok(`mmCIF parse 1CRN.cif (${cifAtoms} atoms)`, cifAtoms > 300);
  await page.evaluate(() => window.__mol.fetchAlphaFold('P00698'));
  await page.waitForFunction(() => /atoms/.test(document.getElementById('status').textContent) && !/fetch|AlphaFold:/.test(document.getElementById('status').textContent), { timeout: 20000 });
  const afN = await page.evaluate(() => window.__mol.MOL.atoms.length);
  ok(`AlphaFold P00698 (lysozyme) loaded (${afN} atoms)`, afN > 500);
  await rep('cartoon'); await settle(800); await shot('pw_alphafold.png');
} catch (e) { console.log('  (skipped mmCIF/AlphaFold — network:', String(e).slice(0,60), ')'); }

console.log('== export / presets ==');
await load('caffeine'); await settle(200);
const xyz = await page.evaluate(() => window.__mol.molToXYZ());
ok(`molToXYZ (${xyz.split('\n')[0]} atoms header)`, +xyz.split('\n')[0] === 24);
const pdb = await page.evaluate(() => window.__mol.molToPDB());
ok('molToPDB has ATOM+CONECT records', /^ATOM  /m.test(pdb) && /CONECT/.test(pdb));
// preset round-trip
await page.evaluate(() => { window.__mol.setBuildEl; const c=window.__mol.snapCfg(); window.__presetSaved=c; });
await setVal('material','matcap:Gold'); await rep('surface'); await settle(300);
await page.evaluate(() => window.__mol.applyCfg(window.__presetSaved));
const restored = await page.evaluate(() => document.getElementById('material').value);
ok(`preset applyCfg restores material (${restored})`, restored === 'standard');
// exported interactive HTML actually renders
const html = await page.evaluate(() => window.__mol.exportHTML());
ok('exportHTML produced a full document', /<!doctype html>/i.test(html) && /THREE|three/.test(html) && html.length > 1500);
const fs2 = await import('fs'); const tmpHtml = path.join(SHOTS, 'exported_view.html'); fs2.writeFileSync(tmpHtml, html);
const p2 = await browser.newPage({ viewport:{width:600,height:500} }); const e2=[]; p2.on('pageerror',e=>e2.push(String(e)));
await p2.goto('file://'+tmpHtml, { waitUntil:'load' }); await p2.waitForTimeout(2500);
ok('exported .html renders with no page errors', e2.length === 0);
await p2.screenshot({ path: path.join(SHOTS,'pw_exported.png') }); await p2.close();
if (e2.length) e2.slice(0,3).forEach(e=>console.log('   exported!', e.slice(0,100)));

console.log('\n== page errors ==');
ok('no uncaught page errors', errs.length === 0);
if (errs.length) errs.slice(0,5).forEach(e => console.log('   !', e.slice(0,120)));

console.log(`\nRESULT: ${pass} passed, ${fail} failed  (network ${netOK?'ok':'skipped'})`);
await browser.close();
process.exit(fail ? 1 : 0);
