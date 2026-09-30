import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = s => document.querySelector(s);
const canvas = $('#viewport');
const viewer = $('.viewer');
const slider = $('#time');
const output = $('#time-output');
const status = $('#status');
const runSelect = $('#run-select');
const cameraSelect = $('#camera-select');
const saveCameraButton = $('#save-camera');
const videoLayer = $('#video-layer');
const experimentVideo = $('#experiment-video');
const videoMode = $('#video-mode');
const videoOpacity = $('#video-opacity');
const playButton = $('#play');

const [manifest, loadData] = await Promise.all([
  fetch('data/manifest.json').then(r => r.json()),
  fetch('data/loads.json').then(r => r.json()),
]);

let activeRun = 'run2';
let activeTime = 10;
let requestToken = 0;
let timer = null;
let currentGeometryFile = '';
let structure = null;
let particleMesh = null;
let particleCount = 0;
let positionTexture = null;
let quaternionTexture = null;
const textureWidth = 256;
let textureHeight = 1;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x111416, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 250);
camera.position.set(21, 22, 38);

const videoTexture = new THREE.VideoTexture(experimentVideo);
videoTexture.colorSpace = THREE.SRGBColorSpace;
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;
const overlayScene = new THREE.Scene();
const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const overlayMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthTest: false,
  depthWrite: false,
  uniforms: {
    videoMap: { value: videoTexture },
    opacity: { value: 0.45 },
    viewportAspect: { value: 16 / 9 },
    radialK1: { value: -0.28967118 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D videoMap;
    uniform float opacity;
    uniform float viewportAspect;
    uniform float radialK1;
    varying vec2 vUv;
    void main() {
      const float sourceAspect = 1.7777777778;
      vec2 visible = vec2(1.0);
      if (viewportAspect > sourceAspect) visible.y = sourceAspect / viewportAspect;
      else visible.x = viewportAspect / sourceAspect;
      vec2 undistortedUv = vec2(0.5) + (vUv - vec2(0.5)) * visible;
      vec2 metric = (undistortedUv - vec2(0.5)) * vec2(1920.0 / 991.19698, 1080.0 / 991.19698);
      float radial = 1.0 + radialK1 * dot(metric, metric);
      vec2 sampleUv = vec2(0.5) + (undistortedUv - vec2(0.5)) * radial;
      if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) discard;
      gl_FragColor = vec4(texture2D(videoMap, sampleUv).rgb, opacity);
    }
  `,
});
const overlayQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), overlayMaterial);
overlayScene.add(overlayQuad);
const controls = new OrbitControls(camera, canvas);
controls.target.set(21, 5.9, 20);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.35;
controls.update();

const cameraPresets = {
  overview: {
    target: [21, 5.9, 20],
    position: [21, 22, 38],
    up: [0, 1, 0],
    fov: 34,
  },
  video: {
    // Calibrated against the unwarped source video. The sheet's particle
    // edges follow the two longitudinal image lines, while the contact line
    // is placed halfway down the 1.2 m inclined plate.
    position: [31.5970278282, 11.5369592519, 11.5401156384],
    target: [36.35587068, -0.66671607, 22.37633839],
    up: [0.3655079493, 0.7019372187, 0.6113003189],
    fov: 54.92123752,
  },
};
function applyCamera(view) {
  camera.position.fromArray(view.position);
  camera.up.fromArray(view.up ?? [0, 1, 0]).normalize();
  controls.target.fromArray(view.target);
  camera.fov = view.fov ?? 45;
  camera.updateProjectionMatrix();
  controls.update();
}
const savedCamera = JSON.parse(localStorage.getItem('lemstrom-camera') || 'null');
if (savedCamera) cameraSelect.querySelector('[value="saved"]').disabled = false;
cameraSelect.addEventListener('change', () => {
  const view = cameraSelect.value === 'saved' ? JSON.parse(localStorage.getItem('lemstrom-camera') || 'null') : cameraPresets[cameraSelect.value];
  if (view) applyCamera(view);
  resize();
});
controls.addEventListener('start', () => { cameraSelect.value = 'custom'; });
saveCameraButton.addEventListener('click', () => {
  const view = { position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray(), fov: camera.fov };
  localStorage.setItem('lemstrom-camera', JSON.stringify(view));
  cameraSelect.querySelector('[value="saved"]').disabled = false;
  cameraSelect.value = 'saved';
});
applyCamera(cameraPresets[cameraSelect.value]);

let viewportRect = { x: 0, y: 0, width: 1, height: 1 };
function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  overlayMaterial.uniforms.viewportAspect.value = rect.width / rect.height;
  camera.clearViewOffset();
  if (videoMode.value === 'overlay') {
    const sourceAspect = 16 / 9;
    let width = rect.width;
    let height = width / sourceAspect;
    if (height > rect.height) { height = rect.height; width = height * sourceAspect; }
    viewportRect = { x: (rect.width - width) / 2, y: (rect.height - height) / 2, width, height };
    camera.aspect = sourceAspect;
  } else {
    viewportRect = { x: 0, y: 0, width: rect.width, height: rect.height };
    camera.aspect = rect.width / rect.height;
  }
  camera.updateProjectionMatrix();
  viewer.style.setProperty('--letterbox-width', `${Math.max(0, viewportRect.x)}px`);
  viewer.classList.toggle('overlay-active', videoMode.value === 'overlay' && viewportRect.x >= 180);
}
new ResizeObserver(resize).observe(canvas);
function render() {
  controls.update();
  const rect = canvas.getBoundingClientRect();
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, rect.width, rect.height);
  renderer.clear();
  renderer.autoClear = false;
  renderer.setViewport(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
  renderer.setScissor(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
  renderer.setScissorTest(true);
  renderer.render(scene, camera);
  renderer.setScissorTest(false);
  requestAnimationFrame(render);
}
resize(); render();

async function decodedBuffer(url) {
  // Keep the regenerated mesh and frames on the same cache revision.
  const response = await fetch(`${url}?v=particle-id-order-1`);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const raw = await response.arrayBuffer();
  const bytes = new Uint8Array(raw);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return raw;
  if (!('DecompressionStream' in window)) throw new Error('gzip decompression is not supported by this browser');
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

function magic(buffer) { return String.fromCharCode(...new Uint8Array(buffer, 0, 4)); }

async function loadParticleMesh() {
  status.textContent = 'Loading particle geometry';
  const buffer = await decodedBuffer('data/particles.bin.gz');
  if (magic(buffer) !== 'DMM1') throw new Error('Invalid particle mesh');
  const view = new DataView(buffer);
  particleCount = view.getUint32(4, true);
  const vertexCount = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  let offset = 16;
  const localPositions = new Float32Array(buffer, offset, vertexCount * 3); offset += vertexCount * 12;
  const particleIdsRaw = new Uint32Array(buffer, offset, vertexCount); offset += vertexCount * 4;
  const indices = new Uint32Array(buffer, offset, indexCount);
  const particleIds = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) particleIds[i] = particleIdsRaw[i];

  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(localPositions, 3));
  geometry.setAttribute('particleIndex', new THREE.BufferAttribute(particleIds, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const indexedGeometry = geometry;
  geometry = indexedGeometry.toNonIndexed();
  indexedGeometry.dispose();
  geometry.computeVertexNormals();

  textureHeight = Math.ceil(particleCount / textureWidth);
  const textureSize = textureWidth * textureHeight * 4;
  positionTexture = new THREE.DataTexture(new Float32Array(textureSize), textureWidth, textureHeight, THREE.RGBAFormat, THREE.FloatType);
  quaternionTexture = new THREE.DataTexture(new Float32Array(textureSize), textureWidth, textureHeight, THREE.RGBAFormat, THREE.FloatType);
  for (const texture of [positionTexture, quaternionTexture]) {
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
  }

  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {
      positions: { value: positionTexture },
      quaternions: { value: quaternionTexture },
      textureSize: { value: new THREE.Vector2(textureWidth, textureHeight) },
    },
    vertexShader: `
      precision highp float;
      attribute float particleIndex;
      uniform sampler2D positions;
      uniform sampler2D quaternions;
      uniform vec2 textureSize;
      varying vec3 vNormal;
      vec3 rotateByQuat(vec3 v, vec4 q) {
        vec3 t = 2.0 * cross(q.xyz, v);
        return v + q.w * t + cross(q.xyz, t);
      }
      vec2 particleUv(float id) {
        return (vec2(mod(id, textureSize.x), floor(id / textureSize.x)) + 0.5) / textureSize;
      }
      void main() {
        vec2 uv = particleUv(particleIndex);
        vec3 center = texture2D(positions, uv).xyz;
        vec4 q = normalize(texture2D(quaternions, uv));
        vec3 worldPosition = center + rotateByQuat(position, q);
        vNormal = rotateByQuat(normal, q);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vNormal;
      void main() {
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        float key = max(dot(n, normalize(vec3(-0.35, 0.78, 0.48))), 0.0);
        float fill = max(dot(n, normalize(vec3(0.55, 0.25, -0.80))), 0.0);
        float light = 0.34 + 0.54 * key + 0.12 * fill;
        gl_FragColor = vec4(vec3(0.62, 0.77, 0.83) * light, 1.0);
      }
    `,
  });
  particleMesh = new THREE.Mesh(geometry, material);
  particleMesh.frustumCulled = false;
  scene.add(particleMesh);
  $('#particle-count').textContent = `${particleCount.toLocaleString()} bodies`;
}

async function loadGeometry(file) {
  if (file === currentGeometryFile) return;
  const buffer = await decodedBuffer(`data/${file}`);
  if (magic(buffer) !== 'DMG1') throw new Error('Invalid structure geometry');
  const triangleCount = new DataView(buffer).getUint32(4, true);
  const positions = new Float32Array(buffer, 8, triangleCount * 9);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.MeshBasicMaterial({ color: 0x82898c, wireframe: true, transparent: true, opacity: 0.82 });
  const next = new THREE.Mesh(geometry, material);
  if (structure) { scene.remove(structure); structure.geometry.dispose(); structure.material.dispose(); }
  structure = next;
  scene.add(structure);
  currentGeometryFile = file;
}

async function loadFrame(run, time) {
  const token = ++requestToken;
  status.textContent = 'Loading frame';
  try {
    const info = manifest.runs.find(r => r.id === run);
    const frameTime = Math.min(time, info.maxTime ?? time);
    await Promise.all([loadGeometry(info.geometry), particleMesh ? Promise.resolve() : loadParticleMesh()]);
    const buffer = await decodedBuffer(`data/${run}/${frameTime}.bin.gz`);
    if (token !== requestToken) return;
    if (magic(buffer) !== 'DMQ1') throw new Error('Invalid frame');
    const view = new DataView(buffer);
    const count = view.getUint32(4, true);
    if (count !== particleCount) throw new Error('Particle count changed');
    const bounds = new Float32Array(buffer, 16, 6);
    const packedPositions = new Uint16Array(buffer, 40, count * 3);
    const packedQuaternions = new Int16Array(buffer, 40 + count * 6, count * 4);
    const positionData = positionTexture.image.data;
    const quaternionData = quaternionTexture.image.data;
    const sx = (bounds[3] - bounds[0]) / 65535;
    const sy = (bounds[4] - bounds[1]) / 65535;
    const sz = (bounds[5] - bounds[2]) / 65535;
    for (let i = 0; i < count; i++) {
      const p = i * 3;
      const q = i * 4;
      positionData[q] = bounds[0] + packedPositions[p] * sx;
      positionData[q + 1] = bounds[1] + packedPositions[p + 1] * sy;
      positionData[q + 2] = bounds[2] + packedPositions[p + 2] * sz;
      positionData[q + 3] = 1;
      quaternionData[q] = packedQuaternions[q] / 32767;
      quaternionData[q + 1] = packedQuaternions[q + 1] / 32767;
      quaternionData[q + 2] = packedQuaternions[q + 2] / 32767;
      quaternionData[q + 3] = packedQuaternions[q + 3] / 32767;
    }
    positionTexture.needsUpdate = true;
    quaternionTexture.needsUpdate = true;
    status.textContent = frameTime < time ? `Run ends at ${frameTime} s` : 'Ready';
  } catch (error) {
    console.error(error);
    status.textContent = 'Frame unavailable';
  }
}

function syncVideo(time) {
  const seek = () => {
    if (Math.abs(experimentVideo.currentTime - time) > 0.05) experimentVideo.currentTime = time;
  };
  if (experimentVideo.readyState >= 1) seek();
  else experimentVideo.addEventListener('loadedmetadata', seek, { once: true });
}
function setTime(value) {
  const snapped = Math.max(10, Math.min(460, Math.round(Number(value) / 10) * 10));
  activeTime = snapped;
  slider.value = snapped;
  output.textContent = `${snapped} s`;
  Plotly.relayout('chart', { 'shapes[0].x0': snapped, 'shapes[0].x1': snapped });
  syncVideo(snapped);
  loadFrame(activeRun, snapped);
}
function setRun(id) {
  activeRun = id;
  runSelect.value = id;
  $('#param-history').textContent = id === 'run1' || id === 'run2' ? 'yes' : 'no';
  $('#param-face-area').textContent = id === 'run1' || id === 'run3' ? 'old' : 'Newell';
  loadFrame(activeRun, activeTime);
}

manifest.runs.forEach(run => runSelect.add(new Option(run.name, run.id)));
runSelect.value = activeRun;
runSelect.addEventListener('change', e => setRun(e.target.value));
slider.addEventListener('input', e => setTime(e.target.value));
videoMode.addEventListener('change', () => {
  videoLayer.className = videoMode.value === 'corner' ? 'video-layer corner' : videoMode.value === 'overlay' ? 'video-layer overlay' : 'video-layer';
  if (videoMode.value !== 'off' && experimentVideo.readyState === 0) experimentVideo.load();
  syncVideo(activeTime);
  resize();
});
videoOpacity.addEventListener('input', () => {
  videoLayer.style.opacity = videoOpacity.value;
  overlayMaterial.uniforms.opacity.value = Number(videoOpacity.value);
});
videoLayer.style.opacity = videoOpacity.value;
overlayMaterial.uniforms.opacity.value = Number(videoOpacity.value);
videoLayer.className = videoMode.value === 'overlay' ? 'video-layer overlay' : 'video-layer';
if (videoMode.value !== 'off') experimentVideo.load();
resize();
playButton.addEventListener('click', () => {
  if (timer) { clearInterval(timer); timer = null; playButton.textContent = 'Play'; return; }
  playButton.textContent = 'Pause';
  timer = setInterval(() => {
    if (activeTime >= 460) { clearInterval(timer); timer = null; playButton.textContent = 'Play'; return; }
    setTime(activeTime + 10);
  }, 850);
});

const traces = loadData.traces.map((trace, i) => ({
  x: loadData.times, y: trace.values, type: 'scattergl', mode: 'lines', name: trace.name, meta: trace.id,
  line: { color: trace.color, width: i === 0 ? 1.8 : 1.15, dash: trace.dash },
  hovertemplate: '%{y:,.0f} N<extra>%{fullData.name}</extra>',
}));
Plotly.newPlot('chart', traces, {
  paper_bgcolor: '#1b1e20', plot_bgcolor: '#1b1e20',
  margin: { l: 62, r: 18, t: 48, b: 42 },
  font: { family: 'IBM Plex Sans, sans-serif', color: '#b6b9ba', size: 11 },
  title: { text: 'Structure force Fx', x: .012, y: .95, font: { color: '#e5e6e4', size: 13 } },
  xaxis: { title: 'Time [s]', range: [0, 464], gridcolor: '#33373a', zerolinecolor: '#33373a' },
  yaxis: { title: 'Force [N]', gridcolor: '#33373a', zerolinecolor: '#33373a', rangemode: 'tozero' },
  showlegend: false,
  hovermode: 'x unified',
  shapes: [{ type: 'line', x0: 10, x1: 10, y0: 0, y1: 1, yref: 'paper', line: { color: '#d4d7d8', width: 1 } }],
}, { responsive: true, displaylogo: false, scrollZoom: true, modeBarButtonsToRemove: ['lasso2d', 'select2d'] });

const traceControls = $('#trace-controls');
traces.forEach((trace, index) => {
  const label = document.createElement('label');
  label.style.setProperty('--series-color', trace.line.color);
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = true;
  checkbox.setAttribute('aria-label', `Show ${trace.name}`);
  checkbox.addEventListener('change', () => {
    Plotly.restyle('chart', { visible: checkbox.checked ? true : 'legendonly' }, [index]);
  });
  label.append(checkbox, document.createTextNode(trace.name));
  traceControls.append(label);
});

$('#chart').on('plotly_click', event => {
  const point = event.points?.[0]; if (!point) return;
  if (manifest.runs.some(r => r.id === point.data.meta)) setRun(point.data.meta);
  setTime(point.x);
});
setTime(10);
