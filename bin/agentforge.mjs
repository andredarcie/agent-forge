#!/usr/bin/env node
// AgentForge CLI — an AI-native 3D modeling environment built on Three.js.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const cmd = argv[0];

function parseArgs(rest) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

const HELP = `
AgentForge — AI-native low-poly 3D modeling environment (Three.js)

Models are written as JavaScript, rendered headlessly in a neutral PBR studio
(image-based lighting, soft shadows, ACES) and analyzed: triangle budget,
assembly structure, per-part visibility.

Usage: node bin/agentforge.mjs <command> [args]

Commands:
  new <name>                Create models/<name>.js from a commented starter template
  render <name>             Headless render: multi-view PNGs + contact sheet + data report
      --size WxH            Output resolution (default 960x720)
      --views a,b,c         Views: persp,persp2,front,back,right,left,top,bottom,wire
      --focus <ObjectName>  Frame the camera on one named part (close-up iteration)
      --isolate             With --focus: hide everything except the focused part
      --turntable           Also render 8 rotating perspective views
      --no-sheet            Skip the combined contact sheet
      --out <dir>           Custom output dir (default renders/<name>/)
      --json                Also print the full report JSON to stdout
      --verbose             Stream browser console output
  inspect <name>            Print full analysis report as JSON (no images, fast)
  export <name>             Export the model to exports/<name>.glb
  dev [--port N]            Start the live viewer with hot reload (default port 4747)
  list                      List available models
  help                      Show this help

Typical AI workflow:
  1. node bin/agentforge.mjs new mymodel
  2. edit models/mymodel.js        (low-poly! check the budget in the report)
  3. node bin/agentforge.mjs render mymodel
  4. READ renders/mymodel/sheet.png  (visually verify silhouette, form and detail)
  5. refine models/mymodel.js and re-render; use --focus <Part> for close-ups
`;

async function main() {
  const { flags, positional } = parseArgs(argv.slice(1));
  const name = positional[0];

  switch (cmd) {
    case 'new': {
      if (!name) return die('usage: agentforge new <name>');
      if (!/^[a-zA-Z0-9-_]+$/.test(name)) return die('model name must match [a-zA-Z0-9-_]+');
      const file = path.join(ROOT, 'models', `${name}.js`);
      if (fs.existsSync(file) && !flags.force) return die(`models/${name}.js already exists (use --force to overwrite)`);
      const template = await fsp.readFile(path.join(ROOT, 'src', 'model-template.js'), 'utf8');
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, template.replaceAll('__NAME__', name));
      console.log(`ok Created models/${name}.js`);
      console.log(`   Next: edit it, then run  node bin/agentforge.mjs render ${name}`);
      break;
    }

    case 'render': {
      if (!name) return die('usage: agentforge render <name> [flags]');
      requireModel(name);
      const { renderModel } = await import('../src/capture.mjs');
      const size = typeof flags.size === 'string' ? flags.size.split(/[x,]/i).map(Number) : [960, 720];
      const opts = {
        width: size[0] || 960,
        height: size[1] || 720,
        views: typeof flags.views === 'string' ? flags.views.split(',').map((s) => s.trim()) : undefined,
        isolate: !!flags.isolate,
        turntable: !!flags.turntable,
        sheet: !flags['no-sheet'],
        out: typeof flags.out === 'string' ? flags.out : null,
        json: !!flags.json,
        verbose: !!flags.verbose,
      };
      // --focus accepts a comma-separated list; each part gets its own run
      const focusList = typeof flags.focus === 'string'
        ? flags.focus.split(',').map((s) => s.trim()).filter(Boolean)
        : [null];
      for (const focus of focusList) {
        await renderModel(ROOT, name, { ...opts, focus });
      }
      break;
    }

    case 'inspect': {
      if (!name) return die('usage: agentforge inspect <name>');
      requireModel(name);
      const { inspectModel } = await import('../src/capture.mjs');
      await inspectModel(ROOT, name, { verbose: !!flags.verbose });
      break;
    }

    case 'export': {
      if (!name) return die('usage: agentforge export <name>');
      requireModel(name);
      const { exportModel } = await import('../src/capture.mjs');
      await exportModel(ROOT, name, { verbose: !!flags.verbose });
      break;
    }

    case 'dev': {
      const { startServer } = await import('../src/server.mjs');
      const port = flags.port ? Number(flags.port) : 4747;
      await startServer({ root: ROOT, port });
      console.log('Watching models/ and web/ — the viewer hot-reloads on save. Ctrl+C to stop.');
      break;
    }

    case 'list': {
      const dir = path.join(ROOT, 'models');
      const files = fs.existsSync(dir) ? await fsp.readdir(dir) : [];
      const models = files.filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, ''));
      if (!models.length) console.log('No models yet. Create one: node bin/agentforge.mjs new <name>');
      else for (const m of models) console.log(m);
      break;
    }

    case 'help':
    case undefined:
      console.log(HELP);
      break;

    default:
      die(`unknown command "${cmd}"\n${HELP}`);
  }
}

function requireModel(name) {
  const file = path.join(ROOT, 'models', `${name}.js`);
  if (!fs.existsSync(file)) {
    const dir = path.join(ROOT, 'models');
    const available = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')).join(', ')
      : '(none)';
    die(`model "${name}" not found (looked for models/${name}.js). Available: ${available || '(none)'}`);
  }
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
