(function () {
  "use strict";

  async function ask(payload) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 45000);
    try {
      var response = await fetch("/api/ai", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload),
        signal:controller.signal
      });
      var data = {};
      try { data = await response.json(); } catch (_) {}
      if (!response.ok || !data.ok) {
        var err = new Error(data.message || data.error || ("AI request failed ("+response.status+")"));
        err.code = data.code || "AI_REQUEST_FAILED";
        err.status = response.status;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  window.PisacAI = { ask:ask };
})();
