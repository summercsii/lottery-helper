/* ============================================
   千享抽獎小幫手 — Main Application
   ============================================ */

(function () {
  'use strict';

  // ---- Config ----
  // 請將此 Client ID 替換為你在 Google Cloud Console 建立的 OAuth 2.0 Client ID
  const GOOGLE_CLIENT_ID = '320319664058-8tgd999jbe1fq3b63b9m0u8nm50mg13g.apps.googleusercontent.com';
  const ALLOWED_DOMAINS = ['cm-media.com.tw', 'csii.com.tw'];

  // Facebook App ID — 請替換為你在 Meta for Developers 建立的 App ID
  const FB_APP_ID = '1584714207023236';

  // ---- State ----
  const state = {
    platform: 'facebook',
    participants: [],
    filtered: [],
    excluded: [],
    winners: [],
    prizes: [{ name: '獎品 1', count: 1 }],
    user: null,
  };

  // ---- DOM Refs ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ---- Init ----
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    initGoogleAuth();
    initFacebookSDK();
    bindLogout();
    bindPlatformTabs();
    bindModeTabs();
    bindCardToggles();
    bindPrizeControls();
    bindImport();
    bindFilters();
    bindDraw();
    bindHelp();
    bindTokenToggle();
    bindFileDrop();
    bindFbLogin();
    bindPostUrlClear();
  }

  // ---- Google Auth ----
  function initGoogleAuth() {
    // Check if already logged in this session
    try {
      const saved = sessionStorage.getItem('lottery_user');
      if (saved) {
        const user = JSON.parse(saved);
        if (user && user.email && isDomainAllowed(user.email)) {
          onLoginSuccess(user);
          return;
        }
      }
    } catch (e) {}

    // Wait for Google Identity Services to load
    if (typeof google === 'undefined' || !google.accounts) {
      window.addEventListener('load', () => {
        setTimeout(renderGoogleButton, 500);
      });
    } else {
      renderGoogleButton();
    }
  }

  function renderGoogleButton() {
    if (typeof google === 'undefined' || !google.accounts) {
      setTimeout(renderGoogleButton, 500);
      return;
    }

    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      auto_select: false,
    });

    google.accounts.id.renderButton(
      $('#googleSignInBtn'),
      {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        width: 300,
        locale: 'zh_TW',
      }
    );
  }

  function handleGoogleCredential(response) {
    const payload = parseJwt(response.credential);
    if (!payload) {
      showLoginError('登入失敗，請重試。');
      return;
    }

    const email = payload.email || '';
    if (!isDomainAllowed(email)) {
      const domain = email.split('@')[1] || '未知';
      showLoginError(`此帳號 (${email}) 不屬於公司網域。僅限 @cm-media.com.tw 及 @csii.com.tw 帳號使用。`);
      return;
    }

    const user = {
      name: payload.name || email.split('@')[0],
      email: email,
      picture: payload.picture || '',
    };

    try {
      sessionStorage.setItem('lottery_user', JSON.stringify(user));
    } catch (e) {}

    onLoginSuccess(user);
  }

  function isDomainAllowed(email) {
    const domain = (email || '').split('@')[1];
    return domain && ALLOWED_DOMAINS.includes(domain.toLowerCase());
  }

  function onLoginSuccess(user) {
    state.user = user;

    // Hide login overlay
    $('#loginOverlay').classList.add('hidden');

    // Show user info in header
    const userInfo = $('#userInfo');
    userInfo.hidden = false;
    $('#userName').textContent = user.name;
    if (user.picture) {
      $('#userAvatar').src = user.picture;
      $('#userAvatar').style.display = '';
    } else {
      $('#userAvatar').style.display = 'none';
    }
  }

  function showLoginError(msg) {
    const el = $('#loginError');
    el.textContent = msg;
    el.hidden = false;
  }

  function bindLogout() {
    $('#btnLogout').addEventListener('click', () => {
      try { sessionStorage.removeItem('lottery_user'); } catch (e) {}
      state.user = null;
      $('#userInfo').hidden = true;
      $('#loginError').hidden = true;
      $('#loginOverlay').classList.remove('hidden');

      if (typeof google !== 'undefined' && google.accounts) {
        google.accounts.id.disableAutoSelect();
      }
    });
  }

  function parseJwt(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join('')
      );
      return JSON.parse(jsonPayload);
    } catch (e) {
      return null;
    }
  }

  // ---- Facebook SDK ----
  function initFacebookSDK() {
    window.fbAsyncInit = function () {
      FB.init({
        appId: FB_APP_ID,
        cookie: true,
        xfbml: false,
        version: 'v21.0',
      });
    };
    handleFbRedirect();
  }

  function handleFbRedirect() {
    const hash = window.location.hash;
    console.log('[FB] handleFbRedirect, hash:', hash ? hash.substring(0, 50) + '...' : '(none)');
    if (hash && hash.includes('access_token=')) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get('access_token');
      console.log('[FB] Got access_token from hash, length:', accessToken ? accessToken.length : 0);
      if (accessToken) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        sessionStorage.setItem('fb_access_token', accessToken);
        waitForLogin(function () { onFbTokenObtained(accessToken); });
      }
    } else {
      const saved = sessionStorage.getItem('fb_access_token');
      console.log('[FB] No hash token, saved token:', saved ? 'exists (length ' + saved.length + ')' : 'none');
      if (saved) {
        waitForLogin(function () { onFbTokenObtained(saved); });
      }
    }
  }

  function waitForLogin(callback) {
    const overlay = $('#loginOverlay');
    const isHidden = !overlay || overlay.classList.contains('hidden');
    console.log('[FB] waitForLogin, overlay hidden:', isHidden);
    if (isHidden) { callback(); return; }
    const observer = new MutationObserver(function () {
      if (overlay.classList.contains('hidden')) {
        console.log('[FB] Login overlay now hidden, firing FB callback');
        observer.disconnect();
        callback();
      }
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
  }

  function bindFbLogin() {
    const btn = $('#btnFbLogin');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const redirectUri = encodeURIComponent(window.location.origin + window.location.pathname);
      const authUrl = 'https://www.facebook.com/v21.0/dialog/oauth?' +
        'client_id=' + FB_APP_ID +
        '&redirect_uri=' + redirectUri +
        '&response_type=token';
      window.location.href = authUrl;
    });
  }

  function bindPostUrlClear() {
    const input = $('#postUrl');
    if (!input) return;
    input.addEventListener('input', function () {
      state._selectedPostId = null;
      const sel = document.querySelector('#fbPostPicker .post-item.selected');
      if (sel) sel.classList.remove('selected');
    });
  }

  async function getBusinessPages(accessToken) {
    try {
      const debugResp = await fetch(
        'https://graph.facebook.com/v21.0/debug_token?input_token=' + accessToken + '&access_token=' + accessToken
      );
      const debugData = await debugResp.json();
      const granular = debugData && debugData.data && debugData.data.granular_scopes;
      if (!granular) return [];

      const pageIds = new Set();
      granular.forEach(function (s) {
        if (s.target_ids) s.target_ids.forEach(function (id) { pageIds.add(id); });
      });

      if (pageIds.size === 0) return [];
      console.log('[FB] Found page IDs from granular_scopes:', Array.from(pageIds));

      const pages = [];
      for (const pid of pageIds) {
        try {
          const pResp = await fetch(
            'https://graph.facebook.com/v21.0/' + pid + '?fields=name,id,access_token&access_token=' + accessToken
          );
          const pData = await pResp.json();
          if (pData.name && pData.id) {
            pages.push({ name: pData.name, id: pData.id, access_token: pData.access_token || accessToken });
          }
        } catch (e) {}
      }
      console.log('[FB] Resolved pages:', pages.map(function (p) { return p.name; }));
      return pages;
    } catch (e) {
      console.error('[FB] getBusinessPages error:', e);
      return [];
    }
  }

  async function onFbTokenObtained(accessToken) {
    const statusEl = $('#fbStatus');
    console.log('[FB] onFbTokenObtained called, token length:', accessToken ? accessToken.length : 0);

    try {
      const meResp = await fetch('https://graph.facebook.com/v21.0/me?fields=name&access_token=' + accessToken);
      const me = await meResp.json();
      console.log('[FB] /me response:', JSON.stringify(me));
      if (me && !me.error && statusEl) {
        statusEl.textContent = '✓ 已登入：' + (me.name || 'Facebook');
        statusEl.classList.add('fb-connected');
      } else if (me && me.error) {
        console.error('[FB] /me error:', me.error.message);
        if (statusEl) {
          statusEl.textContent = '⚠ Token 已過期，請重新登入';
          statusEl.classList.add('fb-connected');
        }
        sessionStorage.removeItem('fb_access_token');
        showToast('Facebook Token 已過期，請重新點擊「用 Facebook 登入取得」。', 'warning');
        return;
      }
    } catch (e) {
      console.error('[FB] /me fetch error:', e);
      if (statusEl) {
        statusEl.textContent = '✓ 已取得 Token';
        statusEl.classList.add('fb-connected');
      }
    }

    try {
      const acctResp = await fetch('https://graph.facebook.com/v21.0/me/accounts?fields=name,access_token,id&access_token=' + accessToken);
      const acctData = await acctResp.json();
      console.log('[FB] /me/accounts response:', JSON.stringify(acctData).substring(0, 500));
      if (acctData.data && acctData.data.length > 0) {
        state.fbPages = acctData.data;
        showPagePicker(acctData.data);
      } else {
        console.log('[FB] /me/accounts empty, trying debug_token for granular_scopes...');
        const pages = await getBusinessPages(accessToken);
        if (pages.length > 0) {
          state.fbPages = pages;
          showPagePicker(pages);
        } else if (acctData.error) {
          $('#accessToken').value = accessToken;
          showToast('取得粉專列表失敗：' + acctData.error.message, 'error');
        } else {
          $('#accessToken').value = accessToken;
          showToast('已取得 User Token（無管理粉專權限，部分功能可能受限）。', 'info');
        }
      }
    } catch (e) {
      console.error('[FB] /me/accounts fetch error:', e);
      $('#accessToken').value = accessToken;
      showToast('已取得 Access Token，但無法取得粉專列表。', 'info');
    }
  }

  function showPagePicker(pages) {
    const existing = $('#fbPagePicker');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'fbPagePicker';
    wrapper.className = 'fb-page-picker';
    wrapper.innerHTML = '<label>選擇粉絲專頁</label>' +
      '<div class="page-picker-row">' +
      '<select class="input" id="fbPageSelect">' +
      pages.map(function (p) {
        return '<option value="' + p.access_token + '" data-page-id="' + p.id + '">' + p.name + '</option>';
      }).join('') +
      '</select>' +
      '<button class="btn btn-sm btn-outline" id="btnPickPost" title="選擇此粉專的貼文">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>' +
      ' 選擇貼文</button>' +
      '</div>';

    const tokenGroup = $('#accessToken').closest('.form-group');
    tokenGroup.appendChild(wrapper);

    const select = $('#fbPageSelect');
    $('#accessToken').value = pages[0].access_token;
    showToast('已取得粉專 Page Token，可直接抓取留言！', 'success');

    select.addEventListener('change', function () {
      $('#accessToken').value = this.value;
      const existingPostPicker = $('#fbPostPicker');
      if (existingPostPicker) existingPostPicker.remove();
      showToast('已切換至「' + this.options[this.selectedIndex].text + '」的 Token。', 'info');
    });

    $('#btnPickPost').addEventListener('click', loadPagePosts);
  }

  async function loadPagePosts() {
    const select = $('#fbPageSelect');
    if (!select) return;
    const token = select.value;
    const pageId = select.options[select.selectedIndex].dataset.pageId;
    const pageName = select.options[select.selectedIndex].text;
    const btn = $('#btnPickPost');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 載入中...';

    try {
      const apiUrl = 'https://graph.facebook.com/v21.0/' + pageId +
        '/feed?fields=id,message,created_time,full_picture,permalink_url&limit=25&access_token=' + token;
      const resp = await fetch(apiUrl);
      const data = await resp.json();

      if (data.error) throw new Error(data.error.message || '載入貼文失敗');
      if (!data.data || data.data.length === 0) {
        showToast('此粉專目前沒有貼文。', 'info');
        return;
      }

      showPostPicker(data.data, pageName);
    } catch (err) {
      showToast('載入貼文失敗：' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>' +
        ' 選擇貼文';
    }
  }

  function showPostPicker(posts, pageName) {
    const existing = $('#fbPostPicker');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.id = 'fbPostPicker';
    wrapper.className = 'fb-post-picker';

    const formatDate = function (iso) {
      if (!iso) return '';
      const d = new Date(iso);
      return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };

    const truncate = function (text, max) {
      if (!text) return '（無文字內容）';
      return text.length > max ? text.substring(0, max) + '…' : text;
    };

    wrapper.innerHTML = '<label>「' + escapeHtml(pageName) + '」的近期貼文</label>' +
      '<div class="post-list">' +
      posts.map(function (p) {
        return '<div class="post-item" data-post-id="' + p.id + '"' +
          (p.permalink_url ? ' data-permalink="' + escapeHtml(p.permalink_url) + '"' : '') + '>' +
          (p.full_picture ? '<img class="post-thumb" src="' + escapeHtml(p.full_picture) + '" alt="">' : '') +
          '<div class="post-info">' +
          '<div class="post-text">' + escapeHtml(truncate(p.message, 80)) + '</div>' +
          '<div class="post-date">' + formatDate(p.created_time) + '</div>' +
          '</div></div>';
      }).join('') +
      '</div>';

    const picker = $('#fbPagePicker');
    if (picker) {
      picker.after(wrapper);
    } else {
      const tokenGroup = $('#accessToken').closest('.form-group');
      tokenGroup.appendChild(wrapper);
    }

    wrapper.querySelectorAll('.post-item').forEach(function (item) {
      item.addEventListener('click', function () {
        wrapper.querySelectorAll('.post-item').forEach(function (el) { el.classList.remove('selected'); });
        item.classList.add('selected');
        const postId = item.dataset.postId;
        $('#postUrl').value = item.dataset.permalink || postId;
        state._selectedPostId = postId;
        showToast('已選擇貼文，可直接點「抓留言」或「抓心情」。', 'success');
      });
    });
  }

  // ---- Platform Tabs ----
  function bindPlatformTabs() {
    $$('.nav-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.nav-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        state.platform = tab.dataset.platform;
        updatePlatformUI();
      });
    });
  }

  function updatePlatformUI() {
    const isFB = state.platform === 'facebook';
    $('#platformTitle').textContent = isFB ? 'Facebook 抽獎' : 'Instagram 抽獎';
    $('#platformDesc').textContent = isFB
      ? '讀取粉絲專頁貼文留言，由系統透過隨機演算法公平抽出得獎者。'
      : '讀取 Instagram 貼文留言，由系統透過隨機演算法公平抽出得獎者。';
    $('#postUrl').placeholder = isFB
      ? '請貼上 Facebook 貼文網址'
      : '請貼上 Instagram 貼文網址';
    $('#urlHint').textContent = isFB
      ? '支援格式：https://www.facebook.com/...'
      : '支援格式：https://www.instagram.com/p/...';

    $$('[data-fb-only]').forEach((el) => {
      el.style.display = isFB ? '' : 'none';
    });
  }

  // ---- Mode Tabs ----
  function bindModeTabs() {
    $$('.mode-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.mode-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        $$('.mode-content').forEach((c) => c.classList.remove('active'));
        const target = tab.dataset.mode === 'url' ? '#modeUrl' : '#modeManual';
        $(target).classList.add('active');
      });
    });
  }

  // ---- Card Toggles ----
  function bindCardToggles() {
    $$('.card-header[data-toggle]').forEach((header) => {
      header.addEventListener('click', () => {
        const body = $('#' + header.dataset.toggle);
        header.classList.toggle('collapsed');
        body.classList.toggle('collapsed');
      });
    });
  }

  // ---- Prize Controls ----
  function bindPrizeControls() {
    $('#btnAddPrize').addEventListener('click', () => {
      const idx = state.prizes.length;
      state.prizes.push({ name: `獎品 ${idx + 1}`, count: 1 });
      renderPrizes();
    });
    $('#btnRemovePrize').addEventListener('click', () => {
      if (state.prizes.length > 1) {
        state.prizes.pop();
        renderPrizes();
      }
    });

    $('#btnBatchPrize').addEventListener('click', () => {
      const area = $('#batchPrizeArea');
      area.hidden = !area.hidden;
    });

    $('#btnCancelBatch').addEventListener('click', () => {
      $('#batchPrizeArea').hidden = true;
      $('#batchPrizeInput').value = '';
    });

    $('#btnApplyBatch').addEventListener('click', () => {
      const text = $('#batchPrizeInput').value.trim();
      if (!text) return;
      const lines = text.split('\n').filter(l => l.trim());
      const parsed = [];
      lines.forEach(line => {
        line = line.trim();
        var m = line.match(/^(.+?)\s*[xX×]\s*(\d+)$/);
        if (m) {
          parsed.push({ name: m[1].trim(), count: parseInt(m[2]) || 1 });
        } else {
          m = line.match(/^(.+?)[,，]\s*(\d+)$/);
          if (m) {
            parsed.push({ name: m[1].trim(), count: parseInt(m[2]) || 1 });
          } else {
            parsed.push({ name: line, count: 1 });
          }
        }
      });
      if (parsed.length > 0) {
        state.prizes = parsed;
        renderPrizes();
        $('#batchPrizeArea').hidden = true;
        $('#batchPrizeInput').value = '';
        showToast('已套用 ' + parsed.length + ' 個獎項！', 'success');
      }
    });
  }

  function renderPrizes() {
    const container = $('#prizeList');
    container.innerHTML = state.prizes
      .map(
        (p, i) => `
      <div class="prize-row" data-index="${i}">
        <input type="text" class="input prize-name" placeholder="獎品名稱" value="${escapeHtml(p.name)}">
        <input type="number" class="input prize-count" min="1" value="${p.count}" title="中獎人數">
        <span class="prize-count-label">名</span>
      </div>`
      )
      .join('');

    container.querySelectorAll('.prize-row').forEach((row) => {
      const idx = parseInt(row.dataset.index);
      row.querySelector('.prize-name').addEventListener('input', (e) => {
        state.prizes[idx].name = e.target.value;
      });
      row.querySelector('.prize-count').addEventListener('input', (e) => {
        state.prizes[idx].count = Math.max(1, parseInt(e.target.value) || 1);
      });
    });
  }

  // ---- Import ----
  function bindImport() {
    $('#btnFetchComments').addEventListener('click', fetchComments);
    $('#btnFetchReactions').addEventListener('click', fetchReactions);
    $('#btnImport').addEventListener('click', importManual);
  }

  async function fetchComments() {
    const url = $('#postUrl').value.trim();
    const token = $('#accessToken').value.trim();

    if (!url && !state._selectedPostId) {
      showToast('請輸入貼文網址，或使用「選擇貼文」功能。', 'warning');
      return;
    }
    if (!token) {
      showToast('請輸入 Access Token 才能自動抓取留言，或使用手動匯入。', 'warning');
      return;
    }

    let postIdRaw = state._selectedPostId || null;
    if (!postIdRaw && url) {
      postIdRaw = extractPostId(url);
      if (!postIdRaw) {
        showToast('無法解析貼文網址，請確認格式或改用「選擇貼文」。', 'error');
        return;
      }
    }

    const btn = $('#btnFetchComments');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 抓取中...';

    try {
      const postId = await resolvePostId(postIdRaw, token);
      if (!postId) {
        showToast('無法解析貼文 ID', 'error');
        return;
      }
      const apiUrl = `https://graph.facebook.com/v21.0/${postId}/comments?fields=id,from,message,message_tags,created_time,is_hidden&limit=500&access_token=${token}`;
      let allComments = [];
      let nextUrl = apiUrl;

      while (nextUrl) {
        const resp = await fetch(nextUrl);
        const data = await resp.json();

        if (data.error) {
          throw new Error(data.error.message || '抓取失敗');
        }

        if (data.data) {
          allComments = allComments.concat(data.data);
        }

        nextUrl = data.paging && data.paging.next ? data.paging.next : null;
      }

      state.participants = allComments.map((c) => ({
        id: c.from ? c.from.id : (c.id || Math.random().toString(36).slice(2)),
        name: c.from ? c.from.name : '留言者 #' + (c.id ? c.id.split('_').pop().slice(-6) : '?'),
        comment: c.message || '',
        tagCount: c.message_tags
          ? c.message_tags.filter(function(t) { return !t.name || !t.name.startsWith('#'); }).length
          : (c.message ? (c.message.match(/@/g) || []).length : 0),
        time: c.created_time || '',
        hidden: c.is_hidden || false,
        source: 'comment',
      }));

      applyFilters();
      renderParticipants();
      showToast(`成功抓取 ${allComments.length} 筆留言！`, 'success');
    } catch (err) {
      showToast(`抓取失敗：${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg> 抓留言';
    }
  }

  async function fetchReactions() {
    const url = $('#postUrl').value.trim();
    const token = $('#accessToken').value.trim();

    if (!url && !state._selectedPostId) {
      showToast('請輸入貼文網址，或使用「選擇貼文」功能。', 'warning');
      return;
    }
    if (!token) {
      showToast('請輸入 Access Token 才能自動抓取心情。', 'warning');
      return;
    }

    let postIdRaw = state._selectedPostId || null;
    if (!postIdRaw && url) {
      postIdRaw = extractPostId(url);
      if (!postIdRaw) {
        showToast('無法解析貼文網址，請確認格式或改用「選擇貼文」。', 'error');
        return;
      }
    }

    const btn = $('#btnFetchReactions');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 抓取中...';

    try {
      const postId = await resolvePostId(postIdRaw, token);
      if (!postId) {
        showToast('無法解析貼文 ID', 'error');
        return;
      }
      const apiUrl = `https://graph.facebook.com/v21.0/${postId}/reactions?fields=id,name,type&limit=500&access_token=${token}`;
      let allReactions = [];
      let nextUrl = apiUrl;

      while (nextUrl) {
        const resp = await fetch(nextUrl);
        const data = await resp.json();

        if (data.error) {
          throw new Error(data.error.message || '抓取失敗');
        }
        if (data.data) {
          allReactions = allReactions.concat(data.data);
        }
        nextUrl = data.paging && data.paging.next ? data.paging.next : null;
      }

      state.participants = allReactions.map((r) => ({
        id: r.id,
        name: r.name || '未知使用者',
        comment: `按了 ${r.type || '讚'}`,
        time: '',
        hidden: false,
        source: 'reaction',
      }));

      applyFilters();
      renderParticipants();
      showToast(`成功抓取 ${allReactions.length} 筆心情！`, 'success');
    } catch (err) {
      showToast(`抓取失敗：${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> 抓心情';
    }
  }

  function importManual() {
    const raw = $('#manualData').value.trim();
    if (!raw) {
      showToast('請輸入或貼上留言資料', 'warning');
      return;
    }

    const lines = raw.split('\n').filter((l) => l.trim());
    state.participants = lines.map((line, i) => {
      const parts = line.split(/[,，]/).map((s) => s.trim());
      return {
        id: 'manual_' + i,
        name: parts[0] || `參加者 ${i + 1}`,
        comment: parts.slice(1).join(', ') || '',
        time: '',
        hidden: false,
        source: 'manual',
      };
    });

    applyFilters();
    renderParticipants();
    showToast(`成功匯入 ${state.participants.length} 筆資料！`, 'success');
  }

  function extractPostId(url) {
    // Facebook post URL patterns — numeric IDs
    const fbPatterns = [
      /facebook\.com\/[^/]+\/posts\/(\d+)/,
      /facebook\.com\/permalink\.php\?story_fbid=(\d+)/,
      /facebook\.com\/.*\/photos\/[^/]+\/(\d+)/,
      /facebook\.com\/photo\.php\?fbid=(\d+)/,
      /facebook\.com\/[^/]+\/videos\/(\d+)/,
      /facebook\.com\/(\d+)\/posts\/(\d+)/,
      /facebook\.com\/[^/]+\/activity\/(\d+)/,
    ];

    for (const pattern of fbPatterns) {
      const match = url.match(pattern);
      if (match) {
        if (match[2]) return `${match[1]}_${match[2]}`;
        return match[1];
      }
    }

    // Facebook pfbid format — needs Graph API resolution
    if (/facebook\.com\/.+\/posts\/pfbid/.test(url) || /facebook\.com\/.+\/pfbid/.test(url)) {
      return { type: 'pfbid', url: url.split('?')[0].split('#')[0] };
    }

    // Instagram post URL patterns
    const igPatterns = [
      /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
      /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
    ];

    for (const pattern of igPatterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    return null;
  }

  async function resolvePostId(postIdOrObj, token) {
    if (typeof postIdOrObj === 'string') return postIdOrObj;
    if (postIdOrObj && postIdOrObj.type === 'pfbid') {
      const resp = await fetch(
        'https://graph.facebook.com/v21.0/?id=' + encodeURIComponent(postIdOrObj.url) + '&access_token=' + token
      );
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || '無法解析 pfbid 網址');
      if (data.id) return data.id;
      throw new Error('無法從此網址取得貼文 ID，請改用「選擇粉專貼文」功能。');
    }
    return null;
  }

  // ---- Filters ----
  function bindFilters() {
    const filterInputs = [
      '#filterDuplicate',
      '#filterRepeatWinner',
      '#filterHidden',
      '#filterKeyword',
      '#filterTagMin',
      '#filterMinLength',
      '#filterExcludeUsers',
    ];
    filterInputs.forEach((sel) => {
      const el = $(sel);
      if (el) {
        el.addEventListener('change', () => {
          applyFilters();
          renderParticipants();
        });
        el.addEventListener('input', () => {
          applyFilters();
          renderParticipants();
        });
      }
    });
  }

  function applyFilters() {
    const removeDuplicates = $('#filterDuplicate').checked;
    const removeHidden = $('#filterHidden').checked;
    const keyword = $('#filterKeyword').value.trim().toLowerCase();
    const tagMin = parseInt($('#filterTagMin').value) || 0;
    const minLength = parseInt($('#filterMinLength').value) || 0;
    const excludeUsersRaw = $('#filterExcludeUsers').value.trim();
    const excludeUsers = excludeUsersRaw
      ? excludeUsersRaw.split(/[,，]/).map((s) => s.trim().toLowerCase())
      : [];

    let list = [...state.participants];
    const excludedItems = [];

    // Remove hidden
    if (removeHidden) {
      list = list.filter((p) => {
        if (p.hidden) {
          excludedItems.push(p);
          return false;
        }
        return true;
      });
    }

    // Remove duplicates (keep first occurrence, by user ID)
    if (removeDuplicates) {
      const seen = new Set();
      list = list.filter((p) => {
        const key = p.id;
        if (seen.has(key)) {
          excludedItems.push(p);
          return false;
        }
        seen.add(key);
        return true;
      });
    }

    // Keyword filter
    if (keyword) {
      list = list.filter((p) => {
        if (!p.comment.toLowerCase().includes(keyword)) {
          excludedItems.push(p);
          return false;
        }
        return true;
      });
    }

    // Tag friends filter (use message_tags from API, fallback to @ count)
    if (tagMin > 0) {
      list = list.filter((p) => {
        const tags = p.tagCount != null ? p.tagCount : (p.comment.match(/@/g) || []).length;
        if (tags < tagMin) {
          excludedItems.push(p);
          return false;
        }
        return true;
      });
    }

    // Min comment length
    if (minLength > 0) {
      list = list.filter((p) => {
        if (p.comment.length < minLength) {
          excludedItems.push(p);
          return false;
        }
        return true;
      });
    }

    // Exclude specific users
    if (excludeUsers.length > 0) {
      list = list.filter((p) => {
        if (excludeUsers.includes(p.name.toLowerCase())) {
          excludedItems.push(p);
          return false;
        }
        return true;
      });
    }

    state.filtered = list;
    state.excluded = excludedItems;
  }

  function renderParticipants() {
    const container = $('#participantList');
    const totalFiltered = state.filtered.length;
    const totalExcluded = state.excluded.length;

    $('#statMatch').textContent = `${totalFiltered} 筆符合`;
    $('#statExclude').textContent = `${totalExcluded} 筆排除`;

    if (totalFiltered === 0 && totalExcluded === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" opacity="0.2"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
          <p>尚無資料</p>
          <small>請先從左側匯入留言資料</small>
        </div>`;
      $('#btnDraw').disabled = true;
      return;
    }

    const showTagBadge = parseInt($('#filterTagMin').value) > 0;
    const items = state.filtered
      .map(
        (p, i) => `
      <div class="participant-item">
        <span class="p-index">${i + 1}</span>
        <div class="p-avatar">${p.name.charAt(0)}</div>
        <span class="p-name">${escapeHtml(p.name)}</span>
        ${showTagBadge && p.tagCount != null ? '<span class="p-tag-badge" title="標記好友數">@' + p.tagCount + '</span>' : ''}
        <span class="p-comment">${escapeHtml(p.comment)}</span>
      </div>`
      )
      .join('');

    container.innerHTML = items;
    $('#btnDraw').disabled = totalFiltered === 0;
  }

  // ---- Draw ----
  function bindDraw() {
    $('#btnDraw').addEventListener('click', startDraw);
    $('#modalClose').addEventListener('click', closeDrawModal);
    $('#btnReveal').addEventListener('click', revealWinner);
    $('#btnRedraw').addEventListener('click', redraw);
    $('#btnExportCSV').addEventListener('click', exportCSV);
    $('#btnExportImage').addEventListener('click', exportImage);

    $('#drawModal').addEventListener('click', (e) => {
      if (e.target === $('#drawModal')) closeDrawModal();
    });
  }

  let currentPrizeIndex = 0;
  let currentWinnerIndex = 0;
  let drawPool = [];
  let allWinners = [];
  let slotInterval = null;

  function startDraw() {
    // Read prizes from DOM
    state.prizes = [];
    $$('.prize-row').forEach((row) => {
      state.prizes.push({
        name: row.querySelector('.prize-name').value || '獎品',
        count: Math.max(1, parseInt(row.querySelector('.prize-count').value) || 1),
      });
    });

    const totalNeeded = state.prizes.reduce((sum, p) => sum + p.count, 0);
    if (state.filtered.length < totalNeeded) {
      showToast(`符合條件的人數 (${state.filtered.length}) 不足以抽出 ${totalNeeded} 位得獎者`, 'warning');
      if (state.filtered.length === 0) return;
    }

    drawPool = [...state.filtered];
    allWinners = [];
    currentPrizeIndex = 0;
    currentWinnerIndex = 0;
    state.winners = [];

    openDrawModal();
    preparePrizeDraw();
  }

  function preparePrizeDraw() {
    const prize = state.prizes[currentPrizeIndex];
    if (!prize || drawPool.length === 0) {
      showResults();
      return;
    }

    $('#drawStage').hidden = false;
    $('#drawResults').hidden = true;
    $('#drawTitle').textContent = '抽獎進行中';
    $('#drawPrizeName').textContent = `${prize.name} — 第 ${currentWinnerIndex + 1}/${prize.count} 位`;
    $('#btnReveal').disabled = false;
    $('#btnReveal').textContent = '揭曉得獎者';

    startSlotAnimation();
  }

  function startSlotAnimation() {
    const slotInner = $('#slotInner');
    const pool = drawPool.length > 0 ? drawPool : [{ name: '—' }];

    // Build slot items
    let items = '';
    for (let i = 0; i < 40; i++) {
      const p = pool[i % pool.length];
      items += `<div class="slot-item">${escapeHtml(p.name)}</div>`;
    }
    slotInner.innerHTML = items;

    let offset = 0;
    const speed = 3;
    const itemHeight = 80;
    const totalHeight = 40 * itemHeight;

    clearInterval(slotInterval);
    slotInterval = setInterval(() => {
      offset = (offset + speed) % totalHeight;
      slotInner.style.transform = `translateY(-${offset}px)`;
    }, 16);
  }

  function revealWinner() {
    clearInterval(slotInterval);

    const prize = state.prizes[currentPrizeIndex];
    if (!prize || drawPool.length === 0) {
      showResults();
      return;
    }

    // Random selection
    const idx = Math.floor(Math.random() * drawPool.length);
    const winner = drawPool[idx];

    // Animate to winner
    const slotInner = $('#slotInner');
    slotInner.innerHTML = `<div class="slot-item winner">${escapeHtml(winner.name)}</div>`;
    slotInner.style.transform = 'translateY(0)';
    slotInner.style.transition = 'none';

    // Record winner
    allWinners.push({ prize: prize.name, name: winner.name, comment: winner.comment });

    // Remove from pool
    if ($('#filterRepeatWinner').checked) {
      drawPool = drawPool.filter((p) => p.id !== winner.id);
    } else {
      drawPool.splice(idx, 1);
    }

    currentWinnerIndex++;
    if (currentWinnerIndex >= prize.count) {
      currentPrizeIndex++;
      currentWinnerIndex = 0;
    }

    // Check if more draws needed
    const nextPrize = state.prizes[currentPrizeIndex];
    const hasMore = nextPrize && drawPool.length > 0;

    if (!hasMore) {
      $('#btnReveal').textContent = '查看結果';
      $('#btnReveal').onclick = showResults;
    } else {
      $('#btnReveal').textContent = '繼續抽獎';
      $('#btnReveal').onclick = () => {
        preparePrizeDraw();
        $('#btnReveal').onclick = revealWinner;
      };
    }
  }

  function showResults() {
    clearInterval(slotInterval);
    $('#drawStage').hidden = true;
    $('#drawResults').hidden = false;

    const activityName = $('#activityName').value.trim() || '抽獎結果';
    $('#resultsActivityName').textContent = activityName;

    // Group winners by prize
    const grouped = {};
    allWinners.forEach((w) => {
      if (!grouped[w.prize]) grouped[w.prize] = [];
      grouped[w.prize].push(w);
    });

    let html = '';
    for (const [prizeName, winners] of Object.entries(grouped)) {
      html += `<div class="result-prize">
        <div class="result-prize-title">🏆 ${escapeHtml(prizeName)}</div>`;
      winners.forEach((w, i) => {
        html += `<div class="result-winner" style="animation-delay:${i * 0.1}s">
          <div class="rw-rank">${i + 1}</div>
          <span class="rw-name">${escapeHtml(w.name)}</span>
        </div>`;
      });
      html += '</div>';
    }

    $('#resultsList').innerHTML = html;
    state.winners = allWinners;

    launchConfetti();
  }

  function redraw() {
    closeDrawModal();
    setTimeout(() => startDraw(), 300);
  }

  function openDrawModal() {
    $('#drawModal').classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawModal() {
    $('#drawModal').classList.remove('show');
    document.body.style.overflow = '';
    clearInterval(slotInterval);
    removeConfetti();
  }

  // ---- Export ----
  function exportCSV() {
    if (allWinners.length === 0) return;

    const header = '獎品,得獎者,留言內容\n';
    const rows = allWinners
      .map((w) => `"${w.prize}","${w.name}","${w.comment}"`)
      .join('\n');

    const activityName = $('#activityName').value.trim() || '抽獎結果';
    downloadFile(header + rows, `${activityName}.csv`, 'text/csv;charset=utf-8');
    showToast('CSV 已匯出', 'success');
  }

  function exportImage() {
    const resultsList = $('#resultsList');
    if (!resultsList || allWinners.length === 0) return;

    const activityName = $('#activityName').value.trim() || '抽獎結果';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const padding = 40;
    const lineHeight = 36;
    const headerHeight = 80;
    const prizeHeaderHeight = 44;

    // Calculate height
    const grouped = {};
    allWinners.forEach((w) => {
      if (!grouped[w.prize]) grouped[w.prize] = [];
      grouped[w.prize].push(w);
    });

    const prizeCount = Object.keys(grouped).length;
    const totalLines = allWinners.length;
    const height = padding * 2 + headerHeight + prizeCount * (prizeHeaderHeight + 12) + totalLines * lineHeight + 40;

    canvas.width = 600;
    canvas.height = height;

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Header bar
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    grad.addColorStop(0, '#1e3a5f');
    grad.addColorStop(1, '#2563eb');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, headerHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`🎉 ${activityName}`, canvas.width / 2, 36);
    ctx.font = '13px "Noto Sans TC", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`千享抽獎小幫手 — ${new Date().toLocaleDateString('zh-TW')}`, canvas.width / 2, 60);

    // Winners
    ctx.textAlign = 'left';
    let y = headerHeight + padding;

    for (const [prizeName, winners] of Object.entries(grouped)) {
      ctx.fillStyle = '#2563eb';
      ctx.font = 'bold 16px "Noto Sans TC", sans-serif';
      ctx.fillText(`🏆 ${prizeName}`, padding, y);
      y += 8;
      ctx.fillStyle = '#dbeafe';
      ctx.fillRect(padding, y, canvas.width - padding * 2, 2);
      y += prizeHeaderHeight - 20;

      winners.forEach((w, i) => {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(padding + 12, y - 5, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${i + 1}`, padding + 12, y - 1);
        ctx.textAlign = 'left';

        ctx.fillStyle = '#1e293b';
        ctx.font = '15px "Noto Sans TC", sans-serif';
        ctx.fillText(w.name, padding + 34, y);
        y += lineHeight;
      });

      y += 12;
    }

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activityName}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });

    showToast('圖片已匯出', 'success');
  }

  function downloadFile(content, filename, type) {
    const BOM = '﻿';
    const blob = new Blob([BOM + content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Confetti ----
  function launchConfetti() {
    removeConfetti();
    const canvas = document.createElement('canvas');
    canvas.id = 'confettiCanvas';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#f59e0b', '#2563eb', '#ef4444', '#22c55e', '#a855f7', '#ec4899'];
    const particles = [];

    for (let i = 0; i < 120; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        w: Math.random() * 8 + 4,
        h: Math.random() * 4 + 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 3 + 2,
        rot: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 10,
      });
    }

    let frameId;
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.rotSpeed;
        p.vy += 0.05;

        if (p.y < canvas.height + 20) alive = true;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });

      if (alive) {
        frameId = requestAnimationFrame(animate);
      } else {
        removeConfetti();
      }
    }

    frameId = requestAnimationFrame(animate);
    canvas._frameId = frameId;
  }

  function removeConfetti() {
    const c = $('#confettiCanvas');
    if (c) {
      cancelAnimationFrame(c._frameId);
      c.remove();
    }
  }

  // ---- Help ----
  function bindHelp() {
    $('#btnHelp').addEventListener('click', () => {
      $('#helpModal').classList.add('show');
      document.body.style.overflow = 'hidden';
    });
    $('#helpClose').addEventListener('click', () => {
      $('#helpModal').classList.remove('show');
      document.body.style.overflow = '';
    });
    $('#helpModal').addEventListener('click', (e) => {
      if (e.target === $('#helpModal')) {
        $('#helpModal').classList.remove('show');
        document.body.style.overflow = '';
      }
    });
    const tokenHelp = $('#tokenHelp');
    if (tokenHelp) {
      tokenHelp.addEventListener('click', (e) => {
        e.preventDefault();
        $('#helpModal').classList.add('show');
        document.body.style.overflow = 'hidden';
      });
    }
  }

  // ---- Token Toggle ----
  function bindTokenToggle() {
    $('#toggleToken').addEventListener('click', () => {
      const input = $('#accessToken');
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  }

  // ---- File Drop ----
  function bindFileDrop() {
    const drop = $('#fileDrop');
    const fileInput = $('#fileInput');

    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('dragover');
    });
    drop.addEventListener('dragleave', () => {
      drop.classList.remove('dragover');
    });
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });
  }

  function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'csv' || ext === 'txt') {
      const reader = new FileReader();
      reader.onload = (e) => {
        $('#manualData').value = e.target.result;
        showToast(`已載入 ${file.name}`, 'success');
      };
      reader.readAsText(file, 'UTF-8');
    } else {
      showToast('目前僅支援 .csv 和 .txt 格式', 'warning');
    }
  }

  // ---- Toast ----
  function showToast(message, type = 'info') {
    const container = $('#toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all .3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ---- Helpers ----
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
