(() => {
  "use strict";

  const globe = document.getElementById("network-globe");
  const world = document.getElementById("network-globe-world");
  const toggle = document.getElementById("network-globe-toggle");
  if (!globe || !world || !toggle) return;

  const stories = [
    {
      src: "/website/media/network-globe/agency-workshop.webp",
      en: "CREATIVE TEAM",
      ar: "فريق إبداعي",
      altEn: "A creative team planning work together",
      altAr: "فريق إبداعي يخطط للعمل معاً",
    },
    {
      src: "/website/media/network-globe/auto-service.webp",
      en: "AUTO SERVICE",
      ar: "خدمة السيارات",
      altEn: "An automotive service business meeting a customer",
      altAr: "فريق خدمة سيارات يستقبل عميلاً",
    },
    {
      src: "/website/media/network-globe/bakery-team.webp",
      en: "BAKERY",
      ar: "مخبز",
      altEn: "A bakery team preparing an order",
      altAr: "فريق مخبز يجهز طلباً",
    },
    {
      src: "/website/media/network-globe/cafe-service.webp",
      en: "CAFE SERVICE",
      ar: "خدمة المقهى",
      altEn: "A cafe team serving guests",
      altAr: "فريق مقهى يقدم الخدمة للضيوف",
    },
    {
      src: "/website/media/network-globe/customer-support.webp",
      en: "CUSTOMER CARE",
      ar: "خدمة العملاء",
      altEn: "A customer support specialist helping a customer",
      altAr: "مختص دعم يساعد أحد العملاء",
    },
    {
      src: "/website/media/network-globe/event-coordination.webp",
      en: "EVENTS",
      ar: "الفعاليات",
      altEn: "A team coordinating an event",
      altAr: "فريق ينسق فعالية",
    },
    {
      src: "/website/media/network-globe/home-goods-retail.webp",
      en: "HOME RETAIL",
      ar: "مستلزمات منزلية",
      altEn: "A home goods retailer assisting a shopper",
      altAr: "موظف متجر مستلزمات منزلية يساعد متسوقاً",
    },
    {
      src: "/website/media/network-globe/property-consultation.webp",
      en: "PROPERTY",
      ar: "العقارات",
      altEn: "A property advisor discussing options with a client",
      altAr: "مستشار عقاري يناقش الخيارات مع عميل",
    },
    {
      src: "/website/media/network-globe/retail-boutique.webp",
      en: "RETAIL",
      ar: "التجزئة",
      altEn: "A boutique team welcoming a shopper",
      altAr: "فريق متجر أزياء يستقبل متسوقاً",
    },
    {
      src: "/website/media/network-globe/salon-consultation.webp",
      en: "SALON",
      ar: "صالون",
      altEn: "A salon professional consulting with a client",
      altAr: "مختص في صالون يستشير عميلاً",
    },
    {
      src: "/website/media/network-globe/trainer-class.webp",
      en: "TRAINING",
      ar: "التدريب",
      altEn: "An instructor leading a training session",
      altAr: "مدرب يقود جلسة تدريبية",
    },
    {
      src: "/website/media/network-globe/training-workshop.webp",
      en: "LEARNING",
      ar: "التعلم",
      altEn: "A trainer supporting learners in a workshop",
      altAr: "مدرب يدعم المتعلمين في ورشة عمل",
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
  let pointerMoved = false;
  let pointerDownStoryIndex = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let rotationStartX = 0;
  let rotationStartY = 0;
  let frameId = 0;
  let previousFrame = 0;
  let viewerStoryIndex = null;

  const viewer = document.createElement("dialog");
  viewer.className = "network-globe-viewer";
  viewer.setAttribute("aria-label", "Photo preview");

  const viewerClose = document.createElement("button");
  viewerClose.className = "network-globe-viewer__close";
  viewerClose.type = "button";
  viewerClose.textContent = "×";

  const viewerFigure = document.createElement("figure");
  viewerFigure.className = "network-globe-viewer__figure";
  const viewerImage = document.createElement("img");
  viewerImage.className = "network-globe-viewer__image";
  const viewerCaption = document.createElement("figcaption");
  viewerCaption.className = "network-globe-viewer__caption";
  viewerFigure.append(viewerImage, viewerCaption);
  viewer.append(viewerClose, viewerFigure);
  document.body.append(viewer);

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
      ? "كرة صور تفاعلية تعرض أعمال 7Network"
      : "Interactive photo globe showing 7Network businesses");
  }

  function updateCardLanguage() {
    const ar = currentLanguage() === "ar";
    world.querySelectorAll(".network-globe-card").forEach((card) => {
      const story = stories[Number(card.dataset.storyIndex)];
      const label = card.querySelector(".network-globe-card-label");
      if (!story || !label) return;
      label.lang = ar ? "ar" : "en";
      label.textContent = ar ? story.ar : story.en;
    });
  }

  function updateViewerLanguage() {
    if (viewerStoryIndex === null) return;
    const story = stories[viewerStoryIndex];
    if (!story) return;
    const ar = currentLanguage() === "ar";
    viewer.setAttribute("aria-label", ar ? "معاينة الصورة" : "Photo preview");
    viewerClose.setAttribute("aria-label", ar ? "إغلاق الصورة" : "Close photo");
    viewerImage.alt = ar ? story.altAr : story.altEn;
    viewerCaption.lang = ar ? "ar" : "en";
    viewerCaption.textContent = ar
      ? `${story.ar} — ${story.altAr}`
      : `${story.en} — ${story.altEn}`;
  }

  function closeViewer() {
    if (typeof viewer.close === "function" && viewer.open) {
      viewer.close();
      return;
    }
    viewer.removeAttribute("open");
    viewerStoryIndex = null;
    document.body.classList.remove("network-globe-viewer-open");
    globe.focus({ preventScroll: true });
    updateAnimation();
  }

  function openViewer(storyIndex) {
    const story = stories[storyIndex];
    if (!story) return;
    viewerStoryIndex = storyIndex;
    viewerImage.src = story.src;
    updateViewerLanguage();
    document.body.classList.add("network-globe-viewer-open");
    if (!viewer.open) {
      if (typeof viewer.showModal === "function") viewer.showModal();
      else viewer.setAttribute("open", "");
    }
    viewerClose.focus({ preventScroll: true });
    updateAnimation();
  }

  function makeCard(story, storyIndex, width, height, transform, longitude, latitude) {
    const card = document.createElement("div");
    card.className = "network-globe-card";
    card.style.width = `${width}px`;
    card.style.height = `${height}px`;
    card.style.transform = transform;
    card.dataset.storyIndex = String(storyIndex);
    card.dataset.longitude = String(longitude);
    card.dataset.latitude = String(latitude);
    card.setAttribute("aria-hidden", "true");

    const inner = document.createElement("div");
    inner.className = "network-globe-card-inner";
    const image = document.createElement("img");
    image.src = story.src;
    image.alt = "";
    image.width = 480;
    image.height = 853;
    image.loading = "eager";
    image.decoding = "async";
    image.fetchPriority = "low";
    image.draggable = false;
    image.addEventListener("error", () => {
      if (image.dataset.fallbackAttempted === "true") {
        image.removeAttribute("src");
        image.classList.add("is-unavailable");
        return;
      }
      image.dataset.fallbackAttempted = "true";
      image.src = stories[(storyIndex + 1) % stories.length].src;
    });
    const label = document.createElement("span");
    label.className = "network-globe-card-label";
    inner.append(image, label);

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
        const transform = `rotateY(${longitude}deg) rotateX(${latitude}deg) translateZ(${radius}px)`;
        fragment.append(makeCard(story, storyIndex, cardWidth, cardHeight, transform, longitude + offset, latitude));
      }
    });

    world.replaceChildren(fragment);
    world.style.transform = `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`;
    updateCardLanguage();
  }

  function shouldAnimate() {
    return visible && !paused && !hoveringWithMouse && !dragging && !viewer.open;
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
    pointerMoved = false;
    pointerDownStoryIndex = event.target instanceof Element
      ? Number(event.target.closest(".network-globe-card")?.dataset.storyIndex ?? NaN)
      : NaN;
    if (!Number.isInteger(pointerDownStoryIndex)) pointerDownStoryIndex = null;
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
    if (Math.abs(event.clientX - pointerStartX) > 5 || Math.abs(event.clientY - pointerStartY) > 5) {
      pointerMoved = true;
    }
    if (!pointerMoved) return;
    rotationY = rotationStartY + (event.clientX - pointerStartX) * 0.34;
    rotationX = clamp(rotationStartX + (event.clientY - pointerStartY) * 0.28, -48, 48);
    world.style.transform = `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`;
  });

  function finishDrag(openTappedPhoto = false) {
    if (!dragging) return;
    const tappedStory = openTappedPhoto && !pointerMoved ? pointerDownStoryIndex : null;
    dragging = false;
    pointerMoved = false;
    pointerDownStoryIndex = null;
    globe.classList.remove("is-dragging");
    updateAnimation();
    if (tappedStory !== null) openViewer(tappedStory);
  }

  globe.addEventListener("pointerup", () => finishDrag(true));
  globe.addEventListener("pointercancel", () => finishDrag(false));
  globe.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const cards = [...world.querySelectorAll(".network-globe-card")];
      const wrapAngle = (angle) => ((angle + 180) % 360 + 360) % 360 - 180;
      let selectedIndex = 0;
      let closestScore = Number.POSITIVE_INFINITY;
      cards.forEach((card) => {
        const longitude = Number(card.dataset.longitude) + rotationY;
        const latitude = Number(card.dataset.latitude) + rotationX;
        const score = Math.abs(wrapAngle(longitude)) + Math.abs(latitude);
        if (score < closestScore) {
          closestScore = score;
          selectedIndex = Number(card.dataset.storyIndex);
        }
      });
      openViewer(selectedIndex);
      return;
    }
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
  viewerClose.addEventListener("click", closeViewer);
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) closeViewer();
  });
  viewer.addEventListener("close", () => {
    viewerStoryIndex = null;
    document.body.classList.remove("network-globe-viewer-open");
    globe.focus({ preventScroll: true });
    updateAnimation();
  });
  reducedMotion.addEventListener("change", (event) => {
    if (event.matches) setPaused(true);
  });
  new MutationObserver(() => {
    updateControlLanguage();
    updateCardLanguage();
    updateViewerLanguage();
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
