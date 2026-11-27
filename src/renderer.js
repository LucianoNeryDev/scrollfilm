// Draws frames on the canvas. WebGL2 takes them straight from the decoder as
// textures: on a Galaxy A14 an upload takes 1.6 ms, against 3 ms for a copy
// through a 2D canvas, and blending two frames is free. Without WebGL (a
// blocked GPU) a 2D canvas does the same, slower.
import { fitRect } from './math.js';

const VERTEX = `#version 300 es
in vec2 p;
uniform vec4 crop;
out vec2 uv;
void main() {
  uv = crop.xy + vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5) * crop.zw;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 uv;
uniform sampler2D tex;
uniform float alpha;
out vec4 color;
void main() { color = vec4(texture(tex, uv).rgb, alpha); }`;

const sizeOf = (src) => [
  src.displayWidth || src.naturalWidth || src.videoWidth || src.width,
  src.displayHeight || src.naturalHeight || src.videoHeight || src.height,
];

// onLost runs when the GPU drops every texture (a reset, a tab long in the
// background); the frames have to be decoded again. transparent: the canvas
// is cleared to transparent at every draw, for a film shown by a <video>
// under it, with only the overlays drawn here.
export function createRenderer(canvas, { onLost = () => {}, onRestored = () => {}, forceCanvas2d = false, transparent = false } = {}) {
  let gl = null, crop = null, alpha = null;
  const spare = [];
  let images = new WeakMap(); // overlay images -> their textures
  let copy = null; // for browsers that can't upload a VideoFrame directly

  function start() {
    gl = forceCanvas2d ? null : canvas.getContext('webgl2', {
      alpha: transparent, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance',
    });
    if (!gl) return false;
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.bindAttribLocation(prog, 0, 'p');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) { gl = null; return false; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // Colour blends by alpha; alpha adds up, as a premultiplied canvas wants.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, transparent ? 0 : 1);
    crop = gl.getUniformLocation(prog, 'crop');
    alpha = gl.getUniformLocation(prog, 'alpha');
    return true;
  }

  if (start()) {
    const lost = (e) => {
      e.preventDefault();
      spare.length = 0;
      images = new WeakMap();
      onLost();
    };
    const restored = () => { start(); onRestored(); };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);

    const upload = (src) => {
      if (gl.isContextLost()) return null;
      const tex = spare.pop() || gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (!copy) {
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          return tex;
        } catch {
          copy = new OffscreenCanvas(1, 1);
        }
      }
      const [w, h] = sizeOf(src);
      if (copy.width !== w || copy.height !== h) { copy.width = w; copy.height = h; }
      copy.getContext('2d').drawImage(src, 0, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, copy);
      return tex;
    };

    const draw = (tex, w, h, a, fit) => {
      const cw = canvas.width, ch = canvas.height;
      const r = fitRect(cw, ch, w, h, fit);
      if (fit === 'contain') {
        gl.viewport(Math.round(r.x), Math.round(ch - r.y - r.h), Math.round(r.w), Math.round(r.h));
        gl.uniform4f(crop, 0, 0, 1, 1);
      } else {
        gl.viewport(0, 0, cw, ch);
        gl.uniform4f(crop, -r.x / r.w, -r.y / r.h, cw / r.w, ch / r.h);
      }
      gl.uniform1f(alpha, a);
      if (a < 1) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    return {
      kind: 'webgl2',
      upload,
      release(tex) {
        if (!gl.isContextLost() && spare.length < 8) spare.push(tex);
        else gl.deleteTexture(tex);
      },
      begin(fit) {
        if (fit === 'contain' || transparent) { gl.viewport(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT); }
      },
      draw,
      // An image of the page's (an <img>, a bitmap, a canvas) over the frame,
      // uploaded once.
      image(img, a, fit) {
        let tex = images.get(img);
        if (!tex) {
          tex = upload(img);
          if (!tex) return;
          images.set(img, tex);
        }
        const [w, h] = sizeOf(img);
        draw(tex, w, h, a, fit);
      },
      forget(img) {
        const tex = images.get(img);
        if (tex) { gl.deleteTexture(tex); images.delete(img); }
      },
      destroy() {
        canvas.removeEventListener('webglcontextlost', lost);
        canvas.removeEventListener('webglcontextrestored', restored);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      },
    };
  }

  const ctx = canvas.getContext('2d', { alpha: transparent });
  const draw = (img, w, h, a, fit) => {
    const r = fitRect(canvas.width, canvas.height, w, h, fit);
    ctx.globalAlpha = a;
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;
  };
  return {
    kind: '2d',
    upload(src) {
      const [w, h] = sizeOf(src);
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d').drawImage(src, 0, 0);
      return c.transferToImageBitmap();
    },
    release(bm) { bm.close?.(); },
    begin(fit) {
      if (transparent) ctx.clearRect(0, 0, canvas.width, canvas.height);
      else if (fit === 'contain') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    },
    draw,
    image(img, a, fit) { const [w, h] = sizeOf(img); draw(img, w, h, a, fit); },
    forget() {},
    destroy() {},
  };
}
