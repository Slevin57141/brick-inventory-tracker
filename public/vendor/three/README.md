# three.js (vendored)

Vendored for the 3D view (docs/plan.md D13). Do not edit these files; see AGENTS.md.

- Version: 0.186.1, published to npm on 2026-09-24.
- Source: the npm package `three@0.186.1`,
  https://registry.npmjs.org/three/-/three-0.186.1.tgz
- Package integrity (npm registry, checked by `npm pack` on download):
  `sha512-blFeqb49wRCSGUGj7gtpfnSGHy2lwDk94RhUmS1c/hTby70kvChbWpkJ4Pm1390LqzzvTmzgXKHPEafJwCb8jA==`
- Vendored on 2026-10-31 by Claude Code.
- Licence: MIT, in `LICENSE`.

0.187.0 was the newest release when this was vendored, but it had been published the day
before. 0.186.1 had been out for five weeks; a release that new has had no time for problems
to surface. Upgrading is its own branch (AGENTS.md).

## Files

`test/vendor.test.js` checks that this table lists every file in this folder (except this
README) and that each SHA-256 matches.

| File | From the package | SHA-256 |
| ---- | ---------------- | ------- |
| `three.core.js` | `build/three.core.js` | `9edde002b066a9a05676a6127f67735b62baf399bdea529f2f7e31657da769e6` |
| `three.module.js` | `build/three.module.js` | `9052042d676cb0fdc1ddfefe193053f34b7ac0513a616fdac4535d49987812ea` |
| `OrbitControls.js` | `examples/jsm/controls/OrbitControls.js`, one line changed | `30386f7141d5ce5d5e0a3ab643e4eb16265f4564466108105ce449857f62fdda` |
| `RoomEnvironment.js` | `examples/jsm/environments/RoomEnvironment.js`, one line changed | `77d4d2bed2b60cb98424764264aedd84b56bbf3211e0f48430e15608aeded9dc` |
| `LICENSE` | `LICENSE` | `8b378ebe60e2fe500158cb0ac71cb5e8b7d92953c2abcc63a0eb90499653b5bc` |

## The one change

In `OrbitControls.js` (line 12) and `RoomEnvironment.js` (line 11), the import

```js
} from 'three';
```

is changed to

```js
} from './three.module.js';
```

so the browser can load the add-ons without an import map, which the page's
Content-Security-Policy would block. Nothing else differs from the package. SHA-256 of the
unchanged package files:

- `examples/jsm/controls/OrbitControls.js`:
  `3d79d07ecb686b4e5d93232eedab255331c1beef711e13164eaa1f68655a5f2b`
- `examples/jsm/environments/RoomEnvironment.js`:
  `55f466192cc84298755a424c5e040345006b2ee1455589b3b54126c2ea4123f4`
