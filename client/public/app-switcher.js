(function () {
  "use strict";
  if (location.hostname === "crm.salemax.qa") return;

  function mount() {
    if (!window.localStorage.getItem("wacrm_user") && !window.localStorage.getItem("wacrm_agent")) return;
    if (document.getElementById("salemax-crm-switch")) return;

    var isArabic = /^ar(?:-|$)/i.test(document.documentElement.lang || "") || document.documentElement.dir === "rtl";
    var link = document.createElement("a");
    link.id = "salemax-crm-switch";
    link.href = "https://crm.gccbot.com/";
    link.textContent = isArabic ? "نظام إدارة العملاء" : "CRM";
    link.setAttribute("aria-label", isArabic ? "فتح نظام إدارة العملاء" : "Open CRM");
    link.style.cssText = [
      "position:fixed",
      "inset-inline-end:22px",
      "bottom:88px",
      "z-index:9999",
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "min-height:48px",
      "padding:0 18px",
      "border:1px solid rgba(255,255,255,.24)",
      "border-radius:999px",
      "background:#a8003b",
      "box-shadow:0 8px 24px rgba(14,55,49,.24)",
      "color:#fff",
      "font:600 14px/1.2 Roboto,Arial,sans-serif",
      "text-decoration:none",
      "transition:transform .18s ease,box-shadow .18s ease"
    ].join(";");
    var status = document.createElement("span");
    status.id = "salemax-crm-switch-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.style.cssText = "display:none;position:fixed;inset-inline-end:22px;bottom:146px;z-index:9999;max-width:min(360px,calc(100vw - 28px));padding:10px 14px;border:1px solid #e6c2c2;border-radius:12px;background:#fff;color:#782f2f;box-shadow:0 8px 24px rgba(14,55,49,.16);font:500 13px/1.5 Roboto,Arial,sans-serif";
    link.addEventListener("click", async function (event) {
      event.preventDefault();
      status.style.display = "none";
      link.setAttribute("aria-busy", "true");
      link.style.pointerEvents = "none";
      try {
        var userToken = window.localStorage.getItem("wacrm_user");
        var agentToken = window.localStorage.getItem("wacrm_agent");
        if (!userToken && !agentToken) throw new Error(isArabic ? "يرجى تسجيل الدخول إلى واتساب أولاً." : "Sign in to WhatsApp first.");
        var isAgent = !userToken && Boolean(agentToken);
        var response = await fetch(isAgent ? "/sso/node/agent-start" : "/sso/node/start", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Accept": "application/json",
            "Authorization": "Bearer " + (isAgent ? agentToken : userToken),
          },
        });
        var result = await response.json();
        if (!response.ok || !result.success || !result.redirect_url) {
          throw new Error(result.message || "CRM sign-in could not be started.");
        }
        window.location.assign(result.redirect_url);
      } catch (error) {
        status.textContent = error.message || (isArabic ? "تعذر فتح نظام إدارة العملاء." : "Unable to open CRM right now.");
        status.style.display = "block";
        link.removeAttribute("aria-busy");
        link.style.pointerEvents = "auto";
      }
    });
    link.addEventListener("mouseenter", function () {
      link.style.transform = "translateY(-2px)";
      link.style.boxShadow = "0 12px 28px rgba(14,55,49,.3)";
    });
    link.addEventListener("mouseleave", function () {
      link.style.transform = "none";
      link.style.boxShadow = "0 8px 24px rgba(14,55,49,.24)";
    });
    function positionForViewport() {
      var mobile = window.matchMedia("(max-width: 600px)").matches;
      link.style.insetInlineEnd = mobile ? "14px" : "22px";
      link.style.bottom = mobile ? "calc(76px + env(safe-area-inset-bottom))" : "88px";
      link.style.minHeight = mobile ? "46px" : "48px";
      link.style.padding = mobile ? "0 15px" : "0 18px";
      link.style.fontSize = mobile ? "13px" : "14px";
      status.style.insetInlineEnd = mobile ? "14px" : "22px";
      status.style.bottom = mobile ? "calc(134px + env(safe-area-inset-bottom))" : "146px";
    }
    positionForViewport();
    window.addEventListener("resize", positionForViewport, { passive: true });
    document.body.appendChild(link);
    document.body.appendChild(status);
  }

  function sync() {
    var userToken = window.localStorage.getItem("wacrm_user");
    var agentToken = window.localStorage.getItem("wacrm_agent");
    var link = document.getElementById("salemax-crm-switch");
    var status = document.getElementById("salemax-crm-switch-status");

    if (!userToken && !agentToken) {
      if (link) link.remove();
      if (status) status.remove();
      return;
    }

    mount();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sync, { once: true });
  } else {
    sync();
  }
  window.setInterval(sync, 1000);
})();


