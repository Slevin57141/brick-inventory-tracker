// The 3D view (docs/plan.md M12, R24-R27, R29): one storage container (M13) per part category,
// holding one block per 100 pieces in the pieces' colours, placed by the layout maths (M11).
// Every change is animated (D16), and the view draws only while something moves or the user
// turns it, so an idle view costs no CPU or GPU time. Each container's label lies on the floor
// in front of it, drawn from text into a texture (D29). A click selects a container and a
// double click moves the camera to it (D28).

import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Path,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Scene,
  ShadowMaterial,
  Shape,
  ShapeGeometry,
  Vector2,
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
// LDraw units per world unit: a 1 x 1 brick is 20 units wide and fills BLOCK_SIZE's width.
const LDRAW_UNIT = BLOCK_SIZE.width / 20;
// Part shapes asked of the server at the same time (D31).
const SHAPE_REQUESTS = 6;
// The space between stacked blocks: M11's layer pitch less a block's height, so plain bricks
// stack exactly where M11 puts them.
const STACK_GAP = 0.02;
// How long arriving shapes are gathered before the blocks settle on them.
const SETTLE_DELAY = 250;
// A three-quarter view from slightly above (container-spec.md section 7). Lids open toward +z,
// where M11 keeps room for them, so the camera looks from -z to see them behind their
// containers.
const VIEW_DIRECTION = new Vector3(0.6, 0.62, -1.2).normalize();
const LIGHT_DIRECTION = new Vector3(-2.5, 5, -3).normalize();
const SHADOW_MAP_SIZE = 2048;
// The label on the floor in front of each container, in world units (D29). It fits in the gap
// that M11 leaves in front of every row, and reaches a little past the container's sides,
// into the gap between neighbours. It sits just above the floor and just below the ring.
const LABEL = { offset: 0.02, depth: 0.26, overhang: 0.12, height: 0.0015 };
const LABEL_PIXELS = 420; // texture pixels per world unit, rounded to steps of 64
const LABEL_FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
// The selected container's highlight: the page's accent red, and a ring on the floor around
// the lid's outline (unit scale).
const SELECTION_COLOR = 0xa63a32;
const SELECTION_LID = 0xd0574b;
const SELECTION_GLOW = 0x5a1510;
const RING = { gap: 0.03, width: 0.035 };
// A press that moves less than this many pixels is a click, not a turn of the view.
const CLICK_SLOP = 5;

/**
 * A part's shape for a block (D31), from its LDraw triangles (LDraw units and axes, nine numbers
 * per triangle): turned the right way up (LDraw's y points down), centred on the origin, and
 * shrunk to fit BLOCK_SIZE if it is bigger, never enlarged, so small parts stay small.
 */
export function createPartGeometry(positions) {
  const points = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    // Half a turn about x: y up, and z flipped with it so the part is not mirrored.
    points[i] = positions[i] * LDRAW_UNIT;
    points[i + 1] = -positions[i + 1] * LDRAW_UNIT;
    points[i + 2] = -positions[i + 2] * LDRAW_UNIT;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const fit = Math.min(1, BLOCK_SIZE.width / Math.max(max.x - min.x, 1e-9),
    BLOCK_SIZE.height / Math.max(max.y - min.y, 1e-9),
    BLOCK_SIZE.depth / Math.max(max.z - min.z, 1e-9));
  geometry.translate(-(min.x + max.x) / 2, -(min.y + max.y) / 2, -(min.z + max.z) / 2);
  geometry.scale(fit, fit, fit);
  // Flat normals from each face; LDraw's winding is not followed, and the materials draw
  // both sides, which turns every normal toward the viewer.
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The layout with every block resting on the one below it in its column (D31), instead of
 * standing in a cell as tall as a brick, so flat parts lie on each other. `heightOf(block)` is
 * the height of the shape the block is drawn with. A column starts on its container's floor,
 * where M11 puts the lowest layer; with every block a plain brick, nothing moves.
 */
export function stackBlocks(layout, heightOf) {
  const floors = new Map();
  const columns = new Map();
  for (const block of layout.blocks) {
    const bottom = block.position.y - BLOCK_SIZE.height / 2;
    floors.set(block.categoryId, Math.min(floors.get(block.categoryId) ?? Infinity, bottom));
    const key = `${block.categoryId}|${block.position.x}|${block.position.z}`;
    if (!columns.has(key)) {
      columns.set(key, []);
    }
    columns.get(key).push(block);
  }
  const heights = new Map();
  for (const column of columns.values()) {
    column.sort((a, b) => a.position.y - b.position.y);
    let y = floors.get(column[0].categoryId);
    for (const block of column) {
      const height = heightOf(block);
      heights.set(block.key, y + height / 2);
      y += height + STACK_GAP;
    }
  }
  return { ...layout, blocks: layout.blocks.map((block) => ({ ...block,
    position: { ...block.position, y: heights.get(block.key) } })) };
}

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
 * Where a container's floor label lies (D29): `{ minX, maxX, minZ, maxZ }` in world units, in
 * front of the container (toward -z, where the camera starts) and a little wider than it.
 */
export function labelBox({ position, scale }) {
  const halfWidth = (CONTAINER.width / 2 + CONTAINER.lidOverhang) * scale + LABEL.overhang;
  const front = position.z - (CONTAINER.depth / 2 + CONTAINER.lidOverhang) * scale - LABEL.offset;
  return { minX: position.x - halfWidth, maxX: position.x + halfWidth,
    minZ: front - LABEL.depth, maxZ: front };
}

/**
 * One box per container of a layout, holding it and its floor label with its lid closed, or
 * with its lid on the way and open on the floor when `lidsOpen`, as `{ min, max }` Vector3s.
 */
export function containerBoxes(layout, { lidsOpen = false } = {}) {
  const { depth, height, lidHeight, lidOverhang } = CONTAINER;
  return layout.containers.map((container) => {
    const { position, scale } = container;
    const halfDepth = (depth / 2 + lidOverhang) * scale;
    const label = labelBox(container);
    const lid = lidsOpen ? { z: lidOffset(scale, 1).z, lift: LID_LIFT } : { z: 0, lift: 0 };
    return {
      min: new Vector3(label.minX, position.y, label.minZ),
      max: new Vector3(label.maxX, position.y + (height + lid.lift + lidHeight) * scale,
        position.z + lid.z + halfDepth),
    };
  });
}

/**
 * The boxes the camera frames: only the focused container's while it is in the layout,
 * otherwise every container's.
 */
export function framingBoxes(layout, { lidsOpen = false, focus = null } = {}) {
  const boxes = containerBoxes(layout, { lidsOpen });
  const index = layout.containers.findIndex((container) => container.categoryId === focus);
  return index === -1 ? boxes : [boxes[index]];
}

/**
 * The flat ring on the floor around a selected container, at unit scale: the lid's chamfered
 * outline grown by RING.gap on the inside and by RING.width more on the outside.
 */
export function createSelectionRingGeometry() {
  const { width, depth, chamfer, lidOverhang } = CONTAINER;
  const outline = (grow) => {
    const x = width / 2 + lidOverhang + grow;
    const z = depth / 2 + lidOverhang + grow;
    const cut = chamfer + grow * (2 - Math.SQRT2);
    return [[x - cut, z], [-x + cut, z], [-x, z - cut], [-x, -z + cut], [-x + cut, -z],
      [x - cut, -z], [x, -z + cut], [x, z - cut]].map(([px, pz]) => new Vector2(px, pz));
  };
  const shape = new Shape(outline(RING.gap + RING.width));
  shape.holes.push(new Path(outline(RING.gap)));
  // The shape is drawn in x and y; lying it down puts its y on -z, which the symmetric
  // outline does not mind, and turns its face up.
  return new ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

/**
 * Draws a floor label into a 2D canvas context: a rounded card with the category name and
 * the piece count, red when its container is selected. Long names shrink, then are cut short.
 */
export function drawLabel(context, { name, count, selected }) {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  context.fillStyle = selected ? '#a63a32' : '#ffffff';
  context.beginPath();
  context.roundRect(0, 0, width, height, height * 0.18);
  context.fill();
  if (!selected) {
    const line = Math.max(2, height * 0.03);
    context.strokeStyle = '#c3c8ce';
    context.lineWidth = line;
    context.beginPath();
    context.roundRect(line / 2, line / 2, width - line, height - line, height * 0.18);
    context.stroke();
  }
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const write = (text, weight, size, y, color) => {
    const room = width * 0.9;
    let px = size;
    context.font = `${weight} ${px}px ${LABEL_FONT}`;
    while (context.measureText(text).width > room && px > size * 0.6) {
      px *= 0.92;
      context.font = `${weight} ${px}px ${LABEL_FONT}`;
    }
    let shown = text;
    while (context.measureText(shown).width > room && shown.length > 4) {
      shown = `${shown.slice(0, -4)}...`;
    }
    context.fillStyle = color;
    context.fillText(shown, width / 2, y);
  };
  write(name, 600, height * 0.34, height * 0.38, selected ? '#ffffff' : '#1f2328');
  write(count, 400, height * 0.24, height * 0.73, selected ? '#f6dcd8' : '#59606a');
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
 * setting, followed as it changes. `onSelectionChange({ selected, focused })` is called when
 * the selected or focused container changes, or the selected one's piece count does:
 * `selected` is `{ categoryId, categoryName, pieces }` or null, `focused` a category ID or
 * null. `loadShape(names)` resolves with a part's LDraw triangles, or null (D31); without
 * it every block is the plain brick.
 */
export function createBrickScene(element, {
  reducedMotion, onSelectionChange = () => {}, loadShape = null,
} = {}) {
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
  const legend = document.createElement('p');
  legend.className = 'brick-scene-legend';
  legend.textContent = `1 block = up to ${PIECES_PER_BLOCK} pieces of one part`;
  legend.style.position = 'absolute';
  const empty = document.createElement('p');
  empty.className = 'brick-scene-empty';
  empty.textContent = 'No bricks to show.';
  empty.style.position = 'absolute';
  empty.hidden = true;
  root.append(canvas, legend, empty);
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
  // A 1 x 1 card lying face up, its top edge away from the camera's starting side (+z) and
  // its text running left to right as seen from there.
  const labelGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).rotateY(Math.PI);
  // Hashed alpha keeps see-through bricks in the opaque pass, so they show through the
  // frosted walls like the others. Plain blending would draw them after the walls, which
  // write depth and would hide them. Both sides are drawn for the LDraw shapes (D31).
  const materials = {
    solid: new MeshStandardMaterial({ roughness: 0.3, metalness: 0, side: DoubleSide }),
    clear: new MeshStandardMaterial({ roughness: 0.08, metalness: 0, opacity: 0.5,
      alphaHash: true, side: DoubleSide }),
  };
  const blockMeshes = new Map(); // kind and shape -> { mesh, capacity }
  // Part shapes by the LDraw names asked for: { geometry } once loaded, geometry null while
  // loading or when the library has none, so the block stays the plain brick.
  const shapes = new Map();
  const plain = { key: '', geometry: brickGeometry };
  const shapeQueue = [];
  let shapeRequests = 0;
  let blocksStale = false; // a shape arrived; the blocks are drawn again on the next frame
  let settleTimer = 0;
  const colors = new Map();
  const containers = new Map(); // categoryId -> { container, label, item, lidMesh, ... }
  let selected = null; // category ID of the selected container
  let focused = null; // category ID of the container the camera is on
  let notice = '';
  // One ring, moved to whichever container is selected; it never catches a click. It is
  // solid, so it is drawn before the frosted walls and shows through them.
  const ring = new Mesh(createSelectionRingGeometry(),
    new MeshBasicMaterial({ color: SELECTION_COLOR }));
  // Above the floor labels (LABEL.height) even on the smallest container.
  ring.position.y = 0.008;
  ring.raycast = () => {};
  let lidHighlight = null; // the shared lid material, glowing; made on the first selection

  const empties = { piecesPerBlock: PIECES_PER_BLOCK, containers: [], blocks: [] };
  let base = empties; // M11's layout, before blocks are stacked on each other
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
      applySelection();
    } else if (blocksStale) {
      applyBlocks(current);
    }
    blocksStale = false;
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
      placeLabel(entry);
    }
    for (const [categoryId, entry] of containers) {
      if (!present.has(categoryId)) {
        scene.remove(entry.container.group, entry.label);
        entry.label.material.map?.dispose();
        entry.label.material.dispose();
        containers.delete(categoryId);
      }
    }
  }

  function addContainer(categoryId) {
    const container = createContainer();
    container.group.userData.categoryId = categoryId;
    container.group.traverse((object) => {
      object.castShadow = true;
    });
    scene.add(container.group);
    // Solid with cut corners (alphaTest), so it is drawn before the frosted walls and shows
    // through them like everything else on the floor. A click on it selects its container.
    const label = new Mesh(labelGeometry, new MeshBasicMaterial({ alphaTest: 0.5 }));
    label.userData.categoryId = categoryId;
    scene.add(label);
    const lidMesh = container.lid.children[0];
    const entry = { container, label, labelKey: '', item: null, lidMesh,
      lidMaterial: lidMesh.material };
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

  // Draws every block: one instanced mesh per shape and kind (solid or see-through).
  function applyBlocks(frame) {
    const groups = new Map();
    for (const block of frame.blocks) {
      const shape = shapeOf(block);
      const kind = block.colorIsTrans ? 'clear' : 'solid';
      const id = `${kind}|${shape.key}`;
      if (!groups.has(id)) {
        groups.set(id, { kind, geometry: shape.geometry, blocks: [] });
      }
      groups.get(id).blocks.push(block);
    }
    for (const [id, slot] of blockMeshes) {
      if (!groups.has(id)) {
        scene.remove(slot.mesh);
        slot.mesh.dispose();
        blockMeshes.delete(id);
      }
    }
    for (const [id, { kind, geometry, blocks }] of groups) {
      const mesh = blockMesh(id, geometry, materials[kind], blocks.length);
      blocks.forEach((block, index) => {
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

  // One instanced mesh per shape and kind, replaced by a bigger one when its blocks outgrow
  // it.
  function blockMesh(id, geometry, material, count) {
    let slot = blockMeshes.get(id);
    if (slot === undefined || slot.capacity < count) {
      if (slot !== undefined) {
        scene.remove(slot.mesh);
        slot.mesh.dispose();
      }
      const capacity = Math.max(16, 2 ** Math.ceil(Math.log2(count)));
      slot = { mesh: new InstancedMesh(geometry, material, capacity), capacity };
      // The bounds would have to be recomputed on every frame of a transition.
      slot.mesh.frustumCulled = false;
      scene.add(slot.mesh);
      blockMeshes.set(id, slot);
    }
    slot.mesh.count = count;
    return slot.mesh;
  }

  // The shape a block is drawn with: its part's LDraw shape once loaded, the plain brick
  // until then or when there is none (D31). The first time a part is seen, its shape is asked
  // for, a few at a time.
  function shapeOf(block) {
    if (loadShape === null) {
      return plain;
    }
    const names = [...(block.ldrawIds ?? []), block.partNum].filter((name) => name);
    const key = names.join(',');
    let shape = shapes.get(key);
    if (shape === undefined) {
      shape = { key, geometry: null };
      shapes.set(key, shape);
      shapeQueue.push({ shape, names });
      loadShapes();
    }
    return shape.geometry === null ? plain : shape;
  }

  // How tall the shape a block is drawn with is.
  function heightOf(block) {
    const { min, max } = shapeOf(block).geometry.boundingBox;
    return max.y - min.y;
  }

  // Once shapes stop arriving for a moment, the blocks settle on the new shapes: stacked
  // again and moved there like any other change.
  function settle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (disposed) {
        return;
      }
      const next = stackBlocks(base, heightOf);
      transition = { plan: planTransition(current, next), fades: new Map(),
        start: performance.now() };
      shown = next;
      requestFrame();
    }, SETTLE_DELAY);
  }

  function loadShapes() {
    while (shapeRequests < SHAPE_REQUESTS && shapeQueue.length > 0) {
      const { shape, names } = shapeQueue.shift();
      shapeRequests += 1;
      Promise.resolve(loadShape(names)).then((positions) => {
        if (!disposed && positions instanceof Float32Array && positions.length >= 9) {
          shape.geometry = createPartGeometry(positions);
          blocksStale = true;
          settle();
          requestFrame();
        }
      }, () => {
        // No shape: the block stays the plain brick.
      }).finally(() => {
        shapeRequests -= 1;
        if (!disposed) {
          loadShapes();
        }
      });
    }
  }

  function colorOf(rgb) {
    let color = colors.get(rgb);
    if (color === undefined) {
      color = /^[0-9A-Fa-f]{6}$/.test(rgb) ? new Color(`#${rgb}`) : new Color(0x888888);
      colors.set(rgb, color);
    }
    return color;
  }

  // Puts a container's floor label in front of it. The label of an entering or leaving
  // container grows or shrinks with it.
  function placeLabel(entry) {
    const { item, label } = entry;
    const box = labelBox(item);
    const full = transition?.fades.get(item.categoryId);
    const share = full === undefined ? 1 : Math.min(1, item.scale / full);
    label.visible = entry.container.group.visible && share > 0.01;
    label.position.set((box.minX + box.maxX) / 2, LABEL.height, (box.minZ + box.maxZ) / 2);
    label.scale.set((box.maxX - box.minX) * share, 1, LABEL.depth * share);
    paintLabel(entry);
  }

  // Draws the label's texture again only when its text, its selection or its size (in steps
  // of 64 pixels) has changed.
  function paintLabel(entry) {
    const { item, label } = entry;
    const box = labelBox(item);
    const width = box.maxX - box.minX;
    const pixels = Math.min(1024, Math.max(128, Math.round((width * LABEL_PIXELS) / 64) * 64));
    const chosen = item.categoryId === selected;
    const count = `${item.pieces.toLocaleString('en')} ${item.pieces === 1 ? 'piece' : 'pieces'}`;
    const key = `${pixels}|${chosen}|${count}|${item.categoryName}`;
    if (key === entry.labelKey) {
      return;
    }
    entry.labelKey = key;
    const card = document.createElement('canvas');
    card.width = pixels;
    card.height = Math.max(32, Math.round((pixels * LABEL.depth) / width));
    drawLabel(card.getContext('2d'), { name: item.categoryName, count, selected: chosen });
    const texture = new CanvasTexture(card);
    texture.colorSpace = SRGBColorSpace;
    // Seen at a slant on the floor; anisotropic filtering keeps the text sharp.
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    label.material.map?.dispose();
    label.material.map = texture;
    label.material.needsUpdate = true;
  }

  function placeCamera(target, distance, direction) {
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(direction, distance);
    controls.update();
  }

  // Frames the layout's containers, or only the focused one, with their open lids when the
  // lids are open, keeping the direction the user has turned the view to.
  function aimCamera(layout, animate) {
    const boxes = framingBoxes(layout, { lidsOpen: lids.to === 1, focus: focused });
    if (boxes.length === 0) {
      cameraMove = null;
      return;
    }
    const offset = camera.position.clone().sub(controls.target);
    const direction = offset.lengthSq() > 0 ? offset.normalize() : VIEW_DIRECTION.clone();
    const goal = fitCamera(boxes.flatMap(boxCorners), camera, direction);
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

  // Selection and focus (D28).

  function applySelection() {
    for (const [categoryId, entry] of containers) {
      const chosen = categoryId === selected;
      if (chosen && lidHighlight === null) {
        lidHighlight = entry.lidMaterial.clone();
        lidHighlight.color.set(SELECTION_LID);
        lidHighlight.emissive.set(SELECTION_GLOW);
      }
      entry.lidMesh.material = chosen ? lidHighlight : entry.lidMaterial;
      paintLabel(entry);
      if (chosen && ring.parent !== entry.container.group) {
        entry.container.group.add(ring);
      }
    }
    if (selected === null || !containers.has(selected)) {
      ring.removeFromParent();
    }
  }

  // Tells the page what is selected and focused, when that has changed.
  function notify() {
    const item = shown.containers.find((container) => container.categoryId === selected);
    const state = {
      selected: item === undefined ? null
        : { categoryId: item.categoryId, categoryName: item.categoryName, pieces: item.pieces },
      focused,
    };
    const text = JSON.stringify(state);
    if (text !== notice) {
      notice = text;
      onSelectionChange(state);
    }
  }

  const inLayout = (categoryId) => shown.containers.some((item) => item.categoryId === categoryId);

  function select(categoryId) {
    selected = inLayout(categoryId) ? categoryId : null;
    applySelection();
    notify();
    requestFrame();
  }

  // Moves the camera to one container, or back to all of them with null. Asking again
  // frames it again, after the user has turned or zoomed the view.
  function focusOn(categoryId) {
    focused = inLayout(categoryId) ? categoryId : null;
    aimCamera(shown, !instant());
    notify();
    requestFrame();
  }

  const raycaster = new Raycaster();
  const pointer = new Vector2();

  // The category of the container (body, lid or floor label) under the pointer, or null.
  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const targets = [...containers.values()].flatMap((entry) => [entry.container.group,
      entry.label]).filter((object) => object.visible);
    let object = raycaster.intersectObjects(targets, true)[0]?.object ?? null;
    while (object !== null && object.userData.categoryId === undefined) {
      object = object.parent;
    }
    return object === null ? null : object.userData.categoryId;
  }

  let press = null;
  let hover = null;
  const onPointerDown = (event) => {
    press = { x: event.clientX, y: event.clientY };
  };
  // A click selects what is under it, and nothing on empty floor; a drag only turns the view.
  const onPointerUp = (event) => {
    if (press !== null && Math.hypot(event.clientX - press.x, event.clientY - press.y)
      <= CLICK_SLOP) {
      select(pick(event));
    }
    press = null;
  };
  // A double click moves the camera to a container, or on empty floor back to all of them.
  const onDoubleClick = (event) => {
    const categoryId = pick(event);
    if (categoryId !== null) {
      select(categoryId);
    }
    focusOn(categoryId);
  };
  // The pointer shows that a container can be clicked; checked once per frame at most.
  const onPointerMove = (event) => {
    if (event.buttons !== 0) {
      return;
    }
    if (hover === null) {
      requestAnimationFrame(() => {
        if (!disposed) {
          canvas.style.cursor = pick(hover) === null ? '' : 'pointer';
        }
        hover = null;
      });
    }
    hover = event;
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('pointermove', onPointerMove);

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
      base = computeLayout(rows, { piecesPerBlock: PIECES_PER_BLOCK });
      const next = stackBlocks(base, heightOf);
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
      // A container that leaves takes its selection and focus with it.
      if (!inLayout(selected)) {
        selected = null;
      }
      if (!inLayout(focused)) {
        focused = null;
      }
      notify();
      empty.hidden = next.containers.length > 0;
      // The first containers are framed at once; later changes move the camera with them.
      aimCamera(next, !first && !instant());
      requestFrame();
    },
    select(categoryId) {
      if (!disposed) {
        select(categoryId);
      }
    },
    focus(categoryId) {
      if (!disposed) {
        focusOn(categoryId);
      }
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
      clearTimeout(settleTimer);
      resizer.disconnect();
      motionQuery?.removeEventListener('change', finishMotion);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('pointermove', onPointerMove);
      ring.geometry.dispose();
      ring.material.dispose();
      for (const { label } of containers.values()) {
        label.material.map?.dispose();
        label.material.dispose();
      }
      labelGeometry.dispose();
      lidHighlight?.dispose();
      controls.dispose();
      for (const slot of blockMeshes.values()) {
        slot.mesh.dispose();
      }
      for (const material of Object.values(materials)) {
        material.dispose();
      }
      for (const shape of shapes.values()) {
        shape.geometry?.dispose();
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
