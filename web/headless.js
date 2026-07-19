// Headless capture page. Exposes:
//   window.__capture(opts)  -> { report, images: { <view>: dataURL, sheet } } | { error }
//   window.__exportGLB(name) -> { base64 } | { error }
import * as THREE from 'three';
import { setupRenderer, createStage, VIEWS, makeViewCamera } from '/web/common/stage.js';
import { loadModel } from '/web/common/model-loader.js';
import { analyze } from '/web/common/analyze.js';
import { analyzeContacts } from '/web/common/contacts.js';
import { analyzeVisibility } from '/web/common/visibility.js';
import { PSXPost, createPSXUniforms, patchModelPSX, setPSXArtifacts, PSX_DEFAULTS } from '/web/common/psx.js';

function findByName(root, name) {
  let exact = null;
  let fuzzy = null;
  root.traverse((o) => {
    if (o.name === name) exact = exact || o;
    else if (!fuzzy && o.name && o.name.toLowerCase().includes(name.toLowerCase())) fuzzy = o;
  });
  return exact || fuzzy;
}

function isolateObject(root, target) {
  const keep = new Set();
  target.traverse((o) => keep.add(o));
  let n = target;
  while (n) { keep.add(n); n = n.parent; }
  root.traverse((o) => {
    if (o.isMesh && !keep.has(o)) o.visible = false;
  });
}

async function capture(opts) {
  const {
    model, width = 960, height = 720,
    views = [], focus = null, isolate = false, sheet = true,
    hd = false, psxRes = null,
  } = opts;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  document.body.appendChild(renderer.domElement);

  let post = null;
  try {
    const { root, meta, error } = await loadModel(model);
    if (error) return { error };

    // PSX pipeline configuration: meta.psx in the model file, overridable by
    // CLI flags. --hd disables everything (clean modern render for debugging).
    const psxMeta = (meta && meta.psx) || {};
    const psxOn = !hd && psxMeta.enabled !== false;
    const resolution = psxRes || psxMeta.resolution || PSX_DEFAULTS.resolution;

    setupRenderer(renderer, { psx: psxOn });
    const stage = createStage(renderer, { psx: psxOn });
    stage.scene.add(root);
    root.updateMatrixWorld(true);

    const report = analyze(root, { meta, modelName: model });
    const modelBox = new THREE.Box3().setFromObject(root);
    stage.fit(modelBox);

    // Structural analysis: contact graph + visibility ID-pass. Their issues
    // are merged into the main report so they surface everywhere.
    const contactReport = analyzeContacts(root);
    report.structure = {
      tolerance: contactReport.tolerance,
      contacts: contactReport.contacts,
      components: contactReport.components,
      interfaces: contactReport.interfaces,
    };
    report.issues.push(...contactReport.issues);
    const visReport = analyzeVisibility(renderer, stage.scene, root, modelBox);
    report.visibility = visReport.perPart;
    report.issues.push(...visReport.issues);

    let frameBox = modelBox;
    if (focus) {
      const target = findByName(root, focus);
      if (!target) {
        return {
          error: `--focus "${focus}" did not match any object.`,
          namedObjects: report.namedObjects,
        };
      }
      frameBox = new THREE.Box3().setFromObject(target);
      report.focus = { name: target.name, size: report.namedObjects ? undefined : undefined };
      if (isolate) isolateObject(root, target);
    }

    // Patch materials with vertex snap / affine UVs AFTER all analysis passes
    // so the structural data reflects the pristine geometry.
    let psxUniforms = null;
    if (psxOn) {
      psxUniforms = createPSXUniforms({
        width: resolution[0], height: resolution[1],
        snap: psxMeta.snap !== false, affine: psxMeta.affine !== false,
      });
      patchModelPSX(root, psxUniforms);
      post = new PSXPost(renderer, {
        width: resolution[0], height: resolution[1],
        dither: psxMeta.dither !== false,
      });
      report.psx = {
        ...report.psx,
        pipeline: {
          resolution, dither: psxMeta.dither !== false,
          snap: psxMeta.snap !== false, affine: psxMeta.affine !== false,
        },
      };
    }

    const images = {};
    // clean=true renders without the PSX pipeline (diagnostic views: the
    // wireframe cell and the auto issue close-ups need crisp geometry).
    function renderView(view, box, { clean = false } = {}) {
      stage.setGround(view.floor !== false);
      stage.setGrid(view.grid !== false && view.type === 'persp' && !view.wireframe);
      stage.setWireframe(!!view.wireframe);
      if (view.wireframe) stage.scene.background = new THREE.Color(0xf7f8fa);
      const cam = makeViewCamera(view, box, width / height);
      const usePsx = psxOn && !clean && !view.wireframe;
      if (psxUniforms) setPSXArtifacts(psxUniforms, usePsx);
      if (usePsx) post.render(stage.scene, cam);
      else renderer.render(stage.scene, cam);
      const dataURL = renderer.domElement.toDataURL('image/png');
      stage.setWireframe(false);
      stage.scene.background = stage.backgroundColor;
      stage.setGround(true);
      return dataURL;
    }

    for (const viewName of views) {
      const view = VIEWS[viewName];
      if (!view) continue;
      images[viewName] = renderView(view, frameBox);
    }

    // Auto close-ups: every part flagged by a structural issue gets a focused
    // render appended to the output, so the defect is impossible to miss.
    // Rendered CLEAN (no dither/snap) — these are defect-inspection images.
    const flagged = [...new Set(
      report.issues.filter((i) => i.parts && i.level !== 'info').flatMap((i) => i.parts)
    )].slice(0, 4);
    const autoFocus = [];
    for (const partName of flagged) {
      const obj = findByName(root, partName);
      if (!obj) continue;
      const box = new THREE.Box3().setFromObject(obj).expandByScalar(
        modelBox.getSize(new THREE.Vector3()).length() * 0.06
      );
      const key = `issue-${partName.replace(/[^a-zA-Z0-9-_]/g, '_')}`;
      images[key] = renderView(VIEWS.persp, box, { clean: true });
      autoFocus.push({ key, label: `ISSUE FOCUS: ${partName}` });
    }

    if (sheet && Object.keys(images).length) {
      images.sheet = await composeSheet(images, views, report, model, autoFocus);
    }

    return { report, images };
  } catch (e) {
    return { error: String(e && e.stack ? e.stack : e) };
  } finally {
    if (post) post.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
}

async function composeSheet(images, viewOrder, report, modelName, autoFocus = []) {
  const sheetViews = viewOrder.filter((v) => images[v] && !v.startsWith('turn'));
  const cellW = 620, cellH = 470, labelH = 26, headerH = 58;
  const cols = 3;
  const cells = sheetViews.length + autoFocus.length + 1; // +1 info card
  const rows = Math.ceil(cells / cols);
  const W = cols * cellW;
  const H = headerH + rows * (cellH + labelH);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#12161c';
  ctx.fillRect(0, 0, W, H);

  // Header
  const b = report.bounds;
  const s = report.stats;
  const psx = report.psx;
  ctx.fillStyle = '#e8edf4';
  ctx.font = 'bold 24px Segoe UI, Arial, sans-serif';
  ctx.fillText(`AgentForge PSX — ${modelName}`, 20, 36);
  const budgetStr = psx
    ? `budget ${s.triangles.toLocaleString()}/${psx.budget.toLocaleString()} tris (${psx.pctOfBudget}%)${psx.withinBudget ? '' : ' OVER'}`
    : `${s.triangles.toLocaleString()} tris`;
  ctx.fillStyle = psx && !psx.withinBudget ? '#ff8a5c' : '#93a4bb';
  ctx.font = '15px Consolas, monospace';
  ctx.fillText(
    `W ${b.size[0].toFixed(3)}m  x  H ${b.size[1].toFixed(3)}m  x  D ${b.size[2].toFixed(3)}m   |   ${budgetStr}   |   ${s.meshes} meshes   |   ${s.materials} materials   |   issues: ${report.issues.length}`,
    20, headerH - 8
  );

  async function drawCell(dataURL, label, col, row) {
    const x = col * cellW, y = headerH + row * (cellH + labelH);
    const img = new Image();
    img.src = dataURL;
    await img.decode();
    ctx.drawImage(img, x + 2, y + 2, cellW - 4, cellH - 4);
    ctx.fillStyle = '#1b222c';
    ctx.fillRect(x + 2, y + cellH, cellW - 4, labelH - 2);
    ctx.fillStyle = '#aebdd2';
    ctx.font = 'bold 13px Consolas, monospace';
    ctx.fillText(label, x + 12, y + cellH + 17);
  }

  for (let i = 0; i < sheetViews.length; i++) {
    const v = sheetViews[i];
    await drawCell(images[v], VIEWS[v] ? VIEWS[v].label : v.toUpperCase(), i % cols, Math.floor(i / cols));
  }

  // Auto-focus cells for structurally flagged parts (labels drawn in warning color)
  for (let k = 0; k < autoFocus.length; k++) {
    const i = sheetViews.length + k;
    await drawCell(images[autoFocus[k].key], autoFocus[k].label, i % cols, Math.floor(i / cols));
    const x = (i % cols) * cellW, y = headerH + Math.floor(i / cols) * (cellH + labelH);
    ctx.strokeStyle = '#e0a034';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 3, y + 3, cellW - 6, cellH + labelH - 6);
  }

  // Info card cell
  {
    const i = sheetViews.length + autoFocus.length;
    const x = (i % cols) * cellW, y = headerH + Math.floor(i / cols) * (cellH + labelH);
    ctx.fillStyle = '#1a2028';
    ctx.fillRect(x + 2, y + 2, cellW - 4, cellH + labelH - 4);
    ctx.fillStyle = '#e8edf4';
    ctx.font = 'bold 16px Consolas, monospace';
    ctx.fillText('MODEL DATA', x + 20, y + 34);
    ctx.font = '13px Consolas, monospace';
    ctx.fillStyle = '#9fb0c6';
    let ly = y + 62;
    const line = (t, color = '#9fb0c6') => {
      ctx.fillStyle = color;
      ctx.fillText(t.length > 74 ? t.slice(0, 71) + '...' : t, x + 20, ly);
      ly += 20;
    };
    line(`size    : ${b.size[0].toFixed(3)} x ${b.size[1].toFixed(3)} x ${b.size[2].toFixed(3)} m (WxHxD)`);
    line(`geometry: ${s.triangles.toLocaleString()} tris / ${s.vertices.toLocaleString()} verts / ${s.meshes} meshes`);
    if (report.psx) {
      line(
        `psx     : budget ${s.triangles.toLocaleString()}/${report.psx.budget.toLocaleString()} (${report.psx.pctOfBudget}%)` +
        (report.psx.pipeline ? `  ${report.psx.pipeline.resolution.join('x')} RGB555` : ''),
        report.psx.withinBudget ? '#7ece8f' : '#ff8a5c'
      );
    }
    line(`objects : ${s.objects}  materials: ${s.materials}`);
    ly += 8;
    line('materials:', '#c7d3e2');
    for (const m of report.materials.slice(0, 6)) {
      line(`  ${m.name || m.type}  ${m.color || ''}  rough=${m.roughness ?? '-'} metal=${m.metalness ?? '-'}`);
    }
    if (report.materials.length > 6) line(`  ... +${report.materials.length - 6} more`);
    ly += 8;
    if (report.issues.length) {
      line(`issues (${report.issues.length}):`, '#ffb454');
      for (const iss of report.issues.slice(0, 5)) {
        line(`  [${iss.level}] ${iss.message}`, iss.level === 'error' ? '#ff6b6b' : '#e0c184');
      }
      if (report.issues.length > 5) line(`  ... +${report.issues.length - 5} more (see report.json)`);
    } else {
      line('issues: none detected', '#7ece8f');
    }
  }

  return canvas.toDataURL('image/png');
}

// Ensure every distinct material has a unique name so integrators can tell
// them apart in the exported glTF (two different materials both named
// "textured" is ambiguous). Suffixes duplicates from _2 onward.
function uniquifyMaterialNames(root) {
  const materials = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) if (m) materials.set(m.uuid, m);
  });
  const counts = new Map();
  for (const m of materials.values()) {
    const base = m.name || m.type || 'material';
    const n = (counts.get(base) || 0) + 1;
    counts.set(base, n);
    if (n > 1) m.name = `${base}_${n}`;
  }
}

async function exportGLB(modelName) {
  try {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const { root, error } = await loadModel(modelName);
    if (error) return { error };
    uniquifyMaterialNames(root);
    const exporter = new GLTFExporter();
    // GLTFExporter names glTF nodes but leaves the `meshes[]` entries
    // anonymous. Register a writeMesh plugin to copy the object/geometry name
    // onto the glTF mesh, so integrators see named meshes too.
    exporter.register(() => ({
      writeMesh(mesh, meshDef) {
        const nm = mesh.name || (mesh.geometry && mesh.geometry.name);
        if (nm && !meshDef.name) meshDef.name = String(nm);
      },
    }));
    // trs:true -> every node exports translation/rotation/scale (never a raw
    // matrix), a consistent, engine-friendly encoding. userData is emitted as
    // glTF `extras` automatically (metadata anchors, articulation hints).
    const buffer = await exporter.parseAsync(root, { binary: true, trs: true });
    const u8 = new Uint8Array(buffer);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return { base64: btoa(bin) };
  } catch (e) {
    return { error: String(e && e.stack ? e.stack : e) };
  }
}

window.__capture = capture;
window.__exportGLB = exportGLB;
window.__ready = true;
