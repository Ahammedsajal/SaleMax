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

  function readProgress() {
    const rect = hero.getBoundingClientRect();
    const travel = Math.max(rect.height - window.innerHeight, 1);
    targetProgress = clamp(-rect.top / travel, 0, 1);
    requestRender();
  }

  function layout() {
    if (!renderer || !host.clientWidth || !host.clientHeight) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    const mobile = width <= 620;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.6));
    renderer.setSize(width, height, false);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();

    const points = [
      [0, 0],
      [-width * 0.31, height * 0.275],
      [width * 0.31, height * 0.265],
      [-width * 0.32, -height * 0.265],
      [-width * 0.035, -height * 0.305],
      [width * 0.32, -height * 0.26],
    ];
    cards.forEach((card, index) => {
      const spec = layers[index];
      const cardWidth = width * (mobile ? spec.mobile : spec.factor);
      const cardHeight = cardWidth / spec.aspect;
      card.mesh.geometry.dispose();
      card.mesh.geometry = new THREE.PlaneGeometry(cardWidth, cardHeight);
      card.base = { x: points[index][0], y: points[index][1], z: spec.front };
      card.start = {
        x: card.base.x + spec.from[0] * width,
        y: card.base.y + spec.from[1] * height,
        z: card.base.z + spec.from[2],
      };
      card.targetScale = spec.scale;
    });
    draw(smooth(progress));
  }

  function draw(amount) {
    if (!renderer || !scene || !visible || disposed) return;
    cards.forEach((card) => {
      const lerp = (a, b) => a + (b - a) * amount;
      card.group.position.set(
        lerp(card.start.x, card.base.x),
        lerp(card.start.y, card.base.y),
        lerp(card.start.z, card.base.z),
      );
      card.group.scale.setScalar(lerp(card.targetScale * 0.93, card.targetScale, amount));
      card.group.rotation.x = lerp(card.baseRotation.x + 0.035, card.baseRotation.x, amount);
      card.group.rotation.y = lerp(card.baseRotation.y - 0.04, card.baseRotation.y, amount);
      card.material.opacity = lerp(0.72, 1, amount);
    });
    renderer.render(scene, camera);
  }

  function requestRender() {
    if (frame || !visible || disposed || !renderer) return;
    frame = window.requestAnimationFrame(function tick() {
      frame = 0;
      const difference = targetProgress - progress;
      progress = Math.abs(difference) < 0.001 ? targetProgress : progress + difference * 0.14;
      draw(smooth(progress));
      if (Math.abs(targetProgress - progress) >= 0.001) requestRender();
    });
  }

  function stop() {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    observer?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener("scroll", readProgress);
    window.removeEventListener("resize", readProgress);
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
