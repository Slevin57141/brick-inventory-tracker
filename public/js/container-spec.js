// The storage container's dimensions as plain numbers (docs/container-spec.md, plan M13).
// There is no three.js here, so the layout maths (M11) and its tests can use it in Node.
// All values are at unit scale; a whole container is scaled uniformly (plan D17). They are
// starting values, to be tuned by eye on the preview page.

export const CONTAINER = Object.freeze({
  // Outer width at the rim, the widest point of the body.
  width: 1,
  // Outer depth at the rim: noticeably longer front-to-back than wide.
  depth: 1.7,
  // From the bottom of the feet to the top of the rim, lid excluded: taller than wide.
  height: 1.35,
  // How far each wall moves inward from the rim down to the bottom.
  taper: 0.03,
  // Length cut off each vertical corner at the rim, measured along each wall.
  chamfer: 0.1,
  // Thickness of the walls and the bottom.
  wall: 0.025,
  // Height of the feet below the flat bottom.
  footHeight: 0.02,
  // From the lid's underside to the top of its raised perimeter.
  lidHeight: 0.07,
  // How far the lid reaches past the rim on each side.
  lidOverhang: 0.015,
});

/**
 * The space blocks can fill at a given scale: a box standing on the inside of the bottom,
 * as wide and deep as the narrow bottom allows (the walls lean outward toward the rim) and
 * clear of the chamfered corners, reaching up to the rim where the lid sits.
 */
export function interiorBox(scale = 1) {
  const { width, depth, height, taper, chamfer, wall, footHeight } = CONTAINER;
  // A rectangle clears a 45-degree corner cut of length `chamfer` when it is inset by half of
  // it on each side, so the two sides together lose one `chamfer`. The inner wall's cut is a
  // little shorter than the outer one, so this errs on the safe side.
  const sideLoss = 2 * (taper + wall) + chamfer;
  const floorY = footHeight + wall;
  return {
    width: (width - sideLoss) * scale,
    depth: (depth - sideLoss) * scale,
    height: (height - floorY) * scale,
    floorY: floorY * scale,
  };
}
