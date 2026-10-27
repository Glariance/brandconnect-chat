(function () {
  var s = document.currentScript;
  if (!s || window.__bcWidget) return;
  window.__bcWidget = true;
  var brand = s.getAttribute("data-brand-id") || "";
  var origin = new URL(s.src).origin;
  var color = s.getAttribute("data-color") || "#1f6f5c";
  var open = false;
  var parentOrigin = location.origin;

  var frame = document.createElement("iframe");
  frame.src = origin + "/widget?brand=" + encodeURIComponent(brand) + "&page=" + encodeURIComponent(location.pathname);
  frame.title = "Chat with us";
  frame.setAttribute("allow", "clipboard-write");
  frame.style.cssText = "position:fixed;bottom:92px;right:20px;width:370px;height:540px;max-width:calc(100vw - 40px);max-height:calc(100vh - 120px);border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);z-index:2147483646;display:none;background:#fff";

  var btn = document.createElement("button");
  btn.setAttribute("aria-label", "Open chat");
  btn.style.cssText = "position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;z-index:2147483647;box-shadow:0 6px 20px rgba(0,0,0,.2);color:#fff;background:" + color;
  var chatIcon = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var closeIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  btn.innerHTML = chatIcon;
  btn.onclick = function () {
    open = !open;
    frame.style.display = open ? "block" : "none";
    btn.innerHTML = open ? closeIcon : chatIcon;
    btn.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    if (open && frame.contentWindow) {
      frame.contentWindow.postMessage(
        { type: "bc:parent-origin", source: "brandconnect-loader", parentOrigin: parentOrigin },
        origin
      );
    }
  };

  function isCloseMessage(data) {
    if (data === "bc:close") return true;
    return !!(data && typeof data === "object" && data.type === "bc:close" && data.source === "brandconnect-widget");
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== origin) return;
    if (e.source !== frame.contentWindow) return;
    if (!isCloseMessage(e.data)) return;
    if (open) btn.onclick();
  });

  document.body.appendChild(frame);
  document.body.appendChild(btn);
})();
