/* Glimlet 0.1.0
   <script src="glimlet.js"></script>
   <glimlet-badge>NEW</glimlet-badge>
   Optional: fill, ink, em
   em = badge height ÷ surrounding font size (default 1.1).
   Vertically centered on the line’s capital height (0.5cap).
*/
(() => {
  const VERSION = "0.1.0";
  const TAG = "glimlet-badge";
  if (customElements.get(TAG)) return;

  const FPS = 30;
  const LAST = 40;
  const FRAME_MS = 1000 / FPS;
  const REF_FONT = 24;
  const LAUNCH_WINDOW = 5.5;
  const START_DELAY = 200;
  const VIEW_RATIO = 0.6;
  const SHINE = 140;
  const arrivalScale = [
    0.047, 0.256, 0.605, 0.721, 0.826, 0.874, 0.916,
    0.946, 0.967, 0.981, 0.989, 0.995, 0.998, 1
  ];

  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const mix = (from, to, amount) => from + (to - from) * amount;
  const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);

  function sample(values, frame) {
    const position = Math.max(0, Math.min(values.length - 1, frame));
    const before = Math.floor(position);
    const after = Math.min(values.length - 1, before + 1);
    return mix(values[before], values[after], position - before);
  }

  // Local frame 0 is the first contact with the lower clip.
  // Offsets are in the 24px reference space.
  function letterOffset(frame, delay) {
    const local = frame - 6 - delay;
    if (local <= -1) return 40;
    if (local < 0) return mix(40, 34, easeOutCubic(local + 1));
    if (local < 5) return mix(34, -13, easeOutCubic(local / 5));
    if (local < 8) return -13;
    const springTime = local - 8;
    const damping = 0.48;
    const frequency = 0.62;
    const dampedFrequency = frequency * Math.sqrt(1 - damping * damping);
    const phase = damping / Math.sqrt(1 - damping * damping);
    const envelope = Math.exp(-damping * frequency * springTime);
    const displacement = -13 * envelope * (
      Math.cos(dampedFrequency * springTime) +
      phase * Math.sin(dampedFrequency * springTime)
    );
    return springTime > 15 ? 0 : displacement;
  }

  function letterOpacity(frame, delay) {
    return clamp01(frame - 6 - delay + 1);
  }

  function graphemes(text) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((part) => part.segment);
    }
    return [...text];
  }

  const styleText = `
    :host {
      display: inline-block;
      position: relative;
      vertical-align: middle;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0;
      white-space: nowrap;
      user-select: none;
      transform: none;
      margin-inline-start: 0.32em;
    }
    .badge {
      position: absolute;
      inset: 0;
      overflow: hidden;
      transform-origin: 50% 50%;
      visibility: hidden;
    }
    .badge.is-shown { visibility: visible; }
    .paint {
      position: absolute;
      inset: 0;
      isolation: isolate;
    }
    .fill, .shine, .letters { position: absolute; inset: 0; }
    .shine {
      right: auto;
      opacity: 0;
      mix-blend-mode: plus-lighter;
      background: linear-gradient(
        135deg,
        transparent 0%,
        transparent 36.5%,
        rgb(255 255 255 / .06) 39.1%,
        rgb(255 255 255 / .22) 41.7%,
        rgb(255 255 255 / .55) 44.3%,
        rgb(255 255 255 / .9) 47.2%,
        rgb(255 255 255) 49.5%,
        rgb(255 255 255) 50.5%,
        rgb(255 255 255 / .9) 52.8%,
        rgb(255 255 255 / .55) 55.7%,
        rgb(255 255 255 / .22) 58.3%,
        rgb(255 255 255 / .06) 60.9%,
        transparent 63.5%,
        transparent 100%
      );
      will-change: transform, opacity;
    }
    .name {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }
    .letters {
      display: flex;
      align-items: center;
      justify-content: center;
      font: inherit;
      font-weight: 700;
      line-height: 1;
    }
    .fit { position: relative; }
    .word {
      visibility: hidden;
      white-space: pre;
    }
    .letter {
      position: absolute;
      top: 0;
      white-space: pre;
      will-change: transform;
    }
    .badge.is-settled .word { visibility: visible; }
    .badge.is-settled .letter { visibility: hidden; }
  `;

  class GlimletBadge extends HTMLElement {
    static get version() { return VERSION; }
    static get observedAttributes() { return ["fill", "ink", "em"]; }

    constructor() {
      super();
      this._built = false;
      this._played = false;
      this._playing = false;
      this._frame = 0;
      this._raf = 0;
      this._timer = 0;
      this._last = 0;
      this._inView = false;
      this._u = 1;
      this._width = 0;
      this._letters = [];
    }

    connectedCallback() {
      if (this._built) {
        if (!this._played && !this._reduced && this._text) this._arm();
        return;
      }
      const boot = () => {
        if (!this.isConnected || this._built) return;
        this._build();
        if (this._reduced || !this._text) {
          this._showFinal();
          return;
        }
        this._arm();
      };
      // During parsing, connectedCallback runs on the opening tag, before the
      // label text exists. Wait until the document has the element's contents.
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
      } else {
        boot();
      }
    }

    disconnectedCallback() {
      this._stopClock();
      clearTimeout(this._timer);
      this._timer = 0;
      this._observer?.disconnect();
    }

    attributeChangedCallback(name) {
      if (!this._built) return;
      if (name === "fill" || name === "ink") this._applyColors();
      if (name === "em") this._measure();
    }

    _build() {
      this._built = true;
      this._text = (this.textContent || "").replace(/\s+/g, " ").trim();
      this._reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const root = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = styleText;
      const badge = document.createElement("div");
      badge.className = "badge";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = this._text;
      badge.innerHTML = '<div class="paint"><div class="fill"></div><div class="shine"></div></div><div class="letters" aria-hidden="true"></div>';
      root.append(style, name, badge);
      this._badge = badge;
      this._shine = badge.querySelector(".shine");
      this._letterBox = badge.querySelector(".letters");

      const fit = document.createElement("span");
      fit.className = "fit";
      const word = document.createElement("span");
      word.className = "word";
      word.textContent = this._text;
      fit.append(word);
      this._letterBox.append(fit);
      this._fit = fit;
      this._word = word;

      const chars = graphemes(this._text);
      const count = chars.length;
      const stagger = count > 1 ? LAUNCH_WINDOW / (count - 1) : 0;
      this._letters = chars.map((character, index) => {
        const letter = document.createElement("span");
        letter.className = "letter";
        letter.textContent = character;
        letter.dataset.delay = String(index * stagger);
        fit.append(letter);
        return letter;
      });

      this._applyColors();
      this._measure();
      this._fonts = document.fonts?.ready?.then(() => {
        if (this.isConnected && !this._playing && !this._played) this._measure();
      }) ?? Promise.resolve();
    }

    _applyColors() {
      const fill = this.getAttribute("fill") || "oklch(0.82 0.055 255)";
      const ink = this.getAttribute("ink") || "#192548";
      this._badge.querySelector(".fill").style.background = fill;
      this._letterBox.style.color = ink;
    }

    _measure() {
      const computed = getComputedStyle(this);
      const lineSize = parseFloat(computed.fontSize) || 16;
      const emAttr = parseFloat(this.getAttribute("em"));
      const em = Number.isFinite(emAttr) && emAttr > 0 ? emAttr : 1.1;
      const height = em * lineSize;
      this._u = height / 46;
      const letterSize = REF_FONT * this._u;
      this._letterBox.style.fontSize = `${letterSize}px`;
      this._letterBox.style.fontFamily = computed.fontFamily;
      this._width = Math.ceil(this._word.getBoundingClientRect().width + 28 * this._u);
      this.style.width = `${this._width}px`;
      this.style.height = `${height}px`;
      // Center on capital height of the surrounding font, not on line-height.
      this.style.verticalAlign = `calc(0.5cap - ${height / 2}px)`;
      this._badge.style.borderRadius = `${12 * this._u}px`;
      this._placeLetters();
      const shineWidth = SHINE * this._u;
      this._shine.style.width = `${shineWidth}px`;
      this._shine.style.left = `${-shineWidth}px`;
    }

    _placeLetters() {
      const node = this._word.firstChild;
      if (!node) return;
      const origin = this._fit.getBoundingClientRect();
      const range = document.createRange();
      const chars = graphemes(this._text);
      let index = 0;
      this._letters.forEach((letter, i) => {
        const unit = chars[i];
        range.setStart(node, index);
        range.setEnd(node, index + unit.length);
        index += unit.length;
        const box = range.getBoundingClientRect();
        letter.style.left = `${box.left - origin.left}px`;
      });
    }

    _arm() {
      if (this._played || this._playing || this._reduced || !this._text) return;
      if (!this._observer) {
        this._observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            this._inView = entry.isIntersecting && entry.intersectionRatio >= VIEW_RATIO;
            if (this._inView && !this._played && !this._playing && !this._timer) {
              this._timer = setTimeout(() => {
                this._timer = 0;
                if (this._inView && !this._played) this._play();
              }, START_DELAY);
            } else if (!this._inView && this._timer) {
              clearTimeout(this._timer);
              this._timer = 0;
            }
          }
        }, { threshold: [0, VIEW_RATIO, 1] });
      }
      this._observer.observe(this);
    }

    _play() {
      if (this._played || this._playing) return;
      this._playing = true;
      this._fonts.then(() => {
        if (!this.isConnected || this._played) {
          this._playing = false;
          return;
        }
        this._observer?.disconnect();
        this._measure();
        this._badge.classList.add("is-shown");
        this._frame = 0;
        this._last = 0;
        this._paint(0);
        this._raf = requestAnimationFrame((now) => this._tick(now));
      });
    }

    _tick(now) {
      if (!this._playing) return;
      if (!this._last) this._last = now;
      const elapsed = now - this._last;
      this._last = now;
      this._frame += elapsed / FRAME_MS;
      if (this._frame >= LAST) {
        this._frame = LAST;
        this._paint(LAST);
        this._playing = false;
        this._played = true;
        this._raf = 0;
        return;
      }
      this._paint(this._frame);
      this._raf = requestAnimationFrame((time) => this._tick(time));
    }

    _stopClock() {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._playing = false;
    }

    _showFinal() {
      this._measure();
      this._badge.classList.add("is-shown", "is-settled");
      this._paint(LAST);
      this._played = true;
    }

    _paint(frame) {
      const scale = sample(arrivalScale, frame);
      this._badge.style.transform = `scale(${scale})`;
      for (const letter of this._letters) {
        const delay = Number(letter.dataset.delay);
        const y = letterOffset(frame, delay) * this._u;
        letter.style.transform = `translateY(${y.toFixed(3)}px)`;
        letter.style.opacity = letterOpacity(frame, delay).toFixed(3);
      }
      if (frame >= 22 && frame <= 40) {
        const progress = (frame - 22) / 18;
        this._shine.style.opacity = String(Math.min(1, Math.sin(Math.PI * progress) * 1.45));
        this._shine.style.transform = `translateX(${progress * (this._width + SHINE * this._u)}px)`;
      } else {
        this._shine.style.opacity = "0";
        this._shine.style.transform = "translateX(0)";
      }
    }
  }

  customElements.define(TAG, GlimletBadge);
})();
