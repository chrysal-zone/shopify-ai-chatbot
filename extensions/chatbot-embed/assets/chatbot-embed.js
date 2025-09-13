(() => {
  if (window.__chatbot_embed_loaded__) return;
  window.__chatbot_embed_loaded__ = true;

  // ---- Floating icon button ----
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.setAttribute('aria-label', 'Open chatbot');
  trigger.title = 'Chat';
  trigger.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 12c0 3.866-3.806 7-8.5 7-.94 0-1.846-.12-2.7-.344L4 20l1.614-3.227C5.228 15.68 5 14.86 5 14c0-3.866 3.806-7 8.5-7S20 8.134 20 12Z"
            stroke="currentColor" stroke-width="1.6" fill="none"/>
      <circle cx="9.25" cy="12" r="1.15" fill="currentColor"/>
      <circle cx="12" cy="12" r="1.15" fill="currentColor"/>
      <circle cx="14.75" cy="12" r="1.15" fill="currentColor"/>
    </svg>
  `;
  Object.assign(trigger.style, {
    position: 'fixed', right: '20px', bottom: '20px',
    width: '48px', height: '48px',
    borderRadius: '9999px', background: '#111', color: '#fff',
    border: 'none', boxShadow: '0 6px 16px rgba(0,0,0,.2)',
    display: 'grid', placeItems: 'center', cursor: 'pointer',
    zIndex: '2147483647'
  });

  // ---- Chat panel (no Shadow DOM) ----
  const panel = document.createElement('div');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'AI Assistant');
  Object.assign(panel.style, {
    position: 'fixed', right: '20px', bottom: '80px',
    width: '320px', maxHeight: '65vh',
    display: 'none', flexDirection: 'column',
    background: '#fff', borderRadius: '12px',
    boxShadow: '0 12px 32px rgba(0,0,0,.22)',
    overflow: 'hidden', border: '1px solid rgba(0,0,0,.06)',
    zIndex: '2147483647'
  });
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:10px 12px;background:#111;color:#fff;">
      <div style="font-size:14px;font-weight:600">AI Assistant</div>
      <button id="__chat_close" aria-label="Close"
              style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px">×</button>
    </div>
    <div id="__chat_msgs" style="padding:12px;overflow:auto;height:300px"></div>
    <form id="__chat_form" style="display:flex;gap:8px;padding:10px;border-top:1px solid rgba(0,0,0,.08)">
      <input id="__chat_input" type="text" placeholder="Type your message…" autocomplete="off"
             style="flex:1;padding:10px 12px;border:1px solid rgba(0,0,0,.2);border-radius:10px" />
      <button type="submit" style="padding:10px 12px;border:none;border-radius:10px;background:#111;color:#fff;cursor:pointer">
        Send
      </button>
    </form>
  `;

  // helpers
  const msgs = panel.querySelector('#__chat_msgs');
  const form = panel.querySelector('#__chat_form');
  const input = panel.querySelector('#__chat_input');
  const close = panel.querySelector('#__chat_close');
  function addMsg(text, who = 'bot') {
    const div = document.createElement('div');
    div.textContent = text;
    div.style.cssText = `
      margin-bottom:8px;padding:8px 10px;border-radius:10px;max-width:85%;line-height:1.35;
      ${who === 'me'
        ? 'background:#111;color:#fff;margin-left:auto;'
        : 'background:#f2f3f5;color:#111;'}
    `;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // demo echo
  // demo echo  ->  call backend via App Proxy
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    addMsg(text, 'me');
    input.value = '';

    try {
      const res = await fetch('/apps/chatbot/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      addMsg(data?.reply || 'No reply');
    } catch (err) {
      console.error('[chatbot] proxy error', err);
      addMsg('Network error, please try again.');
    }
  });
  // toggle/open/close handlers
  function openPanel() { panel.style.display = 'flex'; }
  function closePanel() { panel.style.display = 'none'; }

  trigger.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
  });

  close.addEventListener('click', closePanel);


  // mount
  const mount = () => {
    document.body.appendChild(trigger);
    document.body.appendChild(panel);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
