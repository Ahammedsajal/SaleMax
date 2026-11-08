import * as THREE from "three";

(() => {
  "use strict";

  const hero = document.querySelector(".hero");
  const host = document.getElementById("hero-scene-canvas");
  const fallback = document.getElementById("hero-scene-fallback");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!hero || !host || !fallback) return;

  const layers = [
    { id: "pipeline", file: "01-crm-pipeline-sales.webp", aspect: 543 / 435, from: [0, -0.025, -65], front: 62, factor: 0.67, mobile: 0.66, scale: 1.04 },
    { id: "campaigns", file: "02-whatsapp-campaigns.webp", aspect: 489 / 338, from: [-0.055, 0.045, -48], front: -35, factor: 0.33, mobile: 0.40, scale: 0.91 },
    { id: "bots", file: "03-ai-chatbot.webp", aspect: 471 / 353, from: [0.055, 0.04, -60], front: -42, factor: 0.32, mobile: 0.40, scale: 0.88 },
    { id: "followup", file: "04-follow-up-automation.webp", aspect: 504 / 382, from: [-0.055, -0.045, -48], front: -38, factor: 0.32, mobile: 0.40, scale: 0.89 },
    { id: "inbox", file: "05-unified-inbox.webp", aspect: 541 / 389, from: [-0.025, -0.055, -45], front: 12, factor: 0.31, mobile: 0.38, scale: 0.87 },
    { id: "invoices", file: "06-invoicing-payments.webp", aspect: 516 / 408, from: [0.055, -0.045, -52], front: -32, factor: 0.31, mobile: 0.38, scale: 0.88 },
  ];
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const smooth = (value) => value * value * (3 - 2 * value);
  let renderer, camera, scene, cards = [], observer, resizeObserver, frame = 0;
  let visible = false, disposed = false, progress = 0, targetProgress = 0;
  let pointerX = 0, pointerY = 0, targetPointerX = 0, targetPointerY = 0, lastFrameAt = 0;

  function readProgress() {
    const heroTop = hero.getBoundingClientRect().top + window.scrollY;
    const travel = Math.max(window.innerHeight * 0.72, 1);
    targetProgress = clamp((window.scrollY - heroTop) / travel, 0, 1);
    requestRender();
  }

  function layout() {
    if (!renderer || !host.clientWidth || !host.clientHeight) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    const mobile = width <= 620;
    const artWidth = width * (mobile ? 0.92 : 0.55);
    const artHeight = height * (mobile ? 0.62 : 0.82);
    const rtl = hero.closest('[dir="rtl"]') || document.documentElement.dir === "rtl";
    const anchorX = mobile ? 0 : width * (rtl ? -0.235 : 0.235);
    const anchorY = mobile ? -height * 0.22 : 0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.2 : 1.45));
    renderer.setSize(width, height, false);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();

    const points = [
      [anchorX, anchorY],
      [anchorX - artWidth * 0.31, anchorY + artHeight * 0.275],
      [anchorX + artWidth * 0.31, anchorY + artHeight * 0.265],
      [anchorX - artWidth * 0.32, anchorY - artHeight * 0.265],
      [anchorX - artWidth * 0.035, anchorY - artHeight * 0.305],
      [anchorX + artWidth * 0.32, anchorY - artHeight * 0.26],
    ];
    cards.forEach((card, index) => {
      const spec = layers[index];
      const cardWidth = artWidth * (mobile ? spec.mobile : spec.factor);
      const cardHeight = cardWidth / spec.aspect;
      card.mesh.geometry.dispose();
      card.mesh.geometry = new THREE.PlaneGeometry(cardWidth, cardHeight);
      card.base = { x: points[index][0], y: points[index][1], z: spec.front };
      card.start = {
        x: card.base.x + spec.from[0] * artWidth,
        y: card.base.y + spec.from[1] * artHeight,
        z: card.base.z + spec.from[2],
      };
      card.targetScale = spec.scale;
    });
    draw(smooth(progress), performance.now());
  }

  function draw(amount, now) {
    if (!renderer || !scene || !visible || disposed) return;
    const seconds = now / 1000;
    cards.forEach((card) => {
      const lerp = (a, b) => a + (b - a) * amount;
      const phase = card.phase;
      card.group.position.set(
        lerp(card.start.x, card.base.x) + Math.sin(seconds * 0.54 + phase) * 3.4 + pointerX * 7,
        lerp(card.start.y, card.base.y) + Math.sin(seconds * 0.7 + phase) * 4.8 - pointerY * 6,
        lerp(card.start.z, card.base.z),
      );
      card.group.scale.setScalar(lerp(card.targetScale * 0.93, card.targetScale, amount));
      card.group.rotation.x = lerp(card.baseRotation.x + 0.035, card.baseRotation.x, amount)
        + pointerY * 0.014 + Math.sin(seconds * 0.48 + phase) * 0.003;
      card.group.rotation.y = lerp(card.baseRotation.y - 0.04, card.baseRotation.y, amount)
        + pointerX * 0.02 + Math.cos(seconds * 0.52 + phase) * 0.004;
      card.material.opacity = lerp(0.72, 1, amount);
    });
    renderer.render(scene, camera);
  }

  function tick(now) {
    frame = 0;
    if (!visible || disposed || !renderer) return;
    if (now - lastFrameAt < 1000 / 30) {
      frame = window.requestAnimationFrame(tick);
      return;
    }
    lastFrameAt = now;
    const difference = targetProgress - progress;
    progress = Math.abs(difference) < 0.001 ? targetProgress : progress + difference * 0.12;
    pointerX += (targetPointerX - pointerX) * 0.09;
    pointerY += (targetPointerY - pointerY) * 0.09;
    draw(smooth(progress), now);
    requestRender();
  }

  function requestRender() {
    if (frame || !visible || disposed || !renderer) return;
    frame = window.requestAnimationFrame(tick);
  }

  function readPointer(event) {
    if (event.pointerType === "touch") return;
    const rect = hero.getBoundingClientRect();
    targetPointerX = clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1);
    targetPointerY = clamp(((event.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1);
    requestRender();
  }

  function resetPointer() {
    targetPointerX = 0;
    targetPointerY = 0;
    requestRender();
  }

  function onVisibilityChange() {
    if (document.hidden && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      requestRender();
    }
  }

  function stop() {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    observer?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener("scroll", readProgress);
    window.removeEventListener("resize", readProgress);
    window.removeEventListener("pointermove", readPointer);
    hero.removeEventListener("pointerleave", resetPointer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    cards.forEach(({ mesh, material, group }) => {
      group.remove(mesh);
      mesh.geometry.dispose();
      material.map?.dispose();
      material.dispose();
    });
    cards = [];
    renderer?.dispose();
    renderer?.domElement.remove();
    renderer = camera = scene = null;
    host.dataset.ready = "false";
    fallback.hidden = false;
  }

  async function start() {
    if (reducedMotion.matches || renderer || disposed) return;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: window.innerWidth > 700,
        powerPreference: "low-power",
        premultipliedAlpha: true,
      });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.setAttribute("role", "presentation");
      host.replaceChildren(renderer.domElement);
      renderer.domElement.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        stop();
      }, { once: true });
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
      camera.position.z = 1200;
      scene = new THREE.Scene();
      const loader = new THREE.TextureLoader();
      const loaded = await Promise.all(layers.map((spec) => loader.loadAsync(
        `/website/media/hero-3d-7network/layers/${spec.file}`,
      ).then((texture) => ({ spec, texture }), () => null)));
      if (disposed || loaded.some((item) => !item)) {
        stop();
        return;
      }
      loaded.forEach(({ spec, texture }, index) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          alphaTest: 0.012,
          opacity: 1,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const geometry = new THREE.PlaneGeometry(1, 1);
        const mesh = new THREE.Mesh(geometry, material);
        const group = new THREE.Group();
        group.add(mesh);
        group.position.z = spec.front;
        group.renderOrder = spec.id === "pipeline" ? 20 : index + 1;
        scene.add(group);
        cards.push({
          group,
          mesh,
          material,
          phase: index * 1.07,
          baseRotation: new THREE.Euler(index % 2 ? 0.035 : -0.025, index % 2 ? -0.04 : 0.035, 0),
        });
      });
      resizeObserver = new ResizeObserver(layout);
      resizeObserver.observe(host);
      observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) requestRender();
        else if (frame) { cancelAnimationFrame(frame); frame = 0; }
      }, { threshold: 0.01 });
      observer.observe(hero);
      window.addEventListener("scroll", readProgress, { passive: true });
      window.addEventListener("resize", readProgress, { passive: true });
      window.addEventListener("pointermove", readPointer, { passive: true });
      hero.addEventListener("pointerleave", resetPointer);
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("pagehide", stop, { once: true });
      layout();
      readProgress();
      host.dataset.ready = "true";
      fallback.hidden = true;
    } catch (_) {
      stop();
    }
  }

  reducedMotion.addEventListener("change", (event) => {
    if (event.matches) stop();
    else { disposed = false; start(); }
  });
  start();
})();
