// External script for the imam marriage-contract page served by Google Apps Script
// (marriage/api/Code.gs, handleImamContract). The GAS HtmlService sandbox corrupts
// inline <script> content server-side, so the page's entire logic lives here,
// hosted on alsalamcenter.se. Keep in sync with handleImamContract in Code.gs.

var GAS_URL = "https://script.google.com/macros/s/AKfycbyBdihaThtMfp_qYi16SRr9gP9fd9X9a7yO-PNZLCxMVfukwN9Wja2AN_tPT1HuIqBP/exec";

var FIELD_IDS = [
  "wifeNameInput", "husbandNameInput",
  "wifePersonalIdInput", "husbandPersonalIdInput",
  "wifeBirthPlaceInput", "husbandBirthPlaceInput",
  "wifeMaritalStatusInput", "husbandMaritalStatusInput",
  "deferredDowryInput", "dowryInput",
  "dateInput", "placeInput"
];

var pdfOptions = {
  margin: 0,
  filename: "islamic-marriage-contract.pdf",
  image: { type: "jpeg", quality: 0.98 },
  html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
  jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
};

// ── Signature pads ─────────────────────────────────────────────

function setupSigPad(canvas) {
  var drawing = false, moved = false, lx = 0, ly = 0;

  function resize() {
    var ratio = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(Math.floor(rect.width), 1);
    var h = Math.max(Math.floor(rect.height), 1);
    var existing = canvas.dataset.hasDrawing === "true" ? canvas.toDataURL() : null;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    var ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    ctx.fillStyle = "#111";
    ctx.clearRect(0, 0, w, h);
    if (existing) {
      var img = new Image();
      img.onload = function () { ctx.drawImage(img, 0, 0, w, h); };
      img.src = existing;
    }
  }

  resize();
  canvas.dataset.hasDrawing = "false";

  function pt(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener("pointerdown", function (e) {
    var p = pt(e);
    drawing = true;
    moved = false;
    lx = p.x;
    ly = p.y;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!drawing) return;
    var p = pt(e);
    var ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lx = p.x;
    ly = p.y;
    moved = true;
    canvas.dataset.hasDrawing = "true";
  });

  var stop = function () {
    if (!drawing) return;
    if (!moved) {
      var ctx = canvas.getContext("2d");
      ctx.beginPath();
      ctx.arc(lx, ly, 1.2, 0, Math.PI * 2);
      ctx.fill();
      canvas.dataset.hasDrawing = "true";
    }
    drawing = false;
  };

  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointerleave", stop);
  canvas.addEventListener("pointercancel", stop);

  return resize;
}

var sigResizers = [];
document.querySelectorAll(".signature-pad").forEach(function (c) {
  sigResizers.push(setupSigPad(c));
  var wrap = c.closest(".sig-canvas-wrap");
  if (!wrap) return;
  var btn = wrap.querySelector(".sig-clear-btn");
  if (btn) {
    btn.addEventListener("click", function () {
      var ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      c.dataset.hasDrawing = "false";
    });
  }
});

window.addEventListener("resize", function () {
  sigResizers.forEach(function (fn) { fn(); });
});

// ── PDF functions ──────────────────────────────────────────────

function getFormValues() {
  var vals = {};
  FIELD_IDS.forEach(function (id) {
    var el = document.getElementById(id);
    vals[id] = el ? el.value : "";
  });
  return vals;
}

function validateForm() {
  var empty = [];
  FIELD_IDS.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el || !el.value.trim()) empty.push(id);
  });
  var emptySig = [];
  document.querySelectorAll(".signature-pad").forEach(function (c, i) {
    if (c.dataset.hasDrawing !== "true") emptySig.push(i);
  });
  if (empty.length > 0 || emptySig.length > 0) {
    var msg = "";
    if (empty.length > 0) msg += "Foljande falt ar tomma: " + empty.join(", ") + ".";
    if (emptySig.length > 0) {
      if (msg) msg += "\n\n";
      msg += "Vänligen rita alla sex underskrifter.";
    }
    alert(msg);
    if (empty.length > 0) {
      var fe = document.getElementById(empty[0]);
      if (fe) fe.focus();
    }
    return false;
  }
  return true;
}

window.downloadPDF = async function () {
  await html2pdf().set(pdfOptions).from(document.getElementById("contract")).save();
};

window.previewPDF = async function () {
  var uri = await html2pdf().set(pdfOptions).from(document.getElementById("contract")).outputPdf("datauristring");
  document.getElementById("previewFrame").src = uri;
  var box = document.getElementById("previewBox");
  box.style.display = "block";
  box.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.sendPDF = function () {
  if (!validateForm()) return;

  var overlay = document.getElementById("sendConfirmOverlay");
  var confirmSt = document.getElementById("confirm-state");
  var loadingSt = document.getElementById("confirm-loading-state");
  var successSt = document.getElementById("confirm-success-state");
  var errorSt = document.getElementById("confirm-error-state");
  confirmSt.style.display = "block";
  loadingSt.style.display = "none";
  successSt.style.display = "none";
  errorSt.style.display = "none";
  overlay.style.display = "flex";

  var cancelBtn = document.getElementById("sendConfirmCancelBtn");
  var sendBtn = document.getElementById("sendConfirmSendBtn");
  var errorClose = document.getElementById("confirm-error-close");

  function hideOverlay() {
    overlay.style.display = "none";
    cancelBtn.removeEventListener("click", onCancel);
    sendBtn.removeEventListener("click", onSend);
    errorClose.removeEventListener("click", hideOverlay);
  }
  function onCancel() { hideOverlay(); }

  async function onSend() {
    confirmSt.style.display = "none";
    loadingSt.style.display = "block";
    cancelBtn.removeEventListener("click", onCancel);
    sendBtn.removeEventListener("click", onSend);
    try {
      var blob = await html2pdf().set(pdfOptions).from(document.getElementById("contract")).toPdf().outputPdf("blob");
      var reader = new FileReader();
      var base64 = await new Promise(function (r) {
        reader.onloadend = function () { r(reader.result.split(",")[1]); };
      });
      reader.readAsDataURL(blob);

      var vals = getFormValues();
      var params = new URLSearchParams();
      params.append("action", "submit-contract");
      params.append("pdf", base64);
      params.append("filename", "islamic-marriage-contract.pdf");
      params.append("wifeName", vals.wifeNameInput);
      params.append("husbandName", vals.husbandNameInput);
      params.append("wifePnr", vals.wifePersonalIdInput);
      params.append("husbandPnr", vals.husbandPersonalIdInput);
      params.append("date", vals.dateInput);

      var witness2 = document.getElementById("witness2NameInput");
      if (witness2) params.append("witness2Name", witness2.value);
      var witness1 = document.getElementById("witness1NameInput");
      if (witness1) params.append("witness1Name", witness1.value);
      var imamN = document.getElementById("imamNameInput");
      if (imamN) params.append("imamName", imamN.value);
      var waliN = document.getElementById("waliNameInput");
      if (waliN) params.append("waliName", waliN.value);

      var res = await fetch(GAS_URL, { method: "POST", body: params });
      var result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || "Upload failed");

      loadingSt.style.display = "none";
      successSt.style.display = "block";
    } catch (e) {
      loadingSt.style.display = "none";
      document.getElementById("confirm-error-text").textContent = "Något gick fel: " + (e.message || "Okänt fel");
      errorSt.style.display = "block";
      errorClose.addEventListener("click", hideOverlay);
    }
  }

  cancelBtn.addEventListener("click", onCancel);
  sendBtn.addEventListener("click", onSend);
  errorClose.addEventListener("click", hideOverlay);
};
