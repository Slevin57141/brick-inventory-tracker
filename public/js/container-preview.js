// The container preview page (docs/plan.md M13, R28; container-spec.md section 7): one
// container in a soft studio scene, a button that removes the lid, and a button that shows
// three identical containers stacked. It draws only when something changes. `?stack=1` and
// `?lid=off` in the address open the page in those states, so a view can be linked.

import {
  Color,
  DirectionalLight,
  Mesh,
  NeutralToneMapping,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderer,
} from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { CONTAINER } from './container-spec.js';
import { createContainer, stackHeight } from './container-model.js';

const STACK_COUNT = 3;
const BACKGROUND = 0xe8e9eb;
// A three-quarter view from slightly above (spec section 7), turned toward the narrow front
// so the container reads as tall and slim.
const VIEW_DIRECTION = new Vector3(0.6, 0.42, 1.2).normalize();

const view = document.getElementById('view');
const lidButton = document.getElementById('toggle-lid');
const stackButton = document.getElementById('toggle-stack');
const params = new URLSearchParams(window.location.search);
const state = { stacked: params.get('stack') === '1', lidOff: params.get('lid') === 'off' };

const renderer = createRenderer();
if (renderer === null) {
  view.hidden = true;
  document.getElementById('no-webgl').hidden = false;
  lidButton.disabled = true;
  stackButton.disabled = true;
} else {
  start(renderer);
}

function createRenderer() {
  try {
    return new WebGLRenderer({ antialias: true });
  } catch {
    return null; // no WebGL 2 in this browser
  }
}

function start(renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  view.append(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const key = new DirectionalLight(0xffffff, 1.4);
  key.position.set(2.5, 5, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0005;
  scene.add(key);

  const floor = new Mesh(new PlaneGeometry(30, 30), new ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const containers = Array.from({ length: STACK_COUNT }, (_, index) => {
    const container = createContainer();
    container.group.position.y = index * stackHeight();
    container.group.traverse((object) => {
      object.castShadow = true;
    });
    scene.add(container.group);
    return container;
  });

  const camera = new PerspectiveCamera(32, 1, 0.05, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.minDistance = 1;
  controls.maxDistance = 20;
  controls.maxPolarAngle = Math.PI * 0.49; // stay above the floor
  controls.addEventListener('change', render);

  function render() {
    renderer.render(scene, camera);
  }

  function frame() {
    const count = state.stacked ? STACK_COUNT : 1;
    const top = (count - 1) * stackHeight() + CONTAINER.height + CONTAINER.lidHeight;
    const target = new Vector3(0, top / 2, 0);
    const radius = Math.hypot(CONTAINER.width, CONTAINER.depth, top) / 2;
    const fov = (camera.fov * Math.PI) / 180;
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * camera.aspect));
    const distance = (radius / Math.sin(fit / 2)) * 1.08;
    camera.position.copy(target).addScaledVector(VIEW_DIRECTION, distance);
    controls.target.copy(target);
    controls.update();
  }

  function apply() {
    const count = state.stacked ? STACK_COUNT : 1;
    containers.forEach((container, index) => {
      container.group.visible = index < count;
      // Only the top container's lid comes off; the lower lids carry the stack.
      container.lid.visible = !(state.lidOff && index === count - 1);
    });
    lidButton.textContent = state.lidOff ? 'Put lid back' : 'Remove lid';
    lidButton.setAttribute('aria-pressed', String(state.lidOff));
    stackButton.textContent = state.stacked ? 'Show one' : 'Stack';
    stackButton.setAttribute('aria-pressed', String(state.stacked));
    render();
  }

  lidButton.addEventListener('click', () => {
    state.lidOff = !state.lidOff;
    apply();
  });
  stackButton.addEventListener('click', () => {
    state.stacked = !state.stacked;
    frame();
    apply();
  });

  new ResizeObserver(() => {
    const { clientWidth, clientHeight } = view;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    frame();
    render();
  }).observe(view);

  apply();
}
