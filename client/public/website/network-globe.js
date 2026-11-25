(() => {
  "use strict";

  const globe = document.getElementById("network-globe");
  const world = document.getElementById("network-globe-world");
  const toggle = document.getElementById("network-globe-toggle");
  if (!globe || !world || !toggle) return;

  const stories = [
    {
      src: "/website/media/team-ownership.webp",
      width: 1280,
      height: 853,
      en: "TEAM",
      ar: "الفريق",
      symbol: "7N",
      featureEn: "TEAM",
      featureAr: "الفريق",
    },
    {
      src: "/website/media/network-globe/training-workshop.webp",
      width: 480,
      height: 853,
      en: "TRAINING",
      ar: "التدريب",
      symbol: "LEARN",
      featureEn: "COURSES",
      featureAr: "دورات",
    },
    {
      src: "/website/media/network-globe/cafe-service.webp",
      width: 480,
      height: 853,
      en: "SERVICE",
      ar: "الخدمة",
      symbol: "INBOX",
      featureEn: "SERVICE",
      featureAr: "خدمة",
    },
    {
      src: "/website/media/customer-enquiry-owner.webp",
      width: 1280,
      height: 853,
      en: "ENQUIRIES",
      ar: "الاستفسارات",
      symbol: "CRM",
      featureEn: "SALES",
      featureAr: "مبيعات",
    },
    {
      src: "/website/media/network-globe/retail-boutique.webp",
      width: 480,
      height: 853,
      en: "RETAIL",
      ar: "التجزئة",
      symbol: "SHOP",
      featureEn: "RETAIL",
      featureAr: "تجزئة",
    },
    {
      src: "/website/media/team-follow-up.webp",
      width: 1280,
      height: 853,
      en: "FOLLOW-UP",
      ar: "المتابعة",
      symbol: "NEXT",
      featureEn: "TASKS",
      featureAr: "مهام",
    },
    {
      src: "/website/media/customer-relationship.webp",
      width: 1280,
      height: 853,
      en: "CUSTOMERS",
      ar: "العملاء",
      symbol: "CARE",
      featureEn: "CARE",
      featureAr: "عملاء",
    },
    {
      src: "/website/media/founder.webp",
      width: 1280,
      height: 853,
      en: "WORKFLOWS",
      ar: "سير العمل",
      symbol: "FLOW",
      featureEn: "AUTO",
      featureAr: "أتمتة",
    },
    {
      src: "/website/media/network-globe/property-consultation.webp",
      width: 480,
      height: 853,
      en: "PROPERTY",
      ar: "العقارات",
      symbol: "CRM",
      featureEn: "LEADS",
      featureAr: "استفسارات",
    },
    {
      src: "/website/media/network-globe/customer-support.webp",
      width: 480,
      height: 853,
      en: "SUPPORT",
      ar: "الدعم",
      symbol: "INBOX",
      featureEn: "REPLIES",
      featureAr: "ردود",
    },
    {
      src: "/website/media/network-globe/agency-workshop.webp",
      width: 480,
      height: 853,
      en: "CREATIVE",
      ar: "إبداع",
      symbol: "FLOW",
      featureEn: "CAMPAIGNS",
      featureAr: "حملات",
    },
    {
      src: "/website/media/network-globe/salon-consultation.webp",
      width: 480,
      height: 853,
      en: "SALON",
      ar: "صالون",
      symbol: "CARE",
      featureEn: "SERVICE",
      featureAr: "خدمة",
    },
    {
      src: "/website/media/network-globe/home-goods-retail.webp",
      width: 480,
      height: 853,
      en: "HOME GOODS",
      ar: "مستلزمات منزلية",
      symbol: "SHOP",
      featureEn: "SALES",
      featureAr: "مبيعات",
    },
    {
      src: "/website/media/network-globe/trainer-class.webp",
      width: 480,
      height: 853,
      en: "LEARNING",
      ar: "التدريب",
      symbol: "LEARN",
      featureEn: "COURSES",
      featureAr: "دورات",
    },
    {
      src: "/website/media/network-globe/event-coordination.webp",
      width: 480,
      height: 853,
      en: "EVENTS",
      ar: "فعاليات",
      symbol: "TEAM",
      featureEn: "TEAM",
      featureAr: "فريق",
    },
    {
      src: "/website/media/network-globe/auto-service.webp",
      width: 480,
      height: 853,
      en: "AUTO SERVICE",
      ar: "خدمة السيارات",
      symbol: "NEXT",
      featureEn: "FOLLOW-UP",
      featureAr: "متابعة",
    },
    {
      src: "/website/media/network-globe/bakery-team.webp",
      width: 480,
      height: 853,
      en: "BAKERY",
      ar: "مخبز",
      symbol: "FLOW",
      featureEn: "ORDERS",
      featureAr: "طلبات",
    },
  ];
  const latitudes = [-63, -45, -27, -9, 9, 27, 45, 63];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  let rotationX = -8;
  let rotationY = -18;
  let paused = reducedMotion.matches;
  let visible = !("IntersectionObserver" in window);
  let hoveringWithMouse = false;
  let dragging = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let rotationStartX = 0;
  let rotationStartY = 0;
  let frameId = 0;
  let previousFrame = 0;

  function currentLanguage() {
    return document.documentElement.lang === "ar" ? "ar" : "en";
  }

  function updateControlLanguage() {
    const ar = currentLanguage() === "ar";
    toggle.textContent = ar
      ? paused ? "استئناف التدوير" : "إيقاف التدوير"
      : paused ? "Resume rotation" : "Pause rotation";
    toggle.setAttribute("aria-label", ar
      ? paused ? "استئناف تدوير الكرة" : "إيقاف تدوير الكرة"
      : paused ? "Resume globe rotation" : "Pause globe rotation");
    toggle.setAttribute("aria-pressed", String(paused));
    globe.setAttribute("aria-label", ar
      ? "عرض تفاعلي توضيحي لسير أعمال 7Network المترابط"
      : "Interactive illustration of connected 7Network business workflows");
  }

  function updateCardLanguage() {
    const ar = currentLanguage() === "ar";
    world.querySelectorAll(".network-globe-card").forEach((card) => {
      const story = stories[Number(card.dataset.storyIndex)];
      const label = card.querySelector(".network-globe-card-label, .network-globe-card-feature-label");
      if (!story || !label) return;
      const feature = card.classList.contains("network-globe-card--feature");
      label.lang = ar ? "ar" : "en";
      label.textContent = feature
        ? ar ? story.featureAr : story.featureEn
        : ar ? story.ar : story.en;
    });
  }

  function makeCard(story, storyIndex, width, height, transform, feature) {
    const card = document.createElement("div");
    card.className = feature
      ? "network-globe-card network-globe-card--feature"
      : "network-globe-card";
    card.style.width = `${width}px`;
    card.style.height = `${height}px`;
    card.style.transform = transform;
    card.dataset.storyIndex = String(storyIndex);
    card.setAttribute("aria-hidden", "true");

    const inner = document.createElement("div");
    inner.className = "network-globe-card-inner";

    if (feature) {
      const symbol = document.createElement("span");
      symbol.className = "network-globe-card-symbol";
      symbol.textContent = story.symbol;
      const label = document.createElement("span");
      label.className = "network-globe-card-feature-label";
      inner.append(symbol, label);
    } else {
      const image = document.createElement("img");
      image.src = story.src;
      image.alt = "";
      image.width = story.width;
      image.height = story.height;
      image.loading = "lazy";
      image.decoding = "async";
      image.draggable = false;
      const label = document.createElement("span");
      label.className = "network-globe-card-label";
      inner.append(image, label);
    }

    card.append(inner);
    return card;
  }

  function buildGlobe() {
    const size = Math.min(globe.clientWidth, globe.clientHeight);
    if (!size) return;

    const radius = size * 0.44;
    const cardWidth = clamp(size * 0.072, 27, 54);
    const cardHeight = cardWidth * 1.62;
    const spacing = cardWidth + Math.max(5, cardWidth * 0.12);
    const fragment = document.createDocumentFragment();

    latitudes.forEach((latitude, row) => {
      const ringRadius = radius * Math.cos((latitude * Math.PI) / 180);
      const count = Math.max(10, Math.round((2 * Math.PI * ringRadius) / spacing));
      const pitch = 360 / count;
      const offset = row % 2 === 0 ? 0 : pitch / 2;

      for (let column = 0; column < count; column += 1) {
        const storyIndex = (row * 3 + column) % stories.length;
        const story = stories[storyIndex];
        const longitude = column * pitch + offset;
        const feature = (row + column) % 7 === 0;
        const transform = `rotateY(${longitude}deg) rotateX(${latitude}deg) translateZ(${radius}px)`;
        fragment.append(makeCard(story, storyIndex, cardWidth, cardHeight, transform, feature));
      }
    });

    world.replaceChildren(fragment);
    world.style.transform = `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`;
  }

  function shouldAnimate() {
    return visible && !paused && !hoveringWithMouse && !dragging;
  }

  function animate(timestamp) {
    if (!shouldAnimate()) {
      frameId = 0;
      previousFrame = 0;
      return;
    }

    if (previousFrame) {
      const elapsed = Math.min(timestamp - previousFrame, 48);
      rotationY += elapsed * 0.0028;
      world.style.transform = `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`;
    }
    previousFrame = timestamp;
    frameId = window.requestAnimationFrame(animate);
  }

  function updateAnimation() {
    if (shouldAnimate() && !frameId) {
      frameId = window.requestAnimationFrame(animate);
    } else if (!shouldAnimate() && frameId) {
      window.cancelAnimationFrame(frameId);
      frameId = 0;
      previousFrame = 0;
    }
  }

  function setPaused(next) {
    paused = next;
    updateControlLanguage();
    updateAnimation();
  }

  globe.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") hoveringWithMouse = true;
    updateAnimation();
  });
  globe.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") hoveringWithMouse = false;
    if (dragging) finishDrag();
    updateAnimation();
  });
  globe.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    dragging = true;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    rotationStartX = rotationX;
    rotationStartY = rotationY;
    globe.classList.add("is-dragging");
    globe.setPointerCapture?.(event.pointerId);
    updateAnimation();
  });
  globe.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    rotationY = rotationStartY + (event.clientX - pointerStartX) * 0.34;
    rotationX = clamp(rotationStartX + (event.clientY - pointerStartY) * 0.28, -48, 48);
    world.style.transform = `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`;
  });

  function finishDrag() {
    dragging = false;
    globe.classList.remove("is-dragging");
    updateAnimation();
  }

  globe.addEventListener("pointerup", finishDrag);
  globe.addEventListener("pointercancel", finishDrag);
  globe.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 20 : 10;
    if (event.key === "ArrowLeft") rotationY -= step;
    else if (event.key === "ArrowRight") rotationY += step;
    else if (event.key === "ArrowUp") rotationX = clamp(rotationX - step, -48, 48);
    else if (event.key === "ArrowDown") rotationX = clamp(rotationX + step, -48, 48);
    else return;
    event.preventDefault();
    world.style.transform = `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`;
  });

  toggle.addEventListener("click", () => setPaused(!paused));
  reducedMotion.addEventListener("change", (event) => {
    if (event.matches) setPaused(true);
  });
  new MutationObserver(() => {
    updateControlLanguage();
    updateCardLanguage();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      updateAnimation();
    }, { rootMargin: "100px" }).observe(globe);
  }

  if ("ResizeObserver" in window) {
    new ResizeObserver(buildGlobe).observe(globe);
  } else {
    window.addEventListener("resize", buildGlobe, { passive: true });
  }

  buildGlobe();
  updateControlLanguage();
  updateCardLanguage();
  updateAnimation();
})();
