(function () {
  var s = document.currentScript;
  if (!s || window.__bcWidget) return;
  window.__bcWidget = true;

  var brand = s.getAttribute("data-brand-id") || "";
  var origin = new URL(s.src).origin;
  var color = s.getAttribute("data-color") || "#1f6f5c";
  var requireConsent = s.getAttribute("data-require-consent") === "true";
  var open = false;
  var parentOrigin = location.origin;
  var historyPatched = false;
  var frame = null;
  var btn = null;
  var widgetReady = false;
  var bootStartedAt = Date.now();

  function trackingAllowed() {
    if (!requireConsent) return true;
    try {
      return !!(window.BrandConnect && window.BrandConnect.trackingConsent === true);
    } catch (e) {
      return false;
    }
  }

  function sanitizePath(pathname) {
    try {
      var p = String(pathname || "/").split("?")[0].split("#")[0];
      return p.charAt(0) === "/" ? p : "/" + p;
    } catch (e) {
      return "/";
    }
  }

  function postToFrame(payload) {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage(
        Object.assign({ source: "brandconnect-loader" }, payload),
        origin
      );
    } catch (e) { /* ignore */ }
  }

  function notifyPage() {
    postToFrame({ type: "bc:page", page: sanitizePath(location.pathname) });
  }

  function notifyChatState() {
    postToFrame({ type: "bc:chat-state", open: open });
  }

  /** Host page visibility — not chat open/closed. Closed popup must stay online. */
  function notifyHostVisibility() {
    var visible = true;
    try {
      visible = document.visibilityState !== "hidden";
    } catch (e) { /* ignore */ }
    postToFrame({ type: "bc:host-visibility", visible: visible });
  }

  /** Replay authoritative host state after the iframe listener is ready. */
  function replayHostState() {
    postToFrame({
      type: "bc:host-state",
      page: sanitizePath(location.pathname),
      open: open,
      visible: (function () {
        try {
          return document.visibilityState !== "hidden";
        } catch (e) {
          return true;
        }
      })(),
      parentOrigin: parentOrigin,
      loaderBootMs: Date.now() - bootStartedAt,
    });
    notifyPage();
    notifyChatState();
    notifyHostVisibility();
  }

  /**
   * Keep the iframe in the document and navigated on page load.
   * Closed chrome stays display:block (off-screen + opacity 0).
   */
  function applyFrameChrome() {
    if (!frame) return;
    frame.style.position = "fixed";
    frame.style.width = "370px";
    frame.style.height = "540px";
    frame.style.maxWidth = "calc(100vw - 40px)";
    frame.style.maxHeight = "calc(100vh - 120px)";
    frame.style.border = "0";
    frame.style.borderRadius = "16px";
    frame.style.zIndex = "2147483646";
    frame.style.background = "#fff";
    if (open) {
      frame.style.display = "block";
      frame.style.opacity = "1";
      frame.style.pointerEvents = "auto";
      frame.style.bottom = "92px";
      frame.style.right = "20px";
      frame.style.left = "auto";
      frame.style.top = "auto";
      frame.style.boxShadow = "0 12px 40px rgba(0,0,0,.18)";
    } else {
      frame.style.display = "block";
      frame.style.opacity = "0";
      frame.style.pointerEvents = "none";
      frame.style.left = "-10000px";
      frame.style.top = "0";
      frame.style.bottom = "auto";
      frame.style.right = "auto";
      frame.style.boxShadow = "none";
    }
  }

  function patchHistoryOnce() {
    if (historyPatched) return;
    historyPatched = true;
    var push = history.pushState;
    var replace = history.replaceState;
    history.pushState = function () {
      var r = push.apply(this, arguments);
      notifyPage();
      return r;
    };
    history.replaceState = function () {
      var r = replace.apply(this, arguments);
      notifyPage();
      return r;
    };
    window.addEventListener("popstate", notifyPage);
  }

  function isCloseMessage(data) {
    if (data === "bc:close") return true;
    return !!(
      data &&
      typeof data === "object" &&
      data.type === "bc:close" &&
      data.source === "brandconnect-widget"
    );
  }

  function isReadyMessage(data) {
    return !!(
      data &&
      typeof data === "object" &&
      data.type === "bc:widget-ready" &&
      data.source === "brandconnect-widget"
    );
  }

  function boot() {
    if (window.__bcWidgetBooted) return;
    window.__bcWidgetBooted = true;

    frame = document.createElement("iframe");
    frame.title = "Chat with us";
    frame.setAttribute("allow", "clipboard-write");
    applyFrameChrome();

    // Register load BEFORE append/src so a cached/fast load cannot be missed.
    frame.addEventListener("load", function () {
      // Prefer handshake; still nudge state in case ready arrived before this.
      if (widgetReady) replayHostState();
      else {
        notifyPage();
        notifyChatState();
        notifyHostVisibility();
      }
    });

    btn = document.createElement("button");
    btn.setAttribute("aria-label", "Open chat");
    btn.style.cssText =
      "position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;z-index:2147483647;box-shadow:0 6px 20px rgba(0,0,0,.2);color:#fff;background:" +
      color;
    var chatIcon =
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    var closeIcon =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    btn.innerHTML = chatIcon;
    btn.onclick = function () {
      open = !open;
      applyFrameChrome();
      btn.innerHTML = open ? closeIcon : chatIcon;
      btn.setAttribute("aria-label", open ? "Close chat" : "Open chat");
      if (open) {
        postToFrame({ type: "bc:parent-origin", parentOrigin: parentOrigin });
      }
      notifyChatState();
      notifyHostVisibility();
      if (widgetReady) replayHostState();
    };

    window.addEventListener("message", function (e) {
      if (e.origin !== origin) return;
      if (!frame || e.source !== frame.contentWindow) return;
      if (isReadyMessage(e.data)) {
        widgetReady = true;
        replayHostState();
        return;
      }
      if (!isCloseMessage(e.data)) return;
      if (open) btn.onclick();
    });

    document.addEventListener("visibilitychange", function () {
      notifyHostVisibility();
      if (widgetReady) replayHostState();
    });

    function append() {
      if (!document.body) {
        document.addEventListener("DOMContentLoaded", append);
        return;
      }
      document.body.appendChild(frame);
      document.body.appendChild(btn);
      patchHistoryOnce();
      // Navigate after insert + load listener — presence must not wait for launcher click.
      frame.src =
        origin +
        "/widget?brand=" +
        encodeURIComponent(brand) +
        "&page=" +
        encodeURIComponent(sanitizePath(location.pathname)) +
        (location.search.indexOf("diag=1") >= 0 || location.search.indexOf("diag=true") >= 0
          ? "&diag=1"
          : "");
    }
    append();
  }

  if (!trackingAllowed()) {
    window.BrandConnect = window.BrandConnect || {};
    window.BrandConnect.enableTracking = function () {
      if (window.BrandConnect) window.BrandConnect.trackingConsent = true;
      boot();
    };
    return;
  }

  boot();
})();
