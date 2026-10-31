// The built set in 3D (docs/plan.md M15, D31): an LDraw model from the server (M14), each
// placed part drawn with its shape from the parts library, one instanced mesh per part and
// colour. It draws only while something changes or the user turns it, like the 3D view.

import {
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { boxCorners, fitCamera } from './brick-scene.js';

const BACKGROUND = 0xe8e9eb;
// One LDraw unit in world units; the model is about as big as its studs say.
const LDRAW_UNIT = 0.01;
const PART_REQUESTS = 6;
const VIEW_DIRECTION = new Vector3(0.7, 0.55, 1).normalize();

/**
 * An LDraw matrix (x y z a b c d e f g h i) as a three.js Matrix4, in the model's LDraw
 * coordinates.
 */
export function ldrawMatrix([x, y, z, a, b, c, d, e, f, g, h, i]) {
  return new Matrix4().set(a, b, c, x, d, e, f, y, g, h, i, z, 0, 0, 0, 1);
}

/** Triangles in LDraw units as a geometry with flat normals, still in LDraw's axes. */
export function ldrawGeometry(positions) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Draws a model in `element`; null without WebGL, leaving the element untouched.
 * `loadShape(names)` resolves with a part's LDraw triangles or null, as for the 3D view.
 * `onProgress({ loaded, total })` follows the parts as they arrive.
 */
export function createModelView(element, { loadShape, onProgress = () => {} }) {
  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
  renderer.toneMapping = NeutralToneMapping;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The built set in 3D');
  element.append(canvas);

  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  pmrem.dispose();
  const light = new DirectionalLight(0xffffff, 1.2);
  light.position.set(2, 5, 3);
  scene.add(light);
  // LDraw's y points down: half a turn about x stands the model up without mirroring it.
  const model = new Group();
  model.rotation.x = Math.PI;
  model.scale.setScalar(LDRAW_UNIT);
  scene.add(model);

  const camera = new PerspectiveCamera(32, 1, 0.01, 500);
  const controls = new OrbitControls(camera, canvas);
  controls.addEventListener('change', render);

  const geometries = [];
  const materials = [];
  let shown = 0; // which model is on screen; a newer one stops the older one's loading
  let disposed = false;

  function render() {
    if (!disposed) {
      renderer.render(scene, camera);
    }
  }

  function clear() {
    for (const child of [...model.children]) {
      model.remove(child);
      child.dispose?.();
    }
    for (const item of [...geometries, ...materials]) {
      item.dispose();
    }
    geometries.length = 0;
    materials.length = 0;
  }

  function material({ rgb, alpha }) {
    const made = new MeshStandardMaterial({ color: new Color(`#${rgb}`), roughness: 0.3,
      metalness: 0, side: DoubleSide });
    if (alpha < 255) {
      // Plain blending: there are no frosted walls here that would hide it (unlike M12).
      made.transparent = true;
      made.opacity = alpha / 255;
      made.depthWrite = false;
    }
    materials.push(made);
    return made;
  }

  // Frames whatever has arrived so far, looking from the front and a little above.
  function frame() {
    const bounds = new Box3().setFromObject(model);
    if (bounds.isEmpty()) {
      return;
    }
    const points = boxCorners(bounds);
    const { target, distance } = fitCamera(points, camera, VIEW_DIRECTION);
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(VIEW_DIRECTION, distance);
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
    controls.update();
  }

  const resizer = new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = element;
    if (width > 0 && height > 0) {
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      frame();
      render();
    }
  });
  resizer.observe(element);

  return {
    /** Shows a model from `api.getSetModel`, replacing what was shown. */
    async show({ colors, instances, loose }) {
      const mine = ++shown;
      clear();
      const palette = colors.map(material);
      for (const { color, positions } of loose) {
        const geometry = ldrawGeometry(positions);
        geometries.push(geometry);
        model.add(new Mesh(geometry, palette[color]));
      }
      // Instances by part, then by colour within a part.
      const byPart = new Map();
      for (const instance of instances) {
        if (!byPart.has(instance.part)) {
          byPart.set(instance.part, new Map());
        }
        const byColor = byPart.get(instance.part);
        if (!byColor.has(instance.color)) {
          byColor.set(instance.color, []);
        }
        byColor.get(instance.color).push(instance.matrix);
      }
      const parts = [...byPart];
      let loaded = 0;
      onProgress({ loaded, total: parts.length });
      const next = async () => {
        while (parts.length > 0 && mine === shown && !disposed) {
          const [name, byColor] = parts.shift();
          let positions = null;
          try {
            positions = await loadShape([name]);
          } catch {
            // A part that does not load is left out.
          }
          if (mine !== shown || disposed) {
            return;
          }
          if (positions instanceof Float32Array && positions.length >= 9) {
            const geometry = ldrawGeometry(positions);
            geometries.push(geometry);
            for (const [color, matrices] of byColor) {
              const mesh = new InstancedMesh(geometry, palette[color], matrices.length);
              matrices.forEach((matrix, index) => mesh.setMatrixAt(index, ldrawMatrix(matrix)));
              mesh.instanceMatrix.needsUpdate = true;
              mesh.computeBoundingBox();
              mesh.computeBoundingSphere();
              model.add(mesh);
            }
          }
          loaded += 1;
          onProgress({ loaded, total: byPart.size });
          frame();
          render();
        }
      };
      await Promise.all(Array.from({ length: PART_REQUESTS }, next));
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      resizer.disconnect();
      controls.dispose();
      clear();
      environment.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
