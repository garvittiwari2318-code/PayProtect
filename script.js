/* =========================================================
   PayProtect— script.js
   Rule-based, simulated risk scoring. Runs entirely client-side.
   Nothing here is a real fraud database — it's pattern checks
   against the UPI ID, payee name, amount, and stated reason.

   The login/signup flow further down is a UI MOCKUP ONLY.
   It stores a name/email in localStorage just to demonstrate a
   logged-in state — there is no real backend, no password
   hashing, no real account security. Do not reuse this pattern
   for anything handling real credentials.
   ========================================================= */

/* ---------- Tab navigation ---------- */
const navLinks = document.querySelectorAll('.nav-link');
const tabPanels = document.querySelectorAll('.tab-panel');

function activateTab(tabName) {
  tabPanels.forEach(function (panel) {
    panel.classList.toggle('active', panel.id === 'tab-' + tabName);
  });
  navLinks.forEach(function (link) {
    link.classList.toggle('active', link.dataset.tab === tabName);
  });
}

navLinks.forEach(function (link) {
  link.addEventListener('click', function (e) {
    e.preventDefault();
    activateTab(link.dataset.tab);
  });
});

/* ---------- Scan form elements ---------- */
const form = document.getElementById('scan-form');
const gaugeFill = document.getElementById('gauge-fill');
const gaugeScore = document.getElementById('gauge-score');
const verdict = document.getElementById('verdict');
const verdictLabel = document.getElementById('verdict-label');
const verdictDesc = document.getElementById('verdict-desc');
const signalList = document.getElementById('signal-list');
const submitBtn = form.querySelector('.scan-btn');

const statTotal = document.getElementById('stat-total');
const statFlagged = document.getElementById('stat-flagged');
const statAmount = document.getElementById('stat-amount');
const historyList = document.getElementById('history-list');

const GAUGE_CIRCUMFERENCE = 578; // 2 * PI * r(92), matches SVG in index.html
const STORAGE_KEY = 'upishield_stats_v1';
const HISTORY_KEY = 'upishield_history_v1';
const USER_KEY = 'upishield_user_v1';
const MAX_HISTORY = 8;

const KNOWN_HANDLES = [
  'okhdfcbank', 'okaxis', 'oksbi', 'okicici', 'okbizaxis',
  'ybl', 'paytm', 'apl', 'ibl', 'axl', 'upi', 'jio', 'freecharge', 'airtel', 'idfcbank'
];

const REASON_LABELS = {
  friend_family: 'Friend / Family',
  online_purchase: 'Online purchase',
  unknown_seller: 'Unknown seller / marketplace',
  refund: 'Claimed refund',
  investment: 'Investment / trading offer',
  prize: 'Prize / cashback claim',
  other: 'Other'
};

const REASON_RISK = {
  prize: { points: 60, label: 'Reason is "prize / cashback claim" — you are never charged to receive money, this is almost always a scam' },
  refund: { points: 61, label: 'Reason is "claimed refund" — refunds are credited automatically, never paid for' },
  investment: { points: 40, label: 'Reason is "investment / trading offer" — a common scam category on UPI' },
  unknown_seller: { points: 22, label: 'Paying an unverified seller / marketplace' },
  other: { points: 12, label: 'Reason given is unspecified ("other")' },
  online_purchase: { points: 0, label: null },
  friend_family: { points: 0, label: null }
};

/* ---------- Persistence helpers ---------- */
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupted storage */ }
  return fallback;
}

function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
}

function formatRupees(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeAgo(timestamp) {
  const diffMs = Date.now() - timestamp;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'mins ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'hours ago';
  return Math.floor(hrs / 24) + 'days ago';
}

/* ---------- Stats + history rendering ---------- */
function renderStats() {
  const stats = loadJSON(STORAGE_KEY, { totalChecks: 0, highRiskFlags: 0, totalAmount: 0 });
  statTotal.textContent = stats.totalChecks.toLocaleString('en-IN');
  statFlagged.textContent = stats.highRiskFlags.toLocaleString('en-IN');
  statAmount.textContent = formatRupees(stats.totalAmount);
}

function renderHistory() {
  const list = loadJSON(HISTORY_KEY, []);
  if (list.length === 0) {
    historyList.innerHTML = '<p class="history-empty">Nothing checked yet — your recent scans will show up here.</p>';
    return;
  }
  historyList.innerHTML = list.map(function (item, index) {
    return (
      '<div class="history-row" data-index="' + index + '" tabindex="0" role="button">' +
        '<span class="hr-id">' + escapeHtml(item.upiId) + '</span>' +
        '<span class="hr-name">' + escapeHtml(item.payeeName) + '</span>' +
        '<span class="hr-badge ' + item.level + '">' + item.levelLabel + '</span>' +
        '<span class="hr-amount">' + formatRupees(item.amount) + '</span>' +
        '<span class="hr-time">' + timeAgo(item.timestamp) + '</span>' +
      '</div>'
    );
  }).join('');
}

/* ---------- Transaction detail card (click a history row) ---------- */
const detailOverlay = document.getElementById('detail-overlay');
const detailClose = document.getElementById('detail-close');
const detailBody = document.getElementById('detail-body');

function openDetailCard(item) {
  const dateStr = new Date(item.timestamp).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const reasonLabel = REASON_LABELS[item.reason] || item.reason || 'Not specified';
  const signalsHtml = (item.signals || []).map(function (s) {
    return '<li class="signal-item">' + escapeHtml(s) + '</li>';
  }).join('');

  const scoreDisplay = (typeof item.score === 'number') ? item.score : '—';
  detailBody.innerHTML =
    '<div class="detail-score ' + item.level + '">' +
      '<div class="detail-score-num">' + scoreDisplay + '<span>/100</span></div>' +
      '<div class="detail-score-badge hr-badge ' + item.level + '">' + item.levelLabel + '</div>' +
    '</div>' +
    '<dl class="detail-fields">' +
      '<dt>UPI ID</dt><dd class="mono">' + escapeHtml(item.upiId) + '</dd>' +
      '<dt>Payee name</dt><dd>' + escapeHtml(item.payeeName) + '</dd>' +
      '<dt>Amount</dt><dd class="mono">' + formatRupees(item.amount) + '</dd>' +
      '<dt>Reason</dt><dd>' + escapeHtml(reasonLabel) + '</dd>' +
      '<dt>Checked</dt><dd>' + dateStr + '</dd>' +
    '</dl>' +
    (item.desc ? '<p class="detail-desc">' + escapeHtml(item.desc) + '</p>' : '') +
    (signalsHtml ? '<ul class="signal-list">' + signalsHtml + '</ul>' : '');

  detailOverlay.classList.remove('hidden');
}

function closeDetailCard() { detailOverlay.classList.add('hidden'); }

historyList.addEventListener('click', function (e) {
  const row = e.target.closest('.history-row');
  if (!row) return;
  const list = loadJSON(HISTORY_KEY, []);
  const item = list[parseInt(row.dataset.index, 10)];
  if (item) openDetailCard(item);
});

historyList.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('.history-row');
  if (!row) return;
  e.preventDefault();
  const list = loadJSON(HISTORY_KEY, []);
  const item = list[parseInt(row.dataset.index, 10)];
  if (item) openDetailCard(item);
});

detailClose.addEventListener('click', closeDetailCard);
detailOverlay.addEventListener('click', function (e) { if (e.target === detailOverlay) closeDetailCard(); });

/* ---------- Risk scoring ---------- */
function scoreTransaction(upiId, payeeName, amount, reason) {
  let score = 5; // small baseline — nothing is ever "0 risk" for real
  const signals = [];

  const parts = upiId.split('@');
  const validFormat = parts.length === 2 && parts[0].length > 0 && parts[1].length > 1;

  if (!validFormat) {
    score += 35;
    signals.push('UPI ID doesn\u2019t match the standard name@bank format');
  } else {
    const local = parts[0];
    const handle = parts[1];

    if (!KNOWN_HANDLES.includes(handle.toLowerCase())) {
      score += 14;
      signals.push('"@' + handle + '" isn\u2019t a widely recognized bank/PSP handle');
    }

    const digitCount = (local.match(/[0-9]/g) || []).length;
    const digitRatio = digitCount / local.length;
    if (local.length > 5 && digitRatio > 0.4) {
      score += 18;
      signals.push('The ID\u2019s username looks auto-generated (heavy on random digits)');
    }

    if (payeeName.trim()) {
      const normLocal = local.toLowerCase().replace(/[^a-z0-9]/g, '');
      const nameTokens = payeeName.toLowerCase().split(/\s+/).filter(function (t) { return t.length >= 3; });
      const hasOverlap = nameTokens.some(function (t) { return normLocal.includes(t) || t.includes(normLocal); });
      if (nameTokens.length > 0 && !hasOverlap) {
        score += 18;
        signals.push('Payee name doesn\u2019t resemble the UPI ID text at all');
      }
    }
  }

  const reasonInfo = REASON_RISK[reason] || { points: 0, label: null };
  score += reasonInfo.points;
  if (reasonInfo.label) signals.push(reasonInfo.label);

  const riskyReason = ['prize', 'refund', 'investment', 'unknown_seller', 'other'].includes(reason);
  if (amount >= 10000 && riskyReason) {
    score += 12;
    signals.push('A relatively large amount for this type of transaction');
  }
  if (amount >= 50000) {
    score += 8;
    signals.push('High-value transfer — worth a second confirmation regardless');
  }

  score = Math.max(0, Math.min(100, score));

  let level, levelLabel, desc;
  if (score < 30) {
    level = 'low'; levelLabel = 'Low risk';
    desc = 'No major red flags found. Still worth a quick sanity check before paying.';
  } else if (score < 65) {
    level = 'medium'; levelLabel = 'Moderate risk';
    desc = 'A few caution signals here. Verify the payee through another channel before paying.';
  } else {
    level = 'high'; levelLabel = 'High risk';
    desc = 'Multiple red flags detected. We\u2019d recommend not paying until you\u2019ve verified this independently.';
  }

  if (signals.length === 0) signals.push('No specific signals triggered on this check.');

  return { score: score, level: level, levelLabel: levelLabel, desc: desc, signals: signals };
}

/* ---------- Gauge rendering ---------- */
function setGauge(score) {
  const offset = GAUGE_CIRCUMFERENCE - (GAUGE_CIRCUMFERENCE * score) / 100;
  gaugeFill.style.strokeDashoffset = offset;
  gaugeScore.textContent = score;
}

/* ---------- Form handling ---------- */
form.addEventListener('submit', function (e) {
  e.preventDefault();

  const upiId = document.getElementById('upi-id').value.trim();
  const payeeName = document.getElementById('payee-name').value.trim();
  const amount = parseFloat(document.getElementById('amount').value) || 0;
  const reason = document.getElementById('reason').value;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Checking\u2026';

  setTimeout(function () {
    const result = scoreTransaction(upiId, payeeName, amount, reason);

    setGauge(result.score);
    verdict.className = 'verdict ' + result.level;
    verdictLabel.textContent = result.levelLabel;
    verdictDesc.textContent = result.desc;
    signalList.innerHTML = result.signals.map(function (s) {
      return '<li class="signal-item">' + escapeHtml(s) + '</li>';
    }).join('');

    const stats = loadJSON(STORAGE_KEY, { totalChecks: 0, highRiskFlags: 0, totalAmount: 0 });
    stats.totalChecks += 1;
    stats.totalAmount += amount;
    if (result.level === 'high') stats.highRiskFlags += 1;
    saveJSON(STORAGE_KEY, stats);
    renderStats();

    const history = loadJSON(HISTORY_KEY, []);
    history.unshift({
      upiId: upiId, payeeName: payeeName, amount: amount, reason: reason,
      score: result.score, level: result.level, levelLabel: result.levelLabel,
      desc: result.desc, signals: result.signals,
      timestamp: Date.now()
    });
    saveJSON(HISTORY_KEY, history.slice(0, MAX_HISTORY));
    renderHistory();

    submitBtn.disabled = false;
    submitBtn.textContent = 'Check this payment';
  }, 450);
});

/* ---------- Auth mockup (UI only, see file header note) ---------- */
const navRight = document.getElementById('nav-right');
const btnLogin = document.getElementById('btn-login');
const btnSignup = document.getElementById('btn-signup');
const authOverlay = document.getElementById('auth-overlay');
const modalClose = document.getElementById('modal-close');
const modalTabs = document.querySelectorAll('.modal-tab');
const fieldName = document.getElementById('field-name');
const authForm = document.getElementById('auth-form');
const authSubmit = document.getElementById('auth-submit');

let authMode = 'login';

function openAuthModal(mode) {
  authMode = mode;
  updateAuthModeUI();
  authOverlay.classList.remove('hidden');
}

function closeAuthModal() { authOverlay.classList.add('hidden'); }

function updateAuthModeUI() {
  modalTabs.forEach(function (tab) { tab.classList.toggle('active', tab.dataset.mode === authMode); });
  fieldName.style.display = authMode === 'signup' ? 'flex' : 'none';
  authSubmit.textContent = authMode === 'signup' ? 'Create account' : 'Log in';
}

btnLogin.addEventListener('click', function () { openAuthModal('login'); });
btnSignup.addEventListener('click', function () { openAuthModal('signup'); });
modalClose.addEventListener('click', closeAuthModal);
authOverlay.addEventListener('click', function (e) { if (e.target === authOverlay) closeAuthModal(); });

modalTabs.forEach(function (tab) {
  tab.addEventListener('click', function () {
    authMode = tab.dataset.mode;
    updateAuthModeUI();
  });
});

authForm.addEventListener('submit', function (e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const nameInput = document.getElementById('auth-name').value.trim();
  const displayName = authMode === 'signup' && nameInput ? nameInput : email.split('@')[0];

  saveJSON(USER_KEY, { displayName: displayName, email: email });
  renderAuthState();
  closeAuthModal();
  authForm.reset();
});

function renderAuthState() {
  const user = loadJSON(USER_KEY, null);
  if (user) {
    navRight.innerHTML =
      '<div class="user-chip">Hi, <strong>' + escapeHtml(user.displayName) + '</strong></div>' +
      '<button class="btn-ghost" id="btn-logout">Log out</button>';
    document.getElementById('btn-logout').addEventListener('click', function () {
      localStorage.removeItem(USER_KEY);
      renderAuthState();
    });
  } else {
    navRight.innerHTML =
      '<button class="btn-ghost" id="btn-login">Log in</button>' +
      '<button class="btn-primary" id="btn-signup">Sign up</button>';
    document.getElementById('btn-login').addEventListener('click', function () { openAuthModal('login'); });
    document.getElementById('btn-signup').addEventListener('click', function () { openAuthModal('signup'); });
  }
}

/* ---------- Init ---------- */
renderStats();
renderHistory();
renderAuthState();
