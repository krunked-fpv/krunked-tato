// ============================================================================
// src/render/shaders.ts
// GLSL ES 3.00 instanced quad shaders for WebGL2Renderer:
// - Single-batch instanced sprite/vfx/glyph rendering (up to 16,384 quads)
// - UV atlas sampling with clamped 4-neighbor rarity/elite/boss outline
// - Crisp pure-white hitFlash modulation + horizontal/vertical flip + rotation
// ============================================================================

export const SPRITE_VERT_SHADER = `#version 300 es
precision highp float;

// Unit quad corner (-0.5 .. +0.5)
layout(location = 0) in vec2 aCorner;

// Per-instance attributes (16 floats = 64 bytes per quad)
layout(location = 1) in vec4 aPosSize;   // worldX, worldY, width, height
layout(location = 2) in vec4 aUvRect;    // u0, v0, u1, v1
layout(location = 3) in vec4 aColor;     // r, g, b, a
layout(location = 4) in vec4 aExtra;     // rotRad, hitFlash (0..1), outlineMode (0..4), flipFlags (1=flipX, 2=flipY)

uniform vec2 uCamPos;
uniform vec2 uViewHalfWorld; // (viewW / (2*zoom), viewH / (2*zoom))

out vec2 vUv;
out vec4 vUvRect;
out vec4 vColor;
out float vHitFlash;
out float vOutlineMode;

void main() {
  float flipCode = aExtra.w;
  float fx = (flipCode == 1.0 || flipCode == 3.0) ? -1.0 : 1.0;
  float fy = (flipCode == 2.0 || flipCode == 3.0) ? -1.0 : 1.0;

  vec2 local = vec2(aCorner.x * aPosSize.z * fx, aCorner.y * aPosSize.w * fy);
  float c = cos(aExtra.x);
  float s = sin(aExtra.x);
  vec2 rotated = vec2(
    local.x * c - local.y * s,
    local.x * s + local.y * c
  );

  vec2 worldPos = aPosSize.xy + rotated;
  vec2 rel = worldPos - uCamPos;
  vec2 ndc = vec2(rel.x / uViewHalfWorld.x, -rel.y / uViewHalfWorld.y);

  gl_Position = vec4(ndc, 0.0, 1.0);

  vec2 uvFrac = aCorner + vec2(0.5);
  vUv = mix(aUvRect.xy, aUvRect.zw, uvFrac);
  vUvRect = aUvRect;
  vColor = aColor;
  vHitFlash = aExtra.y;
  vOutlineMode = aExtra.z;
}
`;

export const SPRITE_FRAG_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uAtlas;
uniform vec2 uTexelSize;

in vec2 vUv;
in vec4 vUvRect;
in vec4 vColor;
in float vHitFlash;
in float vOutlineMode;

out vec4 outColor;

vec3 getOutlineColor(float mode) {
  if (mode < 1.5) return vec3(0.353, 0.745, 1.0);   // 1: Uncommon Cyan #5ABEFF
  if (mode < 2.5) return vec3(0.678, 0.353, 1.0);   // 2: Rare Purple #AD5AFF
  if (mode < 3.5) return vec3(1.0, 0.231, 0.231);   // 3: Legendary/Boss Crimson #FF3B3B
  return vec3(1.0, 0.831, 0.231);                   // 4: Elite Gold #FFD43B
}

void main() {
  vec4 tex = texture(uAtlas, vUv);
  vec4 col = tex * vColor;

  if (vOutlineMode > 0.5 && col.a < 0.25) {
    vec2 stepUv = uTexelSize * 2.2;
    vec2 uvMin = vUvRect.xy + uTexelSize * 0.5;
    vec2 uvMax = vUvRect.zw - uTexelSize * 0.5;

    float nA = texture(uAtlas, clamp(vUv + vec2(stepUv.x, 0.0), uvMin, uvMax)).a;
    nA = max(nA, texture(uAtlas, clamp(vUv - vec2(stepUv.x, 0.0), uvMin, uvMax)).a);
    nA = max(nA, texture(uAtlas, clamp(vUv + vec2(0.0, stepUv.y), uvMin, uvMax)).a);
    nA = max(nA, texture(uAtlas, clamp(vUv - vec2(0.0, stepUv.y), uvMin, uvMax)).a);

    if (nA > 0.35) {
      outColor = vec4(getOutlineColor(vOutlineMode), vColor.a * 0.92);
      return;
    }
  }

  if (col.a < 0.01) {
    discard;
  }

  if (vHitFlash > 0.01) {
    col.rgb = mix(col.rgb, vec3(1.0, 1.0, 1.0), clamp(vHitFlash, 0.0, 1.0));
  }

  outColor = col;
}
`;
