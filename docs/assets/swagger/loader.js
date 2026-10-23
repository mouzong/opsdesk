/*
 * Interactive API reference (Swagger UI) for the OpsDesk documentation.
 *  - Everything is loaded from this site (no CDN, no external validator, works offline).
 *  - Deployed under /docs/ on an OpsDesk server: the live contract is read from /api/v1/openapi.json and
 *    "Try it out" calls that same server.
 *  - Standalone preview (mkdocs serve etc.): the bundled copy docs/api/openapi.json is used and you choose the
 *    API server below; that server must list this page's origin in OPSDESK_CORS_ORIGINS (no wildcard exists).
 *  - Credentials are never stored (persistAuthorization:false) and never prefilled; requests are never sent
 *    automatically ("Try it out" is opt-in per operation).
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var BASE = script && script.src ? script.src.replace(/loader\.js(\?.*)?$/, '') : null;
  var loading = null;

  function addCss(href) {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }
  function addScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function ensureSwagger() {
    if (window.SwaggerUIBundle) return Promise.resolve();
    if (!loading) {
      addCss(BASE + 'swagger-ui.css');
      loading = addScript(BASE + 'swagger-ui-bundle.js');
    }
    return loading;
  }
  function deployed() {
    return /^\/docs(\/|$)/.test(location.pathname);
  }
  function validApiOrigin(v) {
    try {
      var u = new URL(v);
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return null;
      return u.origin;
    } catch (e) {
      return null;
    }
  }
  function markDestructive(root) {
    root.querySelectorAll('.opblock').forEach(function (b) {
      var d = b.querySelector('.opblock-summary-description');
      if (d && d.textContent.trim().indexOf('⚠') === 0) b.classList.add('opsdesk-destructive');
    });
  }

  function start(root, spec, serverNote) {
    root.innerHTML = '';
    var holder = document.createElement('div');
    holder.id = 'opsdesk-swagger-ui';
    root.appendChild(holder);
    window.ui = window.SwaggerUIBundle({
      spec: spec,
      dom_id: '#opsdesk-swagger-ui',
      deepLinking: false,            // do not fight MkDocs' own #anchors
      persistAuthorization: false,   // never keep tokens in localStorage/sessionStorage
      tryItOutEnabled: false,        // opt-in per operation
      validatorUrl: null,            // no external validator
      docExpansion: 'none',
      displayRequestDuration: true,
      defaultModelsExpandDepth: 0,
      supportedSubmitMethods: ['get', 'post', 'patch', 'delete'],
      requestInterceptor: function (req) { req.credentials = 'omit'; return req; },
      onComplete: function () {
        markDestructive(root);
        new MutationObserver(function () { markDestructive(root); }).observe(root, { childList: true, subtree: true });
      }
    });
    if (serverNote) root.insertAdjacentHTML('afterbegin', serverNote);
  }

  function mount() {
    var root = document.getElementById('opsdesk-swagger');
    if (!root || root.dataset.mounted === '1') return;
    root.dataset.mounted = '1';
    root.textContent = 'Loading the API reference...';

    ensureSwagger().then(function () {
      if (deployed()) {
        return fetch('/api/v1/openapi.json', { credentials: 'omit' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (spec) { start(root, spec, ''); });
      }
      // Standalone preview: bundled contract + explicit API server selection.
      return fetch(new URL('../../api/openapi.json', BASE).href)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (spec) {
          var origin = location.origin;
          var form =
            '<form class="opsdesk-server-form" aria-label="API server for Try it out">' +
            '<label>API server <input type="url" name="api" value="http://127.0.0.1:4310" size="32" required></label> ' +
            '<button type="submit">Use this server</button>' +
            '<p>Standalone preview: this page is <code>' + origin + '</code>, not served by OpsDesk. Start OpsDesk with ' +
            '<code>OPSDESK_CORS_ORIGINS=' + origin + '</code> and <code>OPSDESK_API_TOKEN</code>, then enter its address here. ' +
            'No wildcard CORS is ever enabled.</p></form>';
          var apply = function (apiOrigin) {
            var copy = JSON.parse(JSON.stringify(spec));
            copy.servers = [{ url: apiOrigin + '/api/v1', description: 'Selected API server' }];
            start(root, copy, form);
            root.querySelector('input[name=api]').value = apiOrigin;
            root.querySelector('form').addEventListener('submit', function (e) {
              e.preventDefault();
              var o = validApiOrigin(e.target.api.value);
              if (!o) { e.target.api.setCustomValidity('Enter an http(s) address such as http://127.0.0.1:4310'); e.target.api.reportValidity(); return; }
              e.target.api.setCustomValidity('');
              apply(o);
            });
          };
          apply('http://127.0.0.1:4310');
        });
    }).catch(function (err) {
      root.dataset.mounted = '0';
      root.innerHTML = '<p><strong>The interactive reference could not be loaded</strong> (' + String(err && err.message || err).replace(/[<>&]/g, '') +
        '). The machine-readable contract is at <code>/api/v1/openapi.json</code> on a running OpsDesk server, and in this site at <code>api/openapi.json</code>.</p>';
    });
  }

  // MkDocs Material "instant navigation" replaces page content without reloading scripts: re-mount on every page switch.
  if (window.document$ && typeof window.document$.subscribe === 'function') window.document$.subscribe(mount);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
