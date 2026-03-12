/**
 * setanel-sdk — Anti-Piracy Video Security SDK
 * Version: 1.0.0
 *
 * npm install setanel-sdk
 *
 * Usage:
 *   import Setanel from 'setanel-sdk'
 *   // or via CDN:
 *   // <script src="https://cdn.jsdelivr.net/npm/setanel-sdk/dist/setanel-sdk.min.js"></script>
 *
 *   Setanel.init({
 *     supabaseUrl:  'https://xxx.supabase.co',
 *     supabaseKey:  'your-anon-key',
 *     userId:       'student_123',
 *     userEmail:    'student@platform.com',
 *     videoUrl:     'https://stream.example.com/lecture.m3u8',
 *     container:    '#video-player',
 *     deviceLimit:  1,
 *     onRevoke:     (reason) => { window.location.href = '/login' }
 *   })
 */

'use strict';

// ─── Internal state ────────────────────────────────────────────────────────
let _db           = null;
let _config       = {};
let _deviceId     = null;
let _forensicId   = null;
let _heartbeat    = null;
let _watermarkInt = null;
let _hlsInstance  = null;
let _revoked      = false;
let _initialized  = false;

// ─── Constants ─────────────────────────────────────────────────────────────
const VERSION        = '1.0.0';
const HEARTBEAT_MS   = 30000;   // 30 seconds
const WATERMARK_MS   = 5000;    // move every 5 seconds
const SESSION_WINDOW = 90000;   // 90 second active window

// ─── Dependency Loader ─────────────────────────────────────────────────────
function loadScript(src, globalCheck, cb) {
  if (globalCheck && window[globalCheck]) { cb(); return; }
  const s = document.createElement('script');
  s.src = src;
  s.onload = cb;
  s.onerror = () => console.error(`[Setanel] Failed to load: ${src}`);
  document.head.appendChild(s);
}

function loadSupabase(cb) {
  loadScript(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'supabase', cb
  );
}

function loadHls(cb) {
  loadScript(
    'https://cdn.jsdelivr.net/npm/hls.js@latest',
    'Hls', cb
  );
}

// ─── Device Fingerprint ────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem('_setanel_device');
  if (!id) {
    id = 'web_' + Math.random().toString(36).substr(2, 10) + '_' + Date.now().toString(36);
    localStorage.setItem('_setanel_device', id);
  }
  return id;
}

// ─── Forensic ID ──────────────────────────────────────────────────────────
function generateForensicId() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ─── CSS Injection ────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('_setanel_css')) return;
  const style = document.createElement('style');
  style.id = '_setanel_css';
  style.textContent = `
    ._stl-wrap {
      position: relative;
      background: #000;
      width: 100%;
      overflow: hidden;
      border-radius: 4px;
    }
    ._stl-video {
      width: 100%;
      display: block;
      outline: none;
    }
    ._stl-watermark {
      position: absolute;
      font-family: 'Courier New', monospace;
      font-size: 1rem;
      color: rgba(255,255,255,0.14);
      pointer-events: none;
      user-select: none;
      letter-spacing: 4px;
      transition: all 4s ease-in-out;
      z-index: 10;
      white-space: nowrap;
    }
    ._stl-shield {
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(0,0,0,0.55);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 3px;
      padding: 4px 10px;
      font-family: 'Courier New', monospace;
      font-size: 0.6rem;
      color: rgba(255,255,255,0.35);
      letter-spacing: 2px;
      pointer-events: none;
      z-index: 10;
    }
    ._stl-revoke {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.97);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 1rem;
      text-align: center;
      padding: 2rem;
      font-family: 'Courier New', monospace;
    }
    ._stl-revoke-icon { font-size: 3rem; }
    ._stl-revoke-title {
      font-size: 1.8rem;
      font-weight: 800;
      color: #fff;
      letter-spacing: 3px;
    }
    ._stl-revoke-msg {
      font-size: 0.82rem;
      color: #666;
      max-width: 380px;
      line-height: 1.9;
      letter-spacing: 0.5px;
    }
    ._stl-revoke-btn {
      margin-top: 0.5rem;
      padding: 12px 36px;
      background: none;
      border: 1px solid #fff;
      border-radius: 999px;
      color: #fff;
      font-family: 'Courier New', monospace;
      font-size: 0.8rem;
      letter-spacing: 2px;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 0.2s;
    }
    ._stl-revoke-btn:hover { background: rgba(255,255,255,0.07); }
  `;
  document.head.appendChild(style);
}

// ─── Build Player DOM ──────────────────────────────────────────────────────
function buildPlayer(container) {
  const wrap = document.createElement('div');
  wrap.className = '_stl-wrap';

  const video = document.createElement('video');
  video.className = '_stl-video';
  video.id = '_stl_video';
  video.controls = true;
  video.playsInline = true;
  video.setAttribute('controlsList', 'nodownload');
  video.addEventListener('contextmenu', e => e.preventDefault());

  const watermark = document.createElement('div');
  watermark.className = '_stl-watermark';
  watermark.id = '_stl_watermark';
  watermark.textContent = _forensicId;

  const shield = document.createElement('div');
  shield.className = '_stl-shield';
  shield.textContent = '🛡 SETANEL';

  wrap.appendChild(video);
  wrap.appendChild(watermark);
  wrap.appendChild(shield);
  container.innerHTML = '';
  container.appendChild(wrap);

  return video;
}

// ─── Load HLS Stream ──────────────────────────────────────────────────────
function initStream(video, url) {
  const Hls = window.Hls;
  if (Hls && Hls.isSupported()) {
    _hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: true });
    _hlsInstance.loadSource(url);
    _hlsInstance.attachMedia(video);
    _hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
    });
    _hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.error('[Setanel] HLS fatal error:', data.type);
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    video.addEventListener('loadedmetadata', () => video.play().catch(() => {}));
  } else {
    console.warn('[Setanel] HLS not supported. Falling back to direct src.');
    video.src = url;
  }
}

// ─── Watermark ────────────────────────────────────────────────────────────
function startWatermark() {
  const wm = document.getElementById('_stl_watermark');
  const wrap = wm ? wm.parentElement : null;
  if (!wm || !wrap) return;

  function reposition() {
    const padX = 140, padY = 30;
    const x = Math.floor(Math.random() * Math.max(wrap.offsetWidth  - padX, 10));
    const y = Math.floor(Math.random() * Math.max(wrap.offsetHeight - padY, 10));
    wm.style.left = x + 'px';
    wm.style.top  = y + 'px';
  }

  reposition();
  _watermarkInt = setInterval(reposition, WATERMARK_MS);
}

// ─── Session Management ────────────────────────────────────────────────────
async function createSession() {
  // Clean up any stale session for this device
  await _db.from('active_sessions')
    .delete()
    .eq('user_id', _config.userId)
    .eq('device_id', _deviceId);

  const { error } = await _db.from('active_sessions').insert({
    user_id:     _config.userId,
    device_id:   _deviceId,
    last_seen:   new Date().toISOString(),
    platform:    'web',
    email:       _config.userEmail || '',
    forensic_id: _forensicId
  });

  if (error) console.error('[Setanel] Session create error:', error.message);
  else console.log(`[Setanel] Session started. Forensic ID: ${_forensicId}`);
}

// ─── Heartbeat + Kill Switch ───────────────────────────────────────────────
function startHeartbeat() {
  _heartbeat = setInterval(async () => {
    if (_revoked) return;

    // 1. Update our heartbeat
    const { error: updateErr } = await _db.from('active_sessions')
      .update({
        last_seen:   new Date().toISOString(),
        email:       _config.userEmail || '',
        forensic_id: _forensicId
      })
      .eq('user_id',   _config.userId)
      .eq('device_id', _deviceId);

    if (updateErr) return; // Network issue, skip this beat

    // 2. Check for ban
    const { data: banCheck } = await _db
      .from('banned_users')
      .select('user_id')
      .eq('user_id', _config.userId)
      .limit(1);

    if (banCheck && banCheck.length > 0) {
      revoke('banned');
      return;
    }

    // 3. Kill switch — count active devices
    const cutoff = new Date(Date.now() - SESSION_WINDOW).toISOString();
    const { data: sessions } = await _db
      .from('active_sessions')
      .select('device_id')
      .eq('user_id', _config.userId)
      .gte('last_seen', cutoff);

    const limit = _config.deviceLimit || 1;
    if (sessions && sessions.length > limit) {
      revoke('multi-device');
    }

  }, HEARTBEAT_MS);
}

// ─── Revoke Session ────────────────────────────────────────────────────────
function revoke(reason) {
  if (_revoked) return;
  _revoked = true;

  clearInterval(_heartbeat);
  clearInterval(_watermarkInt);
  if (_hlsInstance) _hlsInstance.destroy();

  const video = document.getElementById('_stl_video');
  if (video) { video.pause(); video.src = ''; }

  const MESSAGES = {
    'multi-device': {
      icon:  '🛡',
      title: 'SESSION REVOKED',
      msg:   'Your account was detected on another device.\nOnly 1 active session is allowed at a time.\nIf this wasn\'t you — change your password immediately.'
    },
    'banned': {
      icon:  '⛔',
      title: 'ACCOUNT SUSPENDED',
      msg:   'Your account has been suspended by an administrator.\nPlease contact support for assistance.'
    }
  };

  const m = MESSAGES[reason] || MESSAGES['multi-device'];

  // If platform provides its own handler, use that
  if (typeof _config.onRevoke === 'function') {
    _config.onRevoke(reason);
    return;
  }

  // Default overlay
  const overlay = document.createElement('div');
  overlay.className = '_stl-revoke';
  overlay.innerHTML = `
    <div class="_stl-revoke-icon">${m.icon}</div>
    <div class="_stl-revoke-title">${m.title}</div>
    <div class="_stl-revoke-msg">${m.msg.replace(/\n/g, '<br>')}</div>
    <button class="_stl-revoke-btn" onclick="location.reload()">Return to Login</button>
  `;
  document.body.appendChild(overlay);
}

// ─── Screenshot + Recording Deterrence ────────────────────────────────────
function initScreenshotBlock() {
  // Block keyboard shortcuts
  document.addEventListener('keydown', e => {
    const blocked =
      e.key === 'PrintScreen' ||
      (e.ctrlKey  && e.shiftKey && ['s','S','i','I','u','U'].includes(e.key)) ||
      (e.metaKey  && e.shiftKey && ['3','4','5'].includes(e.key)) ||
      (e.metaKey  && e.ctrlKey  && e.shiftKey);

    if (blocked) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // Blur video when tab is hidden (screen recording detection)
  document.addEventListener('visibilitychange', () => {
    const video = document.getElementById('_stl_video');
    if (!video) return;
    video.style.filter = document.hidden ? 'blur(20px)' : '';
  });

  // Disable drag
  document.addEventListener('dragstart', e => {
    if (e.target.tagName === 'VIDEO') e.preventDefault();
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────
async function cleanup() {
  clearInterval(_heartbeat);
  clearInterval(_watermarkInt);
  if (_hlsInstance) _hlsInstance.destroy();
  if (_db && _config.userId && _deviceId) {
    await _db.from('active_sessions')
      .delete()
      .eq('user_id',   _config.userId)
      .eq('device_id', _deviceId);
  }
}

// ─── Validate Config ──────────────────────────────────────────────────────
function validateConfig(config) {
  const required = ['supabaseUrl', 'supabaseKey', 'userId', 'videoUrl', 'container'];
  const missing = required.filter(k => !config[k]);
  if (missing.length) {
    throw new Error(`[Setanel] Missing required config: ${missing.join(', ')}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════
const Setanel = {

  version: VERSION,

  /**
   * Initialize Setanel protection.
   *
   * @param {Object}   config
   * @param {string}   config.supabaseUrl    Supabase project URL
   * @param {string}   config.supabaseKey    Supabase anon key
   * @param {string}   config.userId         Student's unique ID from your auth system
   * @param {string}   [config.userEmail]    Student's email (recommended)
   * @param {string}   config.videoUrl       HLS .m3u8 stream URL
   * @param {string}   config.container      CSS selector for the player container div
   * @param {number}   [config.deviceLimit]  Max simultaneous devices. Default: 1
   * @param {Function} [config.onRevoke]     Callback when session is killed. Args: (reason)
   *
   * @returns {Setanel}
   */
  init(config) {
    if (_initialized) {
      console.warn('[Setanel] Already initialized. Call Setanel.destroy() first.');
      return this;
    }

    validateConfig(config);
    _config     = config;
    _deviceId   = getDeviceId();
    _forensicId = generateForensicId();
    _revoked    = false;

    injectStyles();
    initScreenshotBlock();

    loadSupabase(() => {
      _db = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);

      loadHls(() => {
        const container = document.querySelector(config.container);
        if (!container) {
          console.error('[Setanel] Container not found:', config.container);
          return;
        }

        const video = buildPlayer(container);
        initStream(video, config.videoUrl);
        startWatermark();

        createSession().then(() => {
          startHeartbeat();
          _initialized = true;
          console.log(`[Setanel SDK v${VERSION}] Initialized successfully.`);
        });

        window.addEventListener('beforeunload', cleanup);
      });
    });

    return this;
  },

  /**
   * Get the forensic ID for this session.
   * You can display this to the student or log it server-side.
   *
   * @returns {string} 6-digit forensic ID
   */
  getForensicId() {
    return _forensicId;
  },

  /**
   * Get the device ID for this browser/device.
   *
   * @returns {string}
   */
  getDeviceId() {
    return _deviceId;
  },

  /**
   * Clean up the session. Call this on student logout.
   */
  destroy() {
    _initialized = false;
    cleanup();
  }
};

// Support both CommonJS and browser global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Setanel;
} else {
  window.Setanel = Setanel;
}