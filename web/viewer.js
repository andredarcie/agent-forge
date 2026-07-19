// Live viewer: orbit camera, hot reload via SSE, data panel, screenshots.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { setupRenderer, createStage } from '/web/common/stage.js';
import { loadModel } from '/web/common/model-loader.js';
import { analyze } from '/web/common/analyze.js';
import { analyzeContacts } from '/web/common/contacts.js';

const host = document.getElementById('canvas-host');
const statusEl = document.getElementById('status');
const errorOverlay = document.getElementById('error-overlay');
const modelSelect = document.getElementById('model-select');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
setupRenderer(renderer);
host.appendChild(renderer.domElement);

const stage = createStage(renderer);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.001, 500);
camera.position.set(0.6, 0.45, 0.6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

let currentRoot = null;
let currentModel = null;
let wireframe = false;

function setStatus(text, color) {
  statusEl.textContent = text;
  statusEl.style.color = color || '';
}

function fmt(n) { return Number(n).toFixed(3); }

function updatePanel(report) {
  const s = report.stats, b = report.bounds;
  const budget = report.budget;
  const budgetHtml = budget
    ? `<div class="kv"><b>Tri budget</b><span style="color:${budget.withinBudget ? 'var(--ok)' : 'var(--err)'}">${s.triangles.toLocaleString()} / ${budget.budget.toLocaleString()} (${budget.pctOfBudget}%)</span></div>`
    : '';
  document.getElementById('sec-stats').innerHTML = `
    <div class="kv"><b>Size (W×H×D)</b><span>${fmt(b.size[0])} × ${fmt(b.size[1])} × ${fmt(b.size[2])} m</span></div>
    <div class="kv"><b>Triangles</b><span>${s.triangles.toLocaleString()}</span></div>
    ${budgetHtml}
    <div class="kv"><b>Vertices</b><span>${s.vertices.toLocaleString()}</span></div>
    <div class="kv"><b>Meshes</b><span>${s.meshes}</span></div>
    <div class="kv"><b>Objects</b><span>${s.objects}</span></div>
    <div class="kv"><b>Materials</b><span>${s.materials}</span></div>`;
  document.getElementById('sec-issues').innerHTML = report.issues.length
    ? report.issues.map((i) => `<div class="issue ${i.level}">[${i.level}] ${escapeHtml(i.message)}</div>`).join('')
    : '<div class="issue ok">none detected ✓</div>';
  document.getElementById('tree').textContent = report.treeText;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function frameModel(box, keepCamera = false) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.001);
  controls.target.copy(center);
  if (!keepCamera) {
    const dist = (radius * 1.25) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.copy(center).add(new THREE.Vector3(1, 0.55, 1).normalize().multiplyScalar(dist));
  }
  camera.near = radius * 0.01;
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

async function load(name, { keepCamera = false } = {}) {
  if (!name) return;
  currentModel = name;
  setStatus('loading…');
  errorOverlay.style.display = 'none';

  const { root, meta, error } = await loadModel(name);
  if (error) {
    errorOverlay.textContent = error;
    errorOverlay.style.display = 'block';
    setStatus('build error', 'var(--err)');
    return;
  }

  if (currentRoot) {
    stage.scene.remove(currentRoot);
    currentRoot.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose());
      }
    });
  }
  currentRoot = root;
  stage.scene.add(root);

  const report = analyze(root, { meta, modelName: name });
  try {
    report.issues.push(...analyzeContacts(root).issues);
  } catch (e) {
    console.warn('contact analysis failed:', e);
  }
  const box = new THREE.Box3().setFromObject(root);
  stage.fit(box);
  frameModel(box, keepCamera);
  updatePanel(report);

  const issueCount = report.issues.length;
  setStatus(`${name} · ${report.stats.triangles.toLocaleString()} tris${issueCount ? ` · ${issueCount} issue(s)` : ''}`,
    issueCount ? 'var(--warn)' : 'var(--ok)');
  const url = new URL(location.href);
  url.searchParams.set('model', name);
  history.replaceState(null, '', url);
}

// ---- Camera persistence across hot reloads --------------------------------
function saveCameraState() {
  sessionStorage.setItem('af-cam', JSON.stringify({
    pos: camera.position.toArray(),
    target: controls.target.toArray(),
    model: currentModel,
  }));
}
function restoreCameraState() {
  try {
    const st = JSON.parse(sessionStorage.getItem('af-cam') || 'null');
    if (st && st.model === currentModel) {
      camera.position.fromArray(st.pos);
      controls.target.fromArray(st.target);
      controls.update();
      return true;
    }
  } catch {}
  return false;
}

// ---- UI wiring -------------------------------------------------------------
document.getElementById('btn-reload').onclick = () => load(currentModel, { keepCamera: true });
document.getElementById('btn-wire').onclick = (e) => {
  wireframe = !wireframe;
  stage.setWireframe(wireframe);
  e.currentTarget.classList.toggle('active', wireframe);
};
document.getElementById('btn-grid').onclick = (e) => {
  const on = !stage.grid.visible;
  stage.setGrid(on);
  stage.setGround(on);
  e.currentTarget.classList.toggle('active', on);
};
document.getElementById('btn-shot').onclick = takeScreenshot;
modelSelect.onchange = () => load(modelSelect.value);

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  if (e.key === 'w' || e.key === 'W') document.getElementById('btn-wire').click();
  if (e.key === 'g' || e.key === 'G') document.getElementById('btn-grid').click();
  if (e.key === 'p' || e.key === 'P') takeScreenshot();
});

function renderFrame() {
  renderer.render(stage.scene, camera);
}

async function takeScreenshot() {
  renderFrame();
  const dataURL = renderer.domElement.toDataURL('image/png');
  const res = await fetch('/api/screenshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: currentModel, dataURL }),
  });
  const { saved } = await res.json();
  setStatus(`saved ${saved}`, 'var(--ok)');
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---- Hot reload via SSE -----------------------------------------------------
const events = new EventSource('/events');
events.onmessage = (e) => {
  if (e.data === 'reload') {
    saveCameraState();
    load(currentModel, { keepCamera: true }).then(() => restoreCameraState());
  }
};
events.onopen = () => { if (!currentModel) setStatus('ready'); };

// ---- Boot -------------------------------------------------------------------
(async function boot() {
  const { models } = await (await fetch('/api/models')).json();
  modelSelect.innerHTML = models.map((m) => `<option value="${m}">${m}</option>`).join('');
  const wanted = new URL(location.href).searchParams.get('model');
  const initial = wanted && models.includes(wanted) ? wanted : models[0];
  if (initial) {
    modelSelect.value = initial;
    await load(initial);
    restoreCameraState();
  } else {
    setStatus('no models — run: node bin/agentforge.mjs new <name>', 'var(--warn)');
  }
})();

renderer.setAnimationLoop(() => {
  controls.update();
  renderFrame();
});
