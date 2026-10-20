import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLYPHS, minSdf, type PlacedMark } from "./glyphs";
import { STEP } from "./motion";

const R = 1.16;
const TOP = 1.0;
const SPAN = 1.34;
const FIELD = 960;

const METAL = new THREE.Color("#6e767c");
const PAINT = new THREE.Color("#f3f1eb");
const BODY = new THREE.Color("#17191b");

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function hash(ix: number, iy: number): number {
  let n = (ix * 374761393 + iy * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function buildMarks(): PlacedMark[] {
  const marks: PlacedMark[] = [];
  const single = ["M", "A", "S", "P"] as const;
  single.forEach((name, i) => {
    marks.push({
      glyph: GLYPHS[name],
      angle: i * STEP,
      radius: 0.72,
      scale: 0.3,
      slide: 0,
    });
  });
  const word = ["A", "U", "T", "O"] as const;
  const slides = [-0.3, -0.1, 0.1, 0.3];
  word.forEach((name, i) => {
    marks.push({
      glyph: GLYPHS[name],
      angle: 4 * STEP,
      radius: 0.7,
      scale: 0.175,
      slide: slides[i],
    });
  });
  return marks;
}

export function redDotLocal(): THREE.Vector3 {
  const angle = 4 * STEP;
  const radius = 0.7;
  const slide = 0.52;
  return new THREE.Vector3(
    Math.sin(angle) * radius + Math.cos(angle) * slide,
    TOP - 0.006,
    -Math.cos(angle) * radius + Math.sin(angle) * slide,
  );
}

interface Field {
  sdf: Float32Array;
  n: number;
  span: number;
}

function buildField(marks: PlacedMark[]): Field {
  const n = FIELD;
  const sdf = new Float32Array(n * n);
  const span = SPAN;
  for (let j = 0; j < n; j++) {
    const z = ((j + 0.5) / n - 0.5) * span * 2;
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n - 0.5) * span * 2;
      sdf[j * n + i] = minSdf(marks, x, z);
    }
  }
  return { sdf, n, span };
}

function sampleField(field: Field, x: number, z: number): number {
  const u = (x / (field.span * 2) + 0.5) * field.n - 0.5;
  const v = (z / (field.span * 2) + 0.5) * field.n - 0.5;
  const x0 = Math.max(0, Math.min(field.n - 1, Math.floor(u)));
  const y0 = Math.max(0, Math.min(field.n - 1, Math.floor(v)));
  const x1 = Math.min(field.n - 1, x0 + 1);
  const y1 = Math.min(field.n - 1, y0 + 1);
  const tx = u - x0;
  const ty = v - y0;
  const i = (ix: number, iy: number) => field.sdf[iy * field.n + ix];
  return (
    i(x0, y0) * (1 - tx) * (1 - ty) +
    i(x1, y0) * tx * (1 - ty) +
    i(x0, y1) * (1 - tx) * ty +
    i(x1, y1) * tx * ty
  );
}

function scratchHeight(r: number, a: number): number {
  const wobble = 0.62 + 0.38 * Math.sin(a * 5 + r * 28);
  const grain = 0.78 + 0.22 * Math.sin(a * 13 + Math.sin(r * 70) * 2.2);
  const s1 = Math.sin(r * 86 * Math.PI * 2);
  const s2 = Math.sin(r * 190 * Math.PI * 2 + a * 0.4);
  const s3 = Math.sin(r * 410 * Math.PI * 2);
  return (s1 * 0.55 + s2 * 0.32 + s3 * 0.16) * wobble * grain;
}

function engraveDisp(sdf: number): number {
  return -0.055 * smoothstep(0.006, -0.012, sdf);
}

interface Maps {
  color: THREE.DataTexture;
  rough: THREE.DataTexture;
  metal: THREE.DataTexture;
  ao: THREE.DataTexture;
  normal: THREE.DataTexture;
  aniso: THREE.DataTexture;
}

function dataTex(data: Uint8Array, n: number, srgb: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.flipY = false;
  return tex;
}

function buildMaps(field: Field): Maps {
  const n = field.n;
  const color = new Uint8Array(n * n * 4);
  const rough = new Uint8Array(n * n * 4);
  const metal = new Uint8Array(n * n * 4);
  const ao = new Uint8Array(n * n * 4);
  const normal = new Uint8Array(n * n * 4);
  const aniso = new Uint8Array(n * n * 4);
  const world = (i: number) => ((i + 0.5) / n - 0.5) * field.span * 2;
  const heights = new Float32Array(n * n);

  for (let j = 0; j < n; j++) {
    const z = world(j);
    for (let i = 0; i < n; i++) {
      const x = world(i);
      const r = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      const sdf = field.sdf[j * n + i];
      const depth = smoothstep(0.01, -0.012, sdf);
      let paint = smoothstep(0.62, 0.92, depth);
      if (depth > 0.28 && depth < 0.75 && hash(i, j) > 0.84) paint *= 0.2;

      const metalColor = METAL.clone();
      const scratch = scratchHeight(r, a);
      metalColor.offsetHSL(0, 0, scratch * 0.012);
      const albedo = metalColor.clone().lerp(PAINT, paint);
      const p = (j * n + i) * 4;
      color[p] = Math.round(albedo.r * 255);
      color[p + 1] = Math.round(albedo.g * 255);
      color[p + 2] = Math.round(albedo.b * 255);
      color[p + 3] = 255;

      const brushRough = 0.4 + (scratch * 0.5 + 0.5) * 0.06;
      const rg = brushRough * (1 - paint) + 0.5 * paint;
      const rv = Math.round(Math.max(0, Math.min(1, rg)) * 255);
      rough[p] = rough[p + 1] = rough[p + 2] = rv;
      rough[p + 3] = 255;

      const mv = Math.round((1 - paint) * 210);
      metal[p] = metal[p + 1] = metal[p + 2] = mv;
      metal[p + 3] = 255;

      const inside = smoothstep(0.004, -0.01, sdf);
      const aoV = Math.round((1 - inside * 0.35) * 255);
      ao[p] = ao[p + 1] = ao[p + 2] = aoV;
      ao[p + 3] = 255;

      heights[j * n + i] = scratch * 0.0011;

      const tx = -z;
      const tz = x;
      const len = Math.hypot(tx, tz) || 1;
      const dx = tx / len;
      const dy = tz / len;
      const strength = (1 - paint * 0.85) * 0.72;
      aniso[p] = Math.round((dx * 0.5 + 0.5) * 255);
      aniso[p + 1] = Math.round((dy * 0.5 + 0.5) * 255);
      aniso[p + 2] = Math.round(strength * 255);
      aniso[p + 3] = 255;
    }
  }

  const texel = (field.span * 2) / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const hL = heights[j * n + Math.max(0, i - 1)];
      const hR = heights[j * n + Math.min(n - 1, i + 1)];
      const hD = heights[Math.max(0, j - 1) * n + i];
      const hU = heights[Math.min(n - 1, j + 1) * n + i];
      const nx = -(hR - hL) / (2 * texel);
      const ny = -(hU - hD) / (2 * texel);
      const nz = 1.15;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const p = (j * n + i) * 4;
      normal[p] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      normal[p + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      normal[p + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      normal[p + 3] = 255;
    }
  }

  return {
    color: dataTex(color, n, true),
    rough: dataTex(rough, n, false),
    metal: dataTex(metal, n, false),
    ao: dataTex(ao, n, false),
    normal: dataTex(normal, n, false),
    aniso: dataTex(aniso, n, false),
  };
}

function buildTop(field: Field): THREE.BufferGeometry {
  const rings = 168;
  const segs = 520;
  const outer = 1.05;
  const positions: number[] = [0, TOP, 0];
  const uvs: number[] = [0.5, 0.5];
  const indices: number[] = [];

  for (let j = 1; j <= rings; j++) {
    const r = outer * (j / rings);
    const band = smoothstep(0.42, 0.55, r) * (1 - smoothstep(0.98, 1.04, r));
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      const sdf = sampleField(field, x, z);
      const y = TOP + engraveDisp(sdf) * (0.35 + 0.65 * band);
      positions.push(x, y, z);
      uvs.push(x / (SPAN * 2) + 0.5, z / (SPAN * 2) + 0.5);
    }
  }

  for (let i = 0; i < segs; i++) {
    const i2 = (i + 1) % segs;
    indices.push(0, 1 + i2, 1 + i);
  }
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < segs; i++) {
      const i2 = (i + 1) % segs;
      const a = 1 + j * segs + i;
      const b = 1 + j * segs + i2;
      const c = 1 + (j + 1) * segs + i;
      const d = 1 + (j + 1) * segs + i2;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("uv2", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const count = geo.attributes.position.count;
  const tangents = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    tangents[i * 4] = 1;
    tangents[i * 4 + 3] = 1;
  }
  geo.setAttribute("tangent", new THREE.BufferAttribute(tangents, 4));
  return geo;
}

function buildKnurl(): THREE.BufferGeometry {
  const teeth = 108;
  const samples = 6;
  const y0 = 0.18;
  const y1 = 0.76;
  const pitch = (Math.PI * 2 * R) / teeth;
  const seg = teeth * samples;
  const rows = Math.max(8, Math.round(((y1 - y0) / pitch) * samples));
  const positions: number[] = [];
  const indices: number[] = [];

  const radiusAt = (theta: number, y: number) => {
    const u = (theta / (Math.PI * 2)) * teeth;
    const v = (y - y0) / pitch;
    const wrap = (t: number) => t - Math.floor(t);
    const d1 = Math.abs(wrap(u + v) - 0.5);
    const d2 = Math.abs(wrap(u - v) - 0.5);
    const groove = Math.min(d1, d2);
    const lift = smoothstep(0.045, 0.2, groove);
    return R * 0.978 + lift * 0.034;
  };

  for (let j = 0; j <= rows; j++) {
    const y = y0 + ((y1 - y0) * j) / rows;
    for (let i = 0; i < seg; i++) {
      const theta = (i / seg) * Math.PI * 2;
      const rad = radiusAt(theta, y);
      positions.push(Math.sin(theta) * rad, y, -Math.cos(theta) * rad);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < seg; i++) {
      const i2 = (i + 1) % seg;
      const a = j * seg + i;
      const b = j * seg + i2;
      const c = (j + 1) * seg + i;
      const d = (j + 1) * seg + i2;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function lathe(pts: THREE.Vector2[], segs = 160): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(pts, segs);
  geo.computeVertexNormals();
  return geo;
}

function brushedMetal(maps: Maps): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: maps.color,
    roughnessMap: maps.rough,
    metalnessMap: maps.metal,
    aoMap: maps.ao,
    aoMapIntensity: 1,
    normalMap: maps.normal,
    normalScale: new THREE.Vector2(0.42, 0.42),
    anisotropyMap: maps.aniso,
    anisotropy: 1,
    anisotropyRotation: 0,
    metalness: 1,
    roughness: 0.4,
    envMapIntensity: 1.15,
    clearcoat: 0.08,
    clearcoatRoughness: 0.4,
  });
}

function solidMetal(color: string, roughness: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 1,
    roughness,
    envMapIntensity: 1.05,
  });
}

function studioEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const w = 512;
  const h = 256;
  const data = new Float32Array(w * h * 4);
  const key = new THREE.Vector3(-0.48, 0.78, 0.4).normalize();
  const rim = new THREE.Vector3(0.82, 0.28, -0.5).normalize();
  const fill = new THREE.Vector3(0.35, 0.45, 0.82).normalize();
  for (let j = 0; j < h; j++) {
    const v = (j + 0.5) / h;
    const theta = v * Math.PI;
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5) / w;
      const phi = (u - 0.5) * Math.PI * 2;
      const dir = new THREE.Vector3(
        Math.sin(theta) * Math.sin(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.cos(phi),
      );
      let e = 0.025 + Math.max(0, dir.y) * 0.03;
      const dk = dir.dot(key);
      const dr = dir.dot(rim);
      const df = dir.dot(fill);
      if (dk > 0.68) e += ((dk - 0.68) / 0.32) ** 2 * 3.6;
      if (dr > 0.88) e += ((dr - 0.88) / 0.12) ** 2 * 6;
      if (df > 0.84) e += ((df - 0.84) / 0.16) ** 2 * 0.7;
      if (dir.y < -0.15) e += 0.09;
      const p = (j * w + i) * 4;
      data[p] = e * 1.02;
      data[p + 1] = e * 0.99;
      data[p + 2] = e * 0.96;
      data[p + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose();
  pmrem.dispose();
  return env;
}

function contactShadow(): THREE.Mesh {
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const y = (j / (n - 1)) * 2 - 1;
      const r = Math.hypot(x, y);
      const a = smoothstep(1, 0.72, r) * 0.55;
      const p = (j * n + i) * 4;
      data[p] = data[p + 1] = data[p + 2] = 0;
      data[p + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3.1, 3.1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.004;
  return mesh;
}

export type ViewName = "hero" | "top" | "knurl" | "og";

const VIEWS: Record<ViewName, { pos: [number, number, number]; target: [number, number, number] }> = {
  hero: { pos: [0.1, 3.15, 3.2], target: [0, 0.55, -0.55] },
  top: { pos: [0.04, 4.15, 0.72], target: [0, 0.2, -0.2] },
  knurl: { pos: [1.85, 1.05, 2.05], target: [0.05, 0.52, 0.05] },
  og: { pos: [0.28, 2.15, 2.55], target: [0.05, 0.62, -0.02] },
};

export interface DialRig {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dial: THREE.Group;
  key: THREE.RectAreaLight;
  focusPoint: THREE.Vector3;
  setView: (name: ViewName) => void;
}

export function createRig(renderer: THREE.WebGLRenderer): DialRig {
  RectAreaLightUniformsLib.init();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#121416");
  scene.environment = studioEnv(renderer);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 40);
  const focusPoint = new THREE.Vector3(0, 0.62, -0.02);

  const marks = buildMarks();
  const field = buildField(marks);
  const maps = buildMaps(field);

  const dial = new THREE.Group();
  const top = new THREE.Mesh(buildTop(field), brushedMetal(maps));
  const knurl = new THREE.Mesh(buildKnurl(), solidMetal("#5a6166", 0.46));
  const valley = new THREE.Mesh(
    lathe([
      new THREE.Vector2(R * 0.9, 0.06),
      new THREE.Vector2(R * 0.955, 0.14),
      new THREE.Vector2(R * 0.955, 0.78),
      new THREE.Vector2(R * 0.88, 0.88),
    ]),
    solidMetal("#2a2e31", 0.62),
  );
  const lip = new THREE.Mesh(
    lathe([
      new THREE.Vector2(R * 0.96, 0.7),
      new THREE.Vector2(R + 0.02, 0.8),
      new THREE.Vector2(0.98, 0.92),
      new THREE.Vector2(1.05, TOP),
    ]),
    solidMetal("#3c4246", 0.52),
  );
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 28, 18),
    new THREE.MeshPhysicalMaterial({
      color: "#c41818",
      metalness: 0,
      roughness: 0.36,
      clearcoat: 0.15,
      clearcoatRoughness: 0.4,
    }),
  );
  dot.position.copy(redDotLocal());
  dot.scale.set(1, 0.42, 1);
  dial.add(valley, lip, knurl, top, dot);
  scene.add(dial);

  const body = new THREE.Mesh(
    new RoundedBoxGeometry(18, 0.62, 12, 4, 0.08),
    new THREE.MeshPhysicalMaterial({
      color: BODY,
      metalness: 0.02,
      roughness: 0.9,
      envMapIntensity: 0.25,
    }),
  );
  body.position.y = -0.31;
  scene.add(body);
  scene.add(contactShadow());

  const hump = new THREE.Mesh(
    new RoundedBoxGeometry(0.34, 1.15, 0.7, 3, 0.04),
    new THREE.MeshPhysicalMaterial({ color: "#141618", metalness: 0.04, roughness: 0.88 }),
  );
  hump.position.set(0, 0.62, -1.72);
  const tick = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.014, 0.16),
    new THREE.MeshPhysicalMaterial({ color: "#f7f4ee", metalness: 0, roughness: 0.38 }),
  );
  tick.position.set(0, 1.02, -1.32);
  scene.add(hump, tick);

  const shutter = new THREE.Group();
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.42, 0.16, 40),
    solidMetal("#aeb4b8", 0.32),
  );
  cup.position.y = 0.08;
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.32, 0.07, 36),
    solidMetal("#d5d8db", 0.22),
  );
  cap.position.y = 0.18;
  shutter.add(cup, cap);
  shutter.position.set(1.55, 0, 1.35);
  scene.add(shutter);

  const shoe = new THREE.Group();
  const shoeBase = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.06, 0.7),
    solidMetal("#8d9398", 0.38),
  );
  shoeBase.position.y = 0.03;
  const railL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.7), solidMetal("#c5c9cc", 0.28));
  const railR = railL.clone();
  railL.position.set(-0.42, 0.1, 0);
  railR.position.set(0.42, 0.1, 0);
  shoe.add(shoeBase, railL, railR);
  shoe.position.set(-0.15, 0, -2.05);
  scene.add(shoe);

  const key = new THREE.RectAreaLight("#fff3e8", 48, 2.4, 1.7);
  const rim = new THREE.RectAreaLight("#e4ecf6", 55, 0.22, 2.4);
  const fill = new THREE.RectAreaLight("#c5ced6", 6, 1.8, 1.2);
  key.position.set(-1.35, 3.15, 1.15);
  rim.position.set(2.6, 1.7, -1.3);
  fill.position.set(1.4, 2.4, 2.6);
  scene.add(key, rim, fill);

  const setView = (name: ViewName) => {
    const view = VIEWS[name];
    camera.position.set(...view.pos);
    focusPoint.set(...view.target);
    camera.lookAt(focusPoint);
    camera.updateMatrixWorld();
  };
  setView("hero");

  const aim = () => {
    key.lookAt(0, 0.7, 0);
    rim.lookAt(0, 0.55, 0);
    fill.lookAt(0, 0.4, 0);
  };
  aim();

  return { scene, camera, dial, key, focusPoint, setView };
}
