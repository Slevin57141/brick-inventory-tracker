Author: Stoil_Dimitrov (GitHub: Slevin57141).

This is the user's description of the storage container used in the 3D view, kept as given.
[plan.md](plan.md) explains how the app uses it (R24-R28, D17-D20, module M13).

---

# Three.js: Stackable Plastic Storage Container

Create a realistic 3D model of a small, stackable plastic storage container using Three.js.

Focus on accurately reproducing its **shape, proportions, materials, and distinctive lid design**. Exact physical measurements are not required.

## 1. Overall Shape

The container is a tall, narrow, rectangular storage bin with an elongated footprint.

- Noticeably longer front-to-back than it is wide.
- Taller than it is wide, giving it a slim, upright appearance.
- Four mostly vertical walls with a very subtle inward taper toward the bottom.
- Corners are chamfered (diagonally cut) rather than perfectly square or heavily rounded.
- The upper opening is slightly wider than the bottom.
- The bottom is flat, with small moulded support features near the corners.
- The container is hollow, with a single undivided interior compartment.

The overall silhouette should resemble a narrow industrial parts organizer rather than a conventional food container.

## 2. Transparent Container Body

The main body is made from semi-transparent, slightly frosted plastic.

- Colourless or very pale grey translucent material.
- Thin but visibly solid plastic walls.
- Smooth injection-moulded surfaces.
- Slightly reinforced upper rim.
- Subtle vertical edges and moulding seams.
- Small bevels where surfaces meet.
- Flat, closed bottom.

The transparency should allow the interior and opposite walls to be faintly visible.

## 3. Distinctive Red Lid

The lid is the most recognizable feature of the design.

It is a separate, removable component made of opaque, muted red plastic.

**Shape:**
- Elongated rectangular footprint matching the container.
- Chamfered corners that follow the shape of the body.
- Thin, shallow cap extending slightly beyond the upper walls.
- Raised outer perimeter forming a continuous rim.
- Broad, relatively flat central panel recessed slightly below the rim.

**Surface details:**
- Shallow geometric grooves running along the perimeter.
- Angular recesses and diagonal moulded ridges near the corners.
- Subtle stepped surfaces that form an interlocking stacking pattern.
- Smooth satin plastic finish with soft highlights.

The lid should look like a purpose-built injection-moulded industrial component, not a simple flat rectangle.

It is fully detachable, without hinges, clasps, or handles.

## 4. Stackable Construction

The container is designed to stack vertically with identical units.

- The underside of the container includes small moulded feet or support protrusions.
- These align with shallow recessed regions on the red lid below.
- The lid's raised perimeter helps position the next container.
- Stacked containers should sit directly above one another with minimal gaps.
- The interlocking details should be subtle and integrated into the plastic geometry.

Do not add exaggerated connecting mechanisms or LEGO-style studs.

## 5. Materials

**Body:**
- Translucent, slightly cloudy polypropylene.
- Soft reflections and subtle refraction.
- Smooth plastic with visible edge thickness.

**Lid:**
- Solid muted red.
- Matte-to-satin plastic.
- Slightly bevelled edges.
- No metallic effects or heavy textures.

## 6. Three.js Implementation

- Construct the body using hollow geometry rather than a solid cube.
- Use a chamfered rectangular polygon as the base profile.
- Apply a slight taper to the walls.
- Create the lid as an independent `THREE.Group`.
- Build the lid's raised perimeter, recessed centre, and diagonal corner features with actual geometry.
- Use `MeshPhysicalMaterial` for the transparent body.
- Use `MeshStandardMaterial` for the red lid.
- Make the model reusable so multiple identical containers can be instantiated and stacked.

## 7. Presentation

Display the container in an interactive Three.js scene with:

- A three-quarter perspective camera positioned slightly above the object.
- Soft studio lighting.
- Neutral background.
- Orbit controls for rotation and zoom.
- An option to remove the lid and reveal the empty interior.
- An option to display several containers stacked vertically.

## 8. Important Visual Constraints

The final model must have:

- A tall, slim, elongated rectangular silhouette.
- Slightly tapered transparent walls.
- Chamfered vertical corners.
- One hollow storage compartment.
- A distinctive removable red lid with raised and recessed angular details.
- Subtle stacking features integrated into the base and lid.

Avoid internal dividers, hinges, buckles, large handles, decorative patterns, exaggerated rounded corners, or unnecessary mechanical details.

**Priority:** Reproduce the recognizable silhouette and lid geometry. The model should look like a realistic plastic workshop organizer rather than a generic transparent box with a red top.
