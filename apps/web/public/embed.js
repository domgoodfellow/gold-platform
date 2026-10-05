/*
 * GildOps form embed. Place <div data-gildops-form="KEY"></div> where the form should appear and
 * load this file once. It adds one iframe pointing at this same origin's /embed/forms/KEY, and
 * resizes it to the form's height. It reads nothing from the page it is on and sends nothing but a
 * height back to it.
 */
(function () {
  var script = document.currentScript;
  if (!script || !script.src) return;
  var origin = new URL(script.src).origin;

  function mount(el) {
    var key = el.getAttribute('data-gildops-form');
    if (!/^[a-f0-9]{12}$/.test(key || '') || el.getAttribute('data-gildops-mounted')) return;
    el.setAttribute('data-gildops-mounted', '1');
    var frame = document.createElement('iframe');
    frame.src = origin + '/embed/forms/' + key;
    frame.title = el.getAttribute('data-title') || 'Form';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    // Forms and scripts, and our own origin so the form can post to us. No top navigation, no popups.
    frame.setAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin');
    frame.style.cssText = 'width:100%;border:0;display:block;min-height:320px;color-scheme:normal';
    el.appendChild(frame);
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || data.type !== 'gildops:form:height' || typeof data.height !== 'number') return;
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i += 1) {
      if (frames[i].contentWindow === event.source) {
        frames[i].style.height = Math.min(Math.max(Math.ceil(data.height), 120), 4000) + 'px';
      }
    }
  });

  var targets = document.querySelectorAll('[data-gildops-form]');
  for (var i = 0; i < targets.length; i += 1) mount(targets[i]);
})();
