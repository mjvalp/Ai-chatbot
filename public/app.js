(function () {
  'use strict';

  var MAX_CHARS = 2000;
  var MAX_HISTORY = 12;
  var REQUEST_TIMEOUT_MS = 35000;

  var log = document.getElementById('log');
  var form = document.getElementById('composer');
  var input = document.getElementById('composer-input');
  var sendBtn = document.getElementById('send');
  var counter = document.getElementById('counter');
  var suggestions = document.getElementById('suggestions');
  var newChatBtn = document.getElementById('new-chat');
  var themeBtn = document.getElementById('theme-toggle');

  var history = []; // {role, content}
  var busy = false;
  var controller = null;

  /* ---------- theme ---------- */
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#17181b' : '#eef0f3');
  }
  applyTheme(document.documentElement.dataset.theme || 'dark');
  themeBtn.addEventListener('click', function () {
    var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('orbit-theme', next); } catch (e) {}
  });

  /* ---------- safe rendering (DOM only, never innerHTML) ---------- */
  function inline(parent, text) {
    var re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      var tok = m[0], el;
      if (tok[0] === '`') { el = document.createElement('code'); el.textContent = tok.slice(1, -1); }
      else { el = document.createElement('strong'); el.textContent = tok.slice(2, -2); }
      parent.appendChild(el);
      last = m.index + tok.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function renderBlocks(container, text) {
    var parts = text.split(/```/);
    parts.forEach(function (part, i) {
      if (i % 2 === 1) {
        var pre = document.createElement('pre'), code = document.createElement('code');
        code.textContent = part.replace(/^[^\n]*\n/, '').replace(/\n$/, '');
        pre.appendChild(code); container.appendChild(pre);
        return;
      }
      part.split(/\n{2,}/).forEach(function (para) {
        if (!para.trim()) return;
        var lines = para.split('\n');
        var isUl = lines.every(function (l) { return /^\s*[-*•]\s+/.test(l); });
        var isOl = lines.every(function (l) { return /^\s*\d+[.)]\s+/.test(l); });
        if (isUl || isOl) {
          var list = document.createElement(isUl ? 'ul' : 'ol');
          lines.forEach(function (l) {
            var li = document.createElement('li');
            inline(li, l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''));
            list.appendChild(li);
          });
          container.appendChild(list);
        } else {
          var p = document.createElement('p');
          inline(p, para.replace(/^#{1,6}\s+/gm, ''));
          container.appendChild(p);
        }
      });
    });
  }

  function addMessage(role, text, opts) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + (role === 'user' ? 'user' : 'bot') + (opts.error ? ' error' : '');
    var who = document.createElement('p');
    who.className = 'who';
    who.textContent = role === 'user' ? 'You' : opts.error ? 'Orbit · error' : 'Orbit';
    var body = document.createElement('div');
    body.className = 'body';
    if (role === 'user' || opts.error) {
      body.textContent = text;
    } else {
      renderBlocks(body, text);
    }
    wrap.appendChild(who); wrap.appendChild(body);
    log.appendChild(wrap);
    scrollDown();
    return wrap;
  }

  function addTyping() {
    var wrap = document.createElement('div');
    wrap.className = 'msg bot';
    wrap.innerHTML = '<p class="who">Orbit</p><div class="body" role="status" aria-label="Orbit is thinking"><span class="typing" aria-hidden="true"><i></i><i></i><i></i></span></div>';
    log.appendChild(wrap);
    scrollDown();
    return wrap;
  }

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  /* ---------- composer ---------- */
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    counter.textContent = input.value.length + ' / ' + MAX_CHARS;
    sendBtn.disabled = busy || !input.value.trim();
  }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); send(input.value); });
  suggestions.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (chip) send(chip.textContent);
  });

  function setBusy(v) {
    busy = v;
    log.setAttribute('aria-busy', v ? 'true' : 'false');
    autosize();
  }

  async function send(raw) {
    var text = (raw || '').trim();
    if (!text || busy) return;
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

    if (suggestions.parentNode) suggestions.remove();
    addMessage('user', text);
    history.push({ role: 'user', content: text });
    input.value = ''; autosize();
    await requestReply();
  }

  async function requestReply() {
    setBusy(true);
    var typing = addTyping();
    controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    try {
      var res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ messages: history.slice(-MAX_HISTORY) })
      });
      var data = null;
      try { data = await res.json(); } catch (e) {}
      typing.remove();
      if (!res.ok || !data || typeof data.reply !== 'string') {
        throw new Error((data && data.error) || 'Something went wrong (HTTP ' + res.status + ').');
      }
      history.push({ role: 'assistant', content: data.reply });
      addMessage('bot', data.reply);
    } catch (err) {
      if (typing.parentNode) typing.remove();
      if (err.name === 'AbortError' && !controller) return; // cancelled by New chat
      var msg = err.name === 'AbortError' ? 'The request timed out. Please try again.'
        : (err instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : err.message);
      var el = addMessage('bot', msg, { error: true });
      var retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'btn retry'; retry.textContent = 'Retry';
      retry.addEventListener('click', function () { el.remove(); requestReply(); });
      el.appendChild(retry);
      retry.focus();
    } finally {
      clearTimeout(timer);
      setBusy(false);
      if (document.activeElement === document.body) input.focus();
    }
  }

  /* ---------- new chat ---------- */
  newChatBtn.addEventListener('click', function () {
    if (controller) { var c = controller; controller = null; c.abort(); }
    history = [];
    log.innerHTML = '';
    log.appendChild(suggestions);
    busy = false; setBusy(false);
    input.value = ''; autosize();
    input.focus();
  });

  autosize();
})();
