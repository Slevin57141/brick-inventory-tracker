// The 3D view (docs/plan.md M12, R24-R27, R29): one storage container (M13) per part category,
// holding one block per 100 pieces in the pieces' colours, placed by the layout maths (M11).
// Every change is animated (D16), and the view draws only while something moves or the user
// turns it, so an idle view costs no CPU or GPU time. Labels are HTML elements written with
// textContent and positioned over the canvas.

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderer,
} from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { CONTAINER } from './container-spec.js';
import { LID_SKIRT, createContainer, disposeSharedResources } from './container-model.js';
import {
  BLOCK_SIZE, computeLayout, easeInOutCubic, frameAt, planTransition,
} from './scene-layout.js';

const PIECES_PER_BLOCK = 100; // D15
const DURATION = 600; // milliseconds, D16
const BACKGROUND = 0xe8e9eb;
// D26: the gap between a container and its open lid on the floor.
const LID_GAP = 0.3;
// How far a lid rises above the rim before it moves back (unit scale). More than the skirt,
// so the skirt clears the rim.
const LID_LIFT = 0.12;
// The D14 brick: a 1 x 1 body with one stud, in the proportions of a real brick, filling
// BLOCK_SIZE exactly.
const STUD = { radius: 0.054, height: 0.03 };
// Below this a container or lid is not drawn; also keeps divisions by the scale finite.
const MIN_SCALE = 1e-4;
// A three-quarter view from slightly above (container-spec.md section 7). Lids open toward +z,
// where M11 keeps room for them, so the camera looks from -z to see them behind their
// containers.
const VIEW_DIRECTION = new Vector3(0.6, 0.62, -1.2).normalize();
const LIGHT_DIRECTION = new Vector3(-2.5, 5, -3).normalize();
const SHADOW_MAP_SIZE = 2048;
const LABEL_GAP = 6; // pixels kept free around each label
const LABEL_ROOM = 40; // pixels left above each container for its label

/** The D14 brick, centred on the origin and exactly BLOCK_SIZE: a body with a stud on top. */
export function createBrickGeometry() {
  const { width, depth, height } = BLOCK_SIZE;
  const body = new BoxGeometry(width, height - STUD.height, depth)
    .translate(0, -STUD.height / 2, 0);
  const stud = new CylinderGeometry(STUD.radius, STUD.radius, STUD.height, 20)
    .translate(0, (height - STUD.height) / 2, 0);
  return merge([body, stud]);
}

// Joins geometries into one, keeping positions and normals, which is all the bricks need.
function merge(geometries) {
  const positions = [];
  const normals = [];
  for (const geometry of geometries) {
    const flat = geometry.toNonIndexed();
    positions.push(...flat.getAttribute('position').array);
    normals.push(...flat.getAttribute('normal').array);
    flat.dispose();
    geometry.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Where a container's lid stands, as the offset of the lid's underside origin from the
 * container's origin in world units, for `progress` from 0 (closed, on the rim) to 1 (open,
 * flat on the floor behind the container, D26). The lid rises, moves back until it is clear
 * of the container, then comes down, so it never passes through the body.
 */
export function lidOffset(scale, progress) {
  const closed = CONTAINER.height * scale;
  const lifted = closed + LID_LIFT * scale;
  const floor = LID_SKIRT * scale;
  const back = (CONTAINER.depth + 2 * CONTAINER.lidOverhang) * scale + LID_GAP;
  // Up, back, down: each leg gets a share of the time in proportion to its length.
  const legs = [lifted - closed, back, lifted - floor];
  let distance = Math.max(0, Math.min(1, progress)) * (legs[0] + legs[1] + legs[2]);
  if (distance <= legs[0]) {
    return { x: 0, y: closed + distance, z: 0 };
  }
  distance -= legs[0];
  if (distance <= legs[1]) {
    return { x: 0, y: lifted, z: distance };
  }
  distance -= legs[1];
  return { x: 0, y: Math.max(floor, lifted - distance), z: back };
}

/**
 * One box per container of a layout, holding it with its lid closed, or with its lid on the
 * way and open on the floor when `lidsOpen`, as `{ min, max }` Vector3s.
 */
export function containerBoxes(layout, { lidsOpen = false } = {}) {
  const { width, depth, height, lidHeight, lidOverhang } = CONTAINER;
  return layout.containers.map(({ position, scale }) => {
    const halfWidth = (width / 2 + lidOverhang) * scale;
    const halfDepth = (depth / 2 + lidOverhang) * scale;
    const lid = lidsOpen ? { z: lidOffset(scale, 1).z, lift: LID_LIFT } : { z: 0, lift: 0 };
    return {
      min: new Vector3(position.x - halfWidth, position.y, position.z - halfDepth),
      max: new Vector3(position.x + halfWidth,
        position.y + (height + lid.lift + lidHeight) * scale, position.z + lid.z + halfDepth),
    };
  });
}

/** The box around all of `containerBoxes`; null for a layout with no containers. */
export function sceneBounds(layout, options) {
  const boxes = containerBoxes(layout, options);
  if (boxes.length === 0) {
    return null;
  }
  const min = boxes[0].min.clone();
  const max = boxes[0].max.clone();
  for (const box of boxes) {
    min.min(box.min);
    max.max(box.max);
  }
  return { min, max };
}

/** The eight corners of a `{ min, max }` box. */
export function boxCorners({ min, max }) {
  const corners = [];
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        corners.push(new Vector3(x, y, z));
      }
    }
  }
  return corners;
}

/**
 * The camera target and distance at which all `points` are in view of a camera with this
 * vertical field of view (degrees) and aspect ratio, looking along -`direction` (a unit
 * vector from the target toward the camera), with the points roughly centred.
 */
export function fitCamera(points, { fov, aspect }, direction) {
  const tanY = Math.tan((fov * Math.PI) / 360);
  const tanX = tanY * aspect;
  const right = new Vector3(0, 1, 0).cross(direction);
  if (right.lengthSq() < 1e-12) {
    right.set(1, 0, 0); // looking straight down
  }
  right.normalize();
  const up = direction.clone().cross(right).normalize();
  const min = points[0].clone();
  const max = points[0].clone();
  for (const point of points) {
    min.min(point);
    max.max(point);
  }
  const center = min.add(max).multiplyScalar(0.5);
  const corners = points.map((point) => {
    const offset = point.clone().sub(center);
    return { x: offset.dot(right), y: offset.dot(up), z: offset.dot(direction) };
  });
  // With the target moved across the view by (shiftX, shiftY), a point at depth z toward the
  // camera is in view when the camera is at least z + |x - shiftX| / tanX away, and likewise
  // for y.
  const distanceFor = (shiftX, shiftY) => corners.reduce((distance, c) => Math.max(distance,
    c.z + Math.abs(c.x - shiftX) / tanX, c.z + Math.abs(c.y - shiftY) / tanY), 0.5);
  // Perspective pulls far points toward the middle, so centring the points as they would
  // look without it leaves them off centre. A few rounds of moving the target by how far
  // they actually land from the middle fix that.
  const middle = (values) => (Math.min(...values) + Math.max(...values)) / 2;
  let shiftX = middle(corners.map((c) => c.x));
  let shiftY = middle(corners.map((c) => c.y));
  for (let round = 0; round < 4; round += 1) {
    const distance = distanceFor(shiftX, shiftY);
    const seen = corners.map((c) => ({ x: (c.x - shiftX) / ((distance - c.z) * tanX),
      y: (c.y - shiftY) / ((distance - c.z) * tanY) }));
    shiftX += middle(seen.map((p) => p.x)) * distance * tanX;
    shiftY += middle(seen.map((p) => p.y)) * distance * tanY;
  }
  const target = center.addScaledVector(right, shiftX).addScaledVector(up, shiftY);
  return { target, distance: distanceFor(shiftX, shiftY) * 1.06 };
}

/**
 * Draws the inventory in `element`. Returns null, leaving the element untouched, when the
 * browser has no WebGL (R29). `reducedMotion` defaults to the system's "reduce motion"
 * setting, followed as it changes.
 */
export function createBrickScene(element, { reducedMotion } = {}) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true });
  } catch {
    return null;
  }
  const motionQuery = reducedMotion === undefined
    ? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
    : null;
  const instant = () => reducedMotion ?? motionQuery?.matches ?? false;

  // The page's styles.css gives these their looks; the positioning lives here, so the view
  // works on any page.
  const root = document.createElement('div');
  root.className = 'brick-scene';
  Object.assign(root.style, { position: 'relative', width: '100%', height: '100%',
    overflow: 'hidden' });
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label',
    'Storage containers, one per part category, holding blocks in the colours of the parts');
  const labels = document.createElement('div');
  labels.className = 'brick-scene-labels';
  Object.assign(labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  const legend = document.createElement('p');
  legend.className = 'brick-scene-legend';
  legend.textContent = `1 block = ${PIECES_PER_BLOCK} pieces`;
  legend.style.position = 'absolute';
  const empty = document.createElement('p');
  empty.className = 'brick-scene-empty';
  empty.textContent = 'No bricks to show.';
  empty.style.position = 'absolute';
  empty.hidden = true;
  root.append(canvas, labels, legend, empty);
  element.append(root);

  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  pmrem.dispose();

  const light = new DirectionalLight(0xffffff, 1.4);
  light.castShadow = true;
  light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  light.shadow.bias = -0.0005;
  scene.add(light, light.target);

  const floor = new Mesh(new PlaneGeometry(400, 400), new ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const camera = new PerspectiveCamera(32, 1, 0.05, 500);
  camera.position.copy(VIEW_DIRECTION).multiplyScalar(6);
  const controls = new OrbitControls(camera, canvas);
  controls.minDistance = 0.5;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI * 0.49; // stay above the floor
  controls.update();
  controls.addEventListener('change', requestFrame);
  // Turning the view takes over from a re-framing still under way.
  controls.addEventListener('start', () => {
    cameraMove = null;
  });

  const brickGeometry = createBrickGeometry();
  // Hashed alpha keeps see-through bricks in the opaque pass, so they show through the
  // frosted walls like the others. Plain blending would draw them after the walls, which
  // write depth and would hide them.
  const blocks = {
    solid: { material: new MeshStandardMaterial({ roughness: 0.3, metalness: 0 }),
      mesh: null, capacity: 0 },
    clear: { material: new MeshStandardMaterial({ roughness: 0.08, metalness: 0,
      opacity: 0.5, alphaHash: true }), mesh: null, capacity: 0 },
  };
  const colors = new Map();
  const containers = new Map(); // categoryId -> { container, label, name, count, item }

  const empties = { piecesPerBlock: PIECES_PER_BLOCK, containers: [], blocks: [] };
  let shown = empties; // the layout on screen once all motion ends
  let current = empties; // what is on screen now; a frame while a transition runs
  let transition = null;
  let lids = { from: 0, to: 0, start: 0, value: 0 };
  let cameraMove = null;
  let frameRequest = 0;
  let disposed = false;

  function requestFrame() {
    if (!disposed && frameRequest === 0) {
      frameRequest = requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    frameRequest = 0;
    const jump = instant();
    let moving = false;
    if (transition !== null) {
      const t = jump ? 1 : (now - transition.start) / DURATION;
      if (t >= 1) {
        current = shown;
        transition = null;
      } else {
        current = frameAt(transition.plan, t);
        moving = true;
      }
      applyContainers(current);
      applyBlocks(current);
    }
    if (lids.value !== lids.to) {
      const t = jump ? 1 : (now - lids.start) / DURATION;
      lids.value = t >= 1 ? lids.to : lids.from + (lids.to - lids.from) * easeInOutCubic(t);
      moving ||= t < 1;
    }
    applyLids();
    if (cameraMove !== null) {
      const t = jump ? 1 : (now - cameraMove.start) / DURATION;
      const eased = easeInOutCubic(t);
      const target = cameraMove.from.target.clone().lerp(cameraMove.to.target, eased);
      const distance = cameraMove.from.distance
        + (cameraMove.to.distance - cameraMove.from.distance) * eased;
      placeCamera(target, distance, cameraMove.direction);
      if (t >= 1) {
        cameraMove = null;
      } else {
        moving = true;
      }
    }
    renderer.render(scene, camera);
    placeLabels();
    if (moving) {
      requestFrame();
    }
  }

  function applyContainers(frame) {
    const present = new Set();
    for (const item of frame.containers) {
      present.add(item.categoryId);
      let entry = containers.get(item.categoryId);
      if (entry === undefined) {
        entry = addContainer(item.categoryId);
      }
      entry.item = item;
      const { group } = entry.container;
      group.visible = item.scale > MIN_SCALE;
      group.position.set(item.position.x, item.position.y, item.position.z);
      group.scale.setScalar(Math.max(item.scale, MIN_SCALE));
      const count = `${item.pieces.toLocaleString('en')} ${item.pieces === 1 ? 'piece' : 'pieces'}`;
      if (entry.name.textContent !== item.categoryName || entry.count.textContent !== count) {
        entry.name.textContent = item.categoryName;
        entry.count.textContent = count;
        entry.size = null;
      }
    }
    for (const [categoryId, entry] of containers) {
      if (!present.has(categoryId)) {
        scene.remove(entry.container.group);
        entry.label.remove();
        containers.delete(categoryId);
      }
    }
  }

  function addContainer(categoryId) {
    const container = createContainer();
    container.group.traverse((object) => {
      object.castShadow = true;
    });
    scene.add(container.group);
    const label = document.createElement('div');
    label.className = 'brick-scene-label';
    Object.assign(label.style, { position: 'absolute', left: '0', top: '0' });
    const name = document.createElement('span');
    name.className = 'brick-scene-label-name';
    const count = document.createElement('span');
    count.className = 'brick-scene-label-count';
    label.append(name, count);
    labels.append(label);
    const entry = { container, label, name, count, item: null, size: null };
    containers.set(categoryId, entry);
    return entry;
  }

  function applyLids() {
    for (const { container, item } of containers.values()) {
      // The lid is a child of the scaled group, so the world offset is divided by the scale.
      const scale = Math.max(item.scale, MIN_SCALE);
      const offset = lidOffset(item.scale, lids.value);
      container.lid.position.set(offset.x / scale, offset.y / scale, offset.z / scale);
    }
  }

  const matrix = new Matrix4();
  const place = new Vector3();
  const size = new Vector3();
  const turn = new Quaternion();

  function applyBlocks(frame) {
    const lists = { solid: [], clear: [] };
    for (const block of frame.blocks) {
      lists[block.colorIsTrans ? 'clear' : 'solid'].push(block);
    }
    for (const [kind, list] of Object.entries(lists)) {
      const mesh = blockMesh(kind, list.length);
      list.forEach((block, index) => {
        place.set(block.position.x, block.position.y, block.position.z);
        size.setScalar(block.scale ?? 1); // only transition frames give blocks a scale
        mesh.setMatrixAt(index, matrix.compose(place, turn, size));
        mesh.setColorAt(index, colorOf(block.colorRgb));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  // One instanced mesh per kind, replaced by a bigger one when the blocks outgrow it.
  function blockMesh(kind, count) {
    const slot = blocks[kind];
    if (slot.mesh === null || slot.capacity < count) {
      if (slot.mesh !== null) {
        scene.remove(slot.mesh);
        slot.mesh.dispose();
      }
      slot.capacity = Math.max(64, 2 ** Math.ceil(Math.log2(count)));
      slot.mesh = new InstancedMesh(brickGeometry, slot.material, slot.capacity);
      // The bounds would have to be recomputed on every frame of a transition.
      slot.mesh.frustumCulled = false;
      scene.add(slot.mesh);
    }
    slot.mesh.count = count;
    return slot.mesh;
  }

  function colorOf(rgb) {
    let color = colors.get(rgb);
    if (color === undefined) {
      color = /^[0-9A-Fa-f]{6}$/.test(rgb) ? new Color(`#${rgb}`) : new Color(0x888888);
      colors.set(rgb, color);
    }
    return color;
  }

  const center = new Vector3();

  // Each label sits just above its container. Nearer labels go first, and a label that would
  // cover one already placed, or a container nearer than its own, is hidden until the view
  // is zoomed or turned. A large inventory stays readable, and no label seems to belong to
  // the wrong container. Above rather than under: from above, the floor in front of a
  // container is behind the nearer row, so a label there would always cover it.
  function placeLabels() {
    const width = root.clientWidth;
    const height = root.clientHeight;
    const candidates = [];
    for (const entry of containers.values()) {
      const { container, item, label } = entry;
      center.set(item.position.x, item.position.y, item.position.z).project(camera);
      if (!container.group.visible || center.z > 1) {
        label.style.visibility = 'hidden';
        continue;
      }
      // Measured once per text change; the transform below does not change the size.
      entry.size ??= { width: label.offsetWidth, height: label.offsetHeight };
      candidates.push({ entry, body: screenRect(item, width, height), depth: center.z });
    }
    candidates.sort((a, b) => a.depth - b.depth);
    const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top
      || b.bottom <= a.top;
    const placed = [];
    for (const { entry, body, depth } of candidates) {
      const { item, label, size } = entry;
      const x = (body.left + body.right) / 2;
      const box = { left: x - size.width / 2 - LABEL_GAP, right: x + size.width / 2 + LABEL_GAP,
        top: body.top - size.height - LABEL_GAP, bottom: body.top };
      const free = placed.every((other) => apart(box, other))
        && candidates.every((other) => other.depth >= depth || apart(box, other.body));
      label.style.visibility = free ? 'visible' : 'hidden';
      if (!free) {
        continue;
      }
      placed.push(box);
      label.style.transform = `translate(${x.toFixed(1)}px, ${body.top.toFixed(1)}px) `
        + 'translate(-50%, calc(-100% - 0.2rem))';
      // The label of an entering or leaving container fades with it.
      const full = transition?.fades.get(item.categoryId);
      label.style.opacity = full === undefined ? '1' : String(Math.min(1, item.scale / full));
    }
  }

  const corner = new Vector3();

  // The screen rectangle around a container with its lid closed, in pixels.
  function screenRect({ position, scale }, width, height) {
    const rect = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    const halfWidth = (CONTAINER.width / 2) * scale;
    const halfDepth = (CONTAINER.depth / 2) * scale;
    const top = (CONTAINER.height + CONTAINER.lidHeight) * scale;
    for (const [sx, sz, level] of [[-1, -1, 0], [-1, 1, 0], [1, -1, 0], [1, 1, 0],
      [-1, -1, top], [-1, 1, top], [1, -1, top], [1, 1, top]]) {
      corner.set(position.x + sx * halfWidth, position.y + level, position.z + sz * halfDepth)
        .project(camera);
      const screenX = ((corner.x + 1) / 2) * width;
      const screenY = ((1 - corner.y) / 2) * height;
      rect.left = Math.min(rect.left, screenX);
      rect.right = Math.max(rect.right, screenX);
      rect.top = Math.min(rect.top, screenY);
      rect.bottom = Math.max(rect.bottom, screenY);
    }
    return rect;
  }

  function placeCamera(target, distance, direction) {
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(direction, distance);
    controls.update();
  }

  // Frames the layout's containers, and their open lids when the lids are open, keeping the
  // direction the user has turned the view to.
  function aimCamera(layout, animate) {
    const boxes = containerBoxes(layout, { lidsOpen: lids.to === 1 });
    if (boxes.length === 0) {
      cameraMove = null;
      return;
    }
    const pointsWithRoom = (room) => boxes.flatMap(({ min, max }) =>
      boxCorners({ min, max: new Vector3(max.x, max.y + room, max.z) }));
    const offset = camera.position.clone().sub(controls.target);
    const direction = offset.lengthSq() > 0 ? offset.normalize() : VIEW_DIRECTION.clone();
    // Room above each container for its label: LABEL_ROOM pixels at the distance of a first
    // fit without it.
    const first = fitCamera(pointsWithRoom(0), camera, direction);
    const perPixel = (2 * first.distance * Math.tan((camera.fov * Math.PI) / 360))
      / Math.max(root.clientHeight, 1);
    const goal = fitCamera(pointsWithRoom(LABEL_ROOM * perPixel), camera, direction);
    controls.maxDistance = Math.max(40, goal.distance * 3);
    if (!animate) {
      cameraMove = null;
      placeCamera(goal.target, goal.distance, direction);
      return;
    }
    const distance = camera.position.distanceTo(controls.target);
    cameraMove = {
      from: { target: controls.target.clone(), distance },
      to: goal,
      direction,
      start: performance.now(),
    };
  }

  // The key light's shadow covers both the old and the new layout, lids open or not.
  function fitShadow(...layouts) {
    const boxes = layouts.map((layout) => sceneBounds(layout, { lidsOpen: true }))
      .filter((bounds) => bounds !== null);
    if (boxes.length === 0) {
      return;
    }
    const min = boxes[0].min.clone();
    const max = boxes[0].max.clone();
    for (const box of boxes) {
      min.min(box.min);
      max.max(box.max);
    }
    const center = min.clone().add(max).multiplyScalar(0.5);
    const radius = Math.max(min.distanceTo(max) / 2, 1);
    light.target.position.copy(center);
    light.position.copy(center).addScaledVector(LIGHT_DIRECTION, radius * 2);
    Object.assign(light.shadow.camera, { left: -radius, right: radius, top: radius,
      bottom: -radius, near: 0.1, far: radius * 4 });
    light.shadow.camera.updateProjectionMatrix();
  }

  const resizer = new ResizeObserver(() => {
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    aimCamera(shown, false);
    requestFrame();
  });
  resizer.observe(root);

  function finishMotion() {
    if (instant()) {
      requestFrame();
    }
  }
  motionQuery?.addEventListener('change', finishMotion);

  return {
    update(rows) {
      if (disposed) {
        return;
      }
      const next = computeLayout(rows, { piecesPerBlock: PIECES_PER_BLOCK });
      const first = shown.containers.length === 0;
      const plan = planTransition(current, next);
      // Containers that enter or leave, with the scale at which their label is fully shown.
      const fades = new Map();
      for (const { from, to } of plan.containers) {
        if (from.scale === 0 || to.scale === 0) {
          fades.set(to.categoryId, Math.max(from.scale, to.scale));
        }
      }
      transition = { plan, fades, start: performance.now() };
      fitShadow(current, next);
      shown = next;
      empty.hidden = next.containers.length > 0;
      // The first containers are framed at once; later changes move the camera with them.
      aimCamera(next, !first && !instant());
      requestFrame();
    },
    setLidsOpen(open) {
      if (disposed) {
        return;
      }
      const to = open ? 1 : 0;
      if (lids.to !== to) {
        lids = { from: lids.value, to, start: performance.now(), value: lids.value };
        aimCamera(shown, !instant());
        requestFrame();
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      cancelAnimationFrame(frameRequest);
      resizer.disconnect();
      motionQuery?.removeEventListener('change', finishMotion);
      controls.dispose();
      for (const slot of Object.values(blocks)) {
        slot.mesh?.dispose();
        slot.material.dispose();
      }
      brickGeometry.dispose();
      disposeSharedResources();
      floor.geometry.dispose();
      floor.material.dispose();
      light.dispose();
      environment.dispose();
      renderer.dispose();
      root.remove();
    },
  };
}
