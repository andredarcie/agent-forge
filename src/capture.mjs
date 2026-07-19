// Headless capture pipeline: spins up the static server on an ephemeral port,
// drives a headless Chromium page that builds the model with three.js, and
// writes multi-view PNGs, a contact sheet and a full analysis report to disk.
import fsp from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from './server.mjs';
import { findBrowser } from './browser-finder.mjs';

const DEFAULT_VIEWS = ['persp', 'persp2', 'front', 'back', 'right', 'left', 'top', 'wire'];

async function runInPage(root, fn, { width = 1024, height = 768, verbose = false } = {}) {
  const srv = await startServer({ root, port: 0, silent: true, watch: false });
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: [
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--disable-extensions',
      '--no-first-run',
    ],
    protocolTimeout: 240000,
  });
  const consoleLog = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    page.on('console', (msg) => {
      consoleLog.push(`[${msg.type()}] ${msg.text()}`);
      if (verbose) console.log(`  page: [${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => consoleLog.push(`[pageerror] ${err.message}`));
    await page.goto(`http://127.0.0.1:${srv.port}/web/headless.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__ready === true', { timeout: 60000 });
    return await fn(page);
  } catch (err) {
    if (consoleLog.length) err.message += '\n\nPage console:\n' + consoleLog.slice(-25).join('\n');
    throw err;
  } finally {
    await browser.close().catch(() => {});
    srv.close();
  }
}

function dataURLToBuffer(dataURL) {
  return Buffer.from(dataURL.split(',')[1], 'base64');
}

function fmtM(n) {
  return `${Number(n).toFixed(3)}m`;
}

export function printReport(report, { treeMaxLines = 60 } = {}) {
  const s = report.stats;
  const b = report.bounds;
  console.log(`  Size:      ${fmtM(b.size[0])} W x ${fmtM(b.size[1])} H x ${fmtM(b.size[2])} D  (units: ${report.meta.units || 'meters'})`);
  console.log(`  Geometry:  ${s.triangles.toLocaleString()} triangles, ${s.vertices.toLocaleString()} vertices, ${s.meshes} meshes, ${s.objects} objects`);
  if (report.psx) {
    const p = report.psx;
    const pipe = p.pipeline
      ? `  |  pipeline: ${p.pipeline.resolution.join('x')} RGB555${p.pipeline.dither ? '+dither' : ''}${p.pipeline.snap ? ' +vertex-snap' : ''}${p.pipeline.affine ? ' +affine-tex' : ''}`
      : '  |  pipeline: OFF (--hd render)';
    console.log(`  PSX:       budget ${s.triangles.toLocaleString()}/${p.budget.toLocaleString()} tris (${p.pctOfBudget}%) ${p.withinBudget ? 'ok' : '** OVER BUDGET **'}${pipe}`);
  }
  console.log(`  Materials: ${report.materials.map((m) => m.name || m.type).join(', ') || 'none'}`);

  if (report.structure && !report.structure.skipped) {
    const st = report.structure;
    const tolStr = Number.isFinite(st.tolerance) ? ` (tolerance ${(st.tolerance * 1000).toFixed(1)}mm)` : '';
    console.log(`  Contacts:  ${st.contacts.length} touching pairs, ${st.components.length} connected component(s)${tolStr} — full list in report.json`);
    if (st.interfaces && st.interfaces.length) {
      console.log('  Assembly interfaces (how each group mounts to the rest — check each makes physical sense):');
      for (const itf of st.interfaces) {
        const short = (p) => p.split('/').pop();
        if (!itf.mountedBy.length) {
          console.log(`    ${itf.group}  ->  NOT MOUNTED (no external contact)`);
          continue;
        }
        const links = itf.mountedBy.slice(0, 4).map((l) => {
          const flags = [l.grazing ? 'GRAZING' : null, l.viaNonStructural ? 'VIA NON-STRUCTURAL' : null].filter(Boolean);
          return `${short(l.inside)}<->${short(l.outside)} (${l.strength}${flags.length ? ' ' + flags.join(',') : ''})`;
        });
        console.log(`    ${itf.group}  ->  ${links.join(', ')}${itf.mountedBy.length > 4 ? ', ...' : ''}`);
      }
    }
  }

  if (report.issues.length) {
    console.log(`  Issues (${report.issues.length}):`);
    for (const i of report.issues) console.log(`    [${i.level}] ${i.message}`);
    const flagged = [...new Set(report.issues.filter((i) => i.parts).flatMap((i) => i.parts))];
    if (flagged.length) {
      console.log('  Verify flagged parts with close-ups:');
      for (const p of flagged.slice(0, 5)) {
        console.log(`    node bin/agentforge.mjs render ${report.model} --focus ${p} --views persp,front --no-sheet`);
      }
    }
  } else {
    console.log('  Issues:    none detected');
  }
  const lines = report.treeText.split('\n');
  console.log('  Structure:');
  for (const line of lines.slice(0, treeMaxLines)) console.log('    ' + line);
  if (lines.length > treeMaxLines) console.log(`    ... ${lines.length - treeMaxLines} more lines (see report.json)`);
}

export async function renderModel(root, modelName, opts = {}) {
  const {
    // 960x720 = exact 3x integer upscale of the 320x240 PSX framebuffer
    width = 960,
    height = 720,
    views = DEFAULT_VIEWS,
    focus = null,
    isolate = false,
    turntable = false,
    sheet = true,
    out = null,
    json = false,
    verbose = false,
    hd = false,
    psxRes = null,
  } = opts;

  const allViews = [...views];
  if (turntable) for (let i = 0; i < 8; i++) allViews.push(`turn${i}`);

  const result = await runInPage(root, (page) =>
    page.evaluate(
      (o) => window.__capture(o),
      { model: modelName, width, height, views: allViews, focus, isolate, sheet, hd, psxRes }
    ),
    { width, height, verbose }
  );

  if (result.error) {
    console.error(`\nx Render failed for model "${modelName}":\n`);
    console.error(result.error);
    if (result.namedObjects) {
      console.error('\nNamed objects available for --focus:\n  ' + result.namedObjects.join(', '));
    }
    process.exitCode = 1;
    return null;
  }

  const outDir = out ? path.resolve(root, out) : path.join(root, 'renders', modelName + (focus ? `-focus-${focus.replace(/[^a-zA-Z0-9-_]/g, '_')}` : ''));
  const viewsDir = path.join(outDir, 'views');
  await fsp.mkdir(viewsDir, { recursive: true });

  const written = [];
  for (const [name, dataURL] of Object.entries(result.images)) {
    const file = name === 'sheet' ? path.join(outDir, 'sheet.png') : path.join(viewsDir, `${name}.png`);
    await fsp.writeFile(file, dataURLToBuffer(dataURL));
    written.push(path.relative(root, file).replaceAll('\\', '/'));
  }
  const reportFile = path.join(outDir, 'report.json');
  await fsp.writeFile(reportFile, JSON.stringify(result.report, null, 2));

  const relOut = path.relative(root, outDir).replaceAll('\\', '/');
  console.log(`\nok Rendered "${modelName}" -> ${relOut}/`);
  printReport(result.report);
  console.log(`\n  Files:`);
  console.log(`    ${relOut}/sheet.png        <- contact sheet (all views + data). READ THIS IMAGE.`);
  console.log(`    ${relOut}/views/*.png      <- individual views (${allViews.join(', ')})`);
  console.log(`    ${relOut}/report.json      <- full structured data`);
  if (json) {
    console.log('\n--- report.json ---');
    console.log(JSON.stringify(result.report, null, 2));
  }
  return result;
}

export async function inspectModel(root, modelName, opts = {}) {
  const result = await runInPage(root, (page) =>
    page.evaluate(
      (o) => window.__capture(o),
      { model: modelName, width: 64, height: 64, views: [], sheet: false }
    ),
    { width: 64, height: 64, verbose: opts.verbose }
  );
  if (result.error) {
    console.error(`\nx Inspect failed for "${modelName}":\n${result.error}`);
    process.exitCode = 1;
    return null;
  }
  console.log(JSON.stringify(result.report, null, 2));
  return result.report;
}

export async function exportModel(root, modelName, opts = {}) {
  const result = await runInPage(root, (page) =>
    page.evaluate((name) => window.__exportGLB(name), modelName),
    { width: 64, height: 64, verbose: opts.verbose }
  );
  if (result.error) {
    console.error(`\nx Export failed for "${modelName}":\n${result.error}`);
    process.exitCode = 1;
    return null;
  }
  const outDir = path.join(root, 'exports');
  await fsp.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${modelName}.glb`);
  await fsp.writeFile(file, Buffer.from(result.base64, 'base64'));
  const kb = (result.base64.length * 0.75 / 1024).toFixed(1);
  console.log(`ok Exported -> exports/${modelName}.glb (${kb} KB)`);
  return file;
}
