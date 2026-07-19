// PSX rendering pipeline — the heart of AgentForge's PS1 aesthetic.
//
// Two independent pieces, used together for the full effect:
//
// 1. PSXPost — renders the scene into a low-resolution target (default
//    320x240, the PS1's most common mode), then upscales to the output canvas
//    with nearest-neighbor sampling while applying 15-bit color quantization
//    (RGB555) and the 4x4 ordered-dither pattern the PS1 GPU applied in
//    hardware before truncating to 15 bits.
//
// 2. patchModelPSX — injects two authentic GPU artifacts into every model
//    material via onBeforeCompile:
//      - vertex snapping: the PS1 GT had no sub-pixel precision, so vertices
//        snap to the screen pixel grid (polygons "jitter" and edges step)
//      - affine texture mapping: the PS1 rasterizer interpolated UVs in
//        screen space without perspective correction, so textures warp on
//        polygons seen at an angle
//    Both are driven by shared uniforms so they can be toggled per-view
//    (diagnostic views render clean) without recompiling.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const PSX_DEFAULTS = {
  resolution: [320, 240], // PS1 mode 1 (also authentic: 256x240, 512x240, 640x480 hi-res)
  colorBits: 5,           // RGB555 — 32 levels per channel
  dither: true,           // hardware 4x4 ordered dither
  snap: true,             // vertex snapping to the pixel grid
  affine: true,           // affine (non-perspective-correct) texture mapping
};

// ---------------------------------------------------------------------------
// Post pass: low-res render target -> quantize + dither -> nearest upscale.
// ---------------------------------------------------------------------------
export class PSXPost {
  constructor(renderer, { width = 320, height = 240, colorBits = 5, dither = true } = {}) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: this.rt.texture },
        uRes: { value: new THREE.Vector2(width, height) },
        uLevels: { value: Math.pow(2, colorBits) - 1 },
        uDither: { value: dither ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uRes;
        uniform float uLevels;
        uniform float uDither;
        varying vec2 vUv;

        // Compact 4x4 Bayer matrix (values 0..15/16) — matches the PS1 GPU's
        // ordered-dither cell without needing array indexing.
        float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
        float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

        vec3 lin2srgb(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
        }

        void main() {
          // Sample the low-res frame at pixel centers (nearest upscale).
          vec2 px = floor(vUv * uRes);
          vec3 c = texture2D(tSrc, (px + 0.5) / uRes).rgb;
          // The PS1 dithered and truncated in display space, not linear space.
          c = lin2srgb(clamp(c, 0.0, 1.0));
          if (uDither > 0.5) c += (bayer4(px) - 0.5) / uLevels;
          c = floor(c * uLevels + 0.5) / uLevels;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    }));
  }

  setSize(width, height) {
    this.rt.setSize(width, height);
    this.quad.material.uniforms.uRes.value.set(width, height);
  }

  /** Render `scene` through the PSX pipeline onto the renderer's canvas. */
  render(scene, camera) {
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(prevTarget);
    this.quad.render(this.renderer);
  }

  dispose() {
    this.rt.dispose();
    this.quad.material.dispose();
    this.quad.dispose();
  }
}

// ---------------------------------------------------------------------------
// Material patching: vertex snap + affine UVs, shared-uniform driven.
// ---------------------------------------------------------------------------

/** Shared uniforms controlling the vertex-stage PSX artifacts. */
export function createPSXUniforms({ width = 320, height = 240, snap = true, affine = true } = {}) {
  return {
    uPsxSnapOn: { value: snap ? 1 : 0 },
    // NDC is -1..1, so half the target resolution = pixels per NDC unit.
    uPsxSnapRes: { value: new THREE.Vector2(width / 2, height / 2) },
    uPsxAffineOn: { value: affine ? 1 : 0 },
  };
}

/** Toggle both vertex-stage artifacts at once (used for diagnostic views). */
export function setPSXArtifacts(uniforms, on) {
  uniforms.uPsxSnapOn.value = on ? 1 : 0;
  uniforms.uPsxAffineOn.value = on ? 1 : 0;
}

/** Patch every material under `root` with the PSX vertex/fragment artifacts. */
export function patchModelPSX(root, uniforms) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mList = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mList) {
      if (m && !m.userData.psxPatched) patchMaterialPSX(m, uniforms);
    }
  });
}

export function patchMaterialPSX(material, uniforms) {
  material.userData.psxPatched = true;
  const affine = !!material.map; // affine warp only applies to the diffuse map

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPsxSnapOn = uniforms.uPsxSnapOn;
    shader.uniforms.uPsxSnapRes = uniforms.uPsxSnapRes;
    shader.uniforms.uPsxAffineOn = uniforms.uPsxAffineOn;

    shader.vertexShader =
      'uniform float uPsxSnapOn;\nuniform vec2 uPsxSnapRes;\n' +
      (affine ? 'varying vec2 vPsxUv;\nvarying float vPsxW;\n' : '') +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        /* glsl */ `
#include <project_vertex>
if (uPsxSnapOn > 0.5) {
  vec3 psxNdc = gl_Position.xyz / gl_Position.w;
  psxNdc.xy = floor(psxNdc.xy * uPsxSnapRes + 0.5) / uPsxSnapRes;
  gl_Position.xyz = psxNdc * gl_Position.w;
}
${affine ? /* glsl */ `
#ifdef USE_MAP
  vPsxW = gl_Position.w;
  vPsxUv = vMapUv * vPsxW;
#endif` : ''}
`
      );

    if (affine) {
      shader.fragmentShader =
        'uniform float uPsxAffineOn;\nvarying vec2 vPsxUv;\nvarying float vPsxW;\n' +
        shader.fragmentShader.replace(
          '#include <map_fragment>',
          // Reimplements map_fragment with screen-linear (affine) UVs: the
          // varyings were pre-multiplied by w, so dividing by the interpolated
          // w cancels the GPU's perspective correction.
          /* glsl */ `
#ifdef USE_MAP
  vec2 psxUv = uPsxAffineOn > 0.5 ? vPsxUv / vPsxW : vMapUv;
  vec4 sampledDiffuseColor = texture2D( map, psxUv );
  diffuseColor *= sampledDiffuseColor;
#endif
`
        );
    }
  };
  // Distinct cache key per patch variant so patched programs never collide
  // with unpatched ones (or textured with untextured).
  material.customProgramCacheKey = () => `psx${affine ? '-affine' : ''}`;
  material.needsUpdate = true;
}
