import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { createRig, type ViewName } from "./dial";
import { demoAngle, demoClicks, DialSim, MODE_NAMES, modeIndex } from "./motion";
import { demoWavBase64, playClick, unlockAudio } from "./audio";

const params = new URLSearchParams(location.search);
const capture = params.get("capture") === "1";
const og = params.get("og") === "1";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
const modeEl = document.querySelector<HTMLElement>("#mode");
const hintEl = document.querySelector<HTMLElement>("#hint");
if (!canvas || !modeEl || !hintEl) throw new Error("missing markup");

document.body.classList.toggle("capture", capture);
document.body.classList.toggle("og", og);
if (capture || og) hintEl.hidden = true;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor("#121416", 1);

const rig = createRig(renderer);
const sim = new DialSim();
let playing = false;
let demoTime = 0;
let shown = "";
let frames = 0;
let fpsStamp = performance.now();
let fps = 0;

const composer = new EffectComposer(renderer);
composer.renderTarget1.samples = 4;
composer.renderTarget2.samples = 4;
composer.addPass(new RenderPass(rig.scene, rig.camera));
const bokeh = new BokehPass(rig.scene, rig.camera, {
  focus: 4,
  aperture: 0.0075,
  maxblur: 0.008,
});
bokeh.materialBokeh.toneMapped = false;
composer.addPass(bokeh);
composer.addPass(new OutputPass());

const dither = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) / 255.0;
      gl_FragColor = c;
    }
  `,
});
dither.material.toneMapped = false;
composer.addPass(dither);

function resize() {
  const dpr = capture || og ? 1 : Math.min(window.devicePixelRatio || 1, 1.25);
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  rig.camera.aspect = w / Math.max(1, h);
  rig.camera.updateProjectionMatrix();
  bokeh.uniforms["aspect"].value = rig.camera.aspect;
}

function focusDistance(): number {
  const view = rig.focusPoint.clone().applyMatrix4(rig.camera.matrixWorldInverse);
  return -view.z;
}

function renderFrame() {
  bokeh.uniforms["focus"].value = focusDistance();
  bokeh.uniforms["nearClip"].value = rig.camera.near;
  bokeh.uniforms["farClip"].value = rig.camera.far;
  rig.key.lookAt(0, 0.7, 0);
  composer.render();
}

function setLabel(name: string, fade: boolean) {
  if (name === shown) return;
  shown = name;
  if (!fade || capture) {
    modeEl.textContent = name;
    modeEl.classList.remove("hide");
    return;
  }
  modeEl.classList.add("hide");
  window.setTimeout(() => {
    modeEl.textContent = name;
    modeEl.classList.remove("hide");
  }, 90);
}

function showMode(angle: number, fade: boolean) {
  setLabel(MODE_NAMES[modeIndex(angle)], fade);
}

function phiAt(event: PointerEvent): number | null {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, rig.camera);
  const hit = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.7);
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  return Math.atan2(hit.x, -hit.z);
}

let pointerId: number | null = null;
let lastPhi: number | null = null;
let lastMove = performance.now();

function trackKey(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  rig.key.position.set(-1.35 + x * 1.05, 3.15 + y * 0.28, 1.15 + y * 0.55);
}

canvas.addEventListener("pointerdown", (event) => {
  if (capture) return;
  unlockAudio();
  playing = false;
  const phi = phiAt(event);
  if (phi === null) return;
  pointerId = event.pointerId;
  lastPhi = phi;
  lastMove = performance.now();
  canvas.setPointerCapture(event.pointerId);
  sim.dragging = true;
});

canvas.addEventListener("pointermove", (event) => {
  trackKey(event);
  if (capture || pointerId !== event.pointerId || lastPhi === null) return;
  const phi = phiAt(event);
  if (phi === null) return;
  let dPhi = phi - lastPhi;
  if (dPhi > Math.PI) dPhi -= Math.PI * 2;
  if (dPhi < -Math.PI) dPhi += Math.PI * 2;
  const now = performance.now();
  const dt = Math.max(1 / 240, (now - lastMove) / 1000);
  lastMove = now;
  lastPhi = phi;
  const before = modeIndex(sim.angle);
  sim.drag(dPhi, dt);
  const mode = modeIndex(sim.angle);
  if (mode !== before) playClick(mode === 4);
  showMode(sim.angle, true);
});

canvas.addEventListener("pointerup", (event) => {
  if (pointerId !== event.pointerId) return;
  pointerId = null;
  lastPhi = null;
  sim.release();
});

canvas.addEventListener("pointercancel", () => {
  pointerId = null;
  lastPhi = null;
  sim.release();
});

window.addEventListener(
  "wheel",
  (event) => {
    if (capture) return;
    event.preventDefault();
    unlockAudio();
    playing = false;
    sim.wheel(Math.sign(event.deltaY) || 1);
  },
  { passive: false },
);

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (event.key === "r" || event.key === "R") {
    if (capture) return;
    unlockAudio();
    playing = true;
    demoTime = 0;
    hintEl.hidden = true;
  }
  const views: Record<string, ViewName> = { "1": "hero", "2": "top", "3": "knurl" };
  const view = views[event.key];
  if (view && !capture) rig.setView(view);
});

function applyAngle(angle: number) {
  rig.dial.rotation.y = angle;
}

let last = performance.now();
let lastDemoMode = modeIndex(demoAngle(0));

function tick(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!document.hidden) {
    if (playing) {
      demoTime += dt;
      const angle = demoAngle(demoTime);
      applyAngle(angle);
      const mode = modeIndex(angle);
      if (mode !== lastDemoMode) {
        playClick(mode === 4);
        lastDemoMode = mode;
      }
      showMode(angle, true);
      if (demoTime >= 15) {
        playing = false;
        sim.angle = angle;
        sim.velocity = 0;
        sim.dragging = true;
        sim.release();
      }
    } else {
      const click = sim.step(dt);
      if (click.clicked && !sim.dragging) playClick(click.auto);
      applyAngle(sim.angle);
      showMode(sim.angle, !capture);
    }
    renderFrame();
    frames++;
    if (now - fpsStamp > 1000) {
      fps = (frames * 1000) / (now - fpsStamp);
      frames = 0;
      fpsStamp = now;
    }
  }
  requestAnimationFrame(tick);
}

resize();
window.addEventListener("resize", resize);
if (og) rig.setView("og");
applyAngle(capture ? demoAngle(0) : 0);
showMode(capture ? demoAngle(0) : 0, false);
if (capture) {
  sim.angle = demoAngle(0);
  renderFrame();
} else {
  requestAnimationFrame(tick);
}

interface DialApi {
  seek: (t: number) => void;
  setView: (name: ViewName) => void;
  clickPlan: () => { t: number; auto: boolean }[];
  wav: () => string;
  fps: () => number;
  mode: () => string;
  angle: () => number;
}

const api: DialApi = {
  seek(t: number) {
    playing = false;
    const angle = demoAngle(t);
    sim.angle = angle;
    sim.velocity = 0;
    applyAngle(angle);
    showMode(angle, false);
    renderFrame();
  },
  setView(name: ViewName) {
    rig.setView(name);
    resize();
    renderFrame();
  },
  clickPlan: () => demoClicks(),
  wav: () => demoWavBase64(),
  fps: () => fps,
  mode: () => shown,
  angle: () => sim.angle,
};

(window as unknown as { __dial: DialApi }).__dial = api;
