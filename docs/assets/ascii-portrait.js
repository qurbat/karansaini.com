// About page: click/tap (or Enter/Space) the ASCII portrait to view it full-screen.
// External file because the theme's Content-Security-Policy blocks inline scripts.
(function () {
  var fig = document.querySelector(".ascii-portrait");
  if (!fig || typeof HTMLDialogElement !== "function") return;

  var src = fig.querySelector("pre");
  var dlg = document.createElement("dialog");
  dlg.className = "ascii-portrait-full";
  dlg.setAttribute("aria-label", "Self-portrait, enlarged");
  var copy = src.cloneNode(true);
  copy.removeAttribute("tabindex");
  copy.removeAttribute("title");
  dlg.appendChild(copy);
  document.body.appendChild(dlg);

  src.setAttribute("tabindex", "0");
  src.setAttribute("title", "Enlarge");

  function open() { dlg.showModal(); }
  src.addEventListener("click", open);
  src.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });
  dlg.addEventListener("click", function () { dlg.close(); });
  dlg.addEventListener("close", function () { src.focus(); });
})();
