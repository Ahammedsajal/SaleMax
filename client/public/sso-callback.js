(function () {
  "use strict";

  var message = document.getElementById("message");
  var confirmation = document.getElementById("confirmation");
  var identityLabel = document.getElementById("identity");
  var continueButton = document.getElementById("continue");
  var isArabic = /^ar(?:-|$)/i.test(document.documentElement.lang || "");
  var code = new URLSearchParams(window.location.search).get("code") || "";
  var verifier = new URLSearchParams(window.location.hash.slice(1)).get("code_verifier") || "";
  var payload = null;

  window.history.replaceState(null, "", "/sso/callback");

  function fail(text) {
    message.textContent = text || (isArabic
      ? "انتهت صلاحية رابط تسجيل الدخول أو تعذر التحقق منه. ارجع إلى نظام إدارة العملاء وحاول مرة أخرى."
      : "This sign-in link expired or could not be verified. Return to CRM and try again.");
  }

  function saveSession() {
    if (!payload || !payload.token) return;
    if (payload.identity.role === "agent") {
      window.localStorage.removeItem("wacrm_user");
      window.localStorage.setItem("wacrm_agent", payload.token);
      window.location.replace("/agent");
      return;
    }
    window.localStorage.removeItem("wacrm_agent");
    window.localStorage.setItem("wacrm_user", payload.token);
    window.location.replace("/user");
  }

  if (!/^[a-f0-9]{64}$/.test(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    fail("This sign-in link is incomplete. Return to CRM and try again.");
    return;
  }

  fetch("/sso/callback/consume", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ code: code, code_verifier: verifier }),
  }).then(function (response) {
    return response.json().then(function (data) {
      if (!response.ok || !data.success || !data.token || !data.identity) {
        throw new Error(data.message || "Sign-in could not be verified.");
      }
      return data;
    });
  }).then(function (data) {
    payload = data;
    message.hidden = true;
    identityLabel.textContent = isArabic
      ? "متابعة إلى واتساب باسم " + data.identity.name + " (" + data.identity.email + ")؟"
      : "Continue to WhatsApp as " + data.identity.name + " (" + data.identity.email + ")?";
    confirmation.hidden = false;

    var currentToken = window.localStorage.getItem(data.identity.role === "agent" ? "wacrm_agent" : "wacrm_user");
    if (currentToken) {
      try {
        var currentClaims = JSON.parse(atob(currentToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (currentClaims.uid === data.identity.uid && currentClaims.role === data.identity.role) {
          saveSession();
        }
      } catch (error) {
        // A stale or malformed browser token needs explicit confirmation.
      }
    }
  }).catch(function (error) {
    fail(error.message);
  });

  continueButton.addEventListener("click", saveSession);
})();
