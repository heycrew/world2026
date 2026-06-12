/* ===== 球场八爪鱼 · 前端应用逻辑 ===== */

// ========== 球队国旗映射 ==========
const FLAG_MAP = {
  '墨西哥': '🇲🇽', '南非': '🇿🇦', '韩国': '🇰🇷', '捷克': '🇨🇿',
  '加拿大': '🇨🇦', '波黑': '🇧🇦', '卡塔尔': '🇶🇦', '瑞士': '🇨🇭',
  '巴西': '🇧🇷', '摩洛哥': '🇲🇦', '海地': '🇭🇹', '苏格兰': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  '美国': '🇺🇸', '巴拉圭': '🇵🇾', '澳大利亚': '🇦🇺', '土耳其': '🇹🇷',
  '德国': '🇩🇪', '库拉索': '🇨🇼', '科特迪瓦': '🇨🇮', '厄瓜多尔': '🇪🇨',
  '荷兰': '🇳🇱', '日本': '🇯🇵', '瑞典': '🇸🇪', '突尼斯': '🇹🇳',
  '比利时': '🇧🇪', '埃及': '🇪🇬', '伊朗': '🇮🇷', '新西兰': '🇳🇿',
  '西班牙': '🇪🇸', '佛得角': '🇨🇻', '沙特': '🇸🇦', '乌拉圭': '🇺🇾',
  '法国': '🇫🇷', '塞内加尔': '🇸🇳', '伊拉克': '🇮🇶', '挪威': '🇳🇴',
  '阿根廷': '🇦🇷', '阿尔及利亚': '🇩🇿', '奥地利': '🇦🇹', '约旦': '🇯🇴',
  '葡萄牙': '🇵🇹', '刚果金': '🇨🇩', '乌兹别克斯坦': '🇺🇿', '哥伦比亚': '🇨🇴',
  '英格兰': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '克罗地亚': '🇭🇷', '加纳': '🇬🇭', '巴拿马': '🇵🇦'
};

// ========== 分组数据 ==========
const GROUPS = {
  A: ['墨西哥', '南非', '韩国', '捷克'],
  B: ['加拿大', '波黑', '卡塔尔', '瑞士'],
  C: ['巴西', '摩洛哥', '海地', '苏格兰'],
  D: ['美国', '巴拉圭', '澳大利亚', '土耳其'],
  E: ['德国', '库拉索', '科特迪瓦', '厄瓜多尔'],
  F: ['荷兰', '日本', '瑞典', '突尼斯'],
  G: ['比利时', '埃及', '伊朗', '新西兰'],
  H: ['西班牙', '佛得角', '沙特', '乌拉圭'],
  I: ['法国', '塞内加尔', '伊拉克', '挪威'],
  J: ['阿根廷', '阿尔及利亚', '奥地利', '约旦'],
  K: ['葡萄牙', '刚果金', '乌兹别克斯坦', '哥伦比亚'],
  L: ['英格兰', '克罗地亚', '加纳', '巴拿马']
};

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
  initTeamSelects();
  renderGroups();
  startCountdown();
  initParticles();
  initNavScroll();
  initSelectorListeners();
  fetchIntelligence();
});

// ========== 球队选择器 ==========
function initTeamSelects() {
  const allTeams = Object.values(GROUPS).flat().sort((a, b) => a.localeCompare(b, 'zh'));

  const teamASelect = document.getElementById('teamASelect');
  const teamBSelect = document.getElementById('teamBSelect');

  allTeams.forEach(team => {
    const optA = document.createElement('option');
    optA.value = team;
    optA.textContent = team;
    teamASelect.appendChild(optA);

    const optB = document.createElement('option');
    optB.value = team;
    optB.textContent = team;
    teamBSelect.appendChild(optB);
  });

  // 默认选中揭幕战
  teamASelect.value = '墨西哥';
  teamBSelect.value = '南非';
  updateFlags();
  checkPredictReady();
}

function initSelectorListeners() {
  document.getElementById('teamASelect').addEventListener('change', () => {
    updateFlags();
    checkPredictReady();
  });
  document.getElementById('teamBSelect').addEventListener('change', () => {
    updateFlags();
    checkPredictReady();
  });

  document.getElementById('predictBtn').addEventListener('click', handlePredict);
}

function updateFlags() {
  const teamA = document.getElementById('teamASelect').value;
  const teamB = document.getElementById('teamBSelect').value;
  const flagA = document.getElementById('teamAFlag');
  const flagB = document.getElementById('teamBFlag');
  if (flagA) flagA.textContent = FLAG_MAP[teamA] || '';
  if (flagB) flagB.textContent = FLAG_MAP[teamB] || '';
}

function checkPredictReady() {
  const teamA = document.getElementById('teamASelect').value;
  const teamB = document.getElementById('teamBSelect').value;
  const btn = document.getElementById('predictBtn');
  btn.disabled = !teamA || !teamB || teamA === teamB;
}

// ========== 预测请求 ==========
async function handlePredict() {
  const teamA = document.getElementById('teamASelect').value;
  const teamB = document.getElementById('teamBSelect').value;
  const stage = document.getElementById('stageSelect').value;

  if (!teamA || !teamB) return;
  if (teamA === teamB) {
    showError('请选择两支不同的球队');
    return;
  }

  // UI 状态切换
  const loading = document.getElementById('loadingOverlay');
  const result = document.getElementById('predictionResult');
  const error = document.getElementById('errorMessage');

  loading.classList.remove('hidden');
  result.classList.add('hidden');
  error.classList.add('hidden');

  document.getElementById('predictBtn').disabled = true;

  try {
    const response = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamA, teamB, stage }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '预测服务异常');
    }

    renderPrediction(data, teamA, teamB, stage);
  } catch (err) {
    showError(err.message);
  } finally {
    loading.classList.add('hidden');
    document.getElementById('predictBtn').disabled = false;
  }
}

function renderPrediction(data, teamA, teamB, stage) {
  const result = document.getElementById('predictionResult');
  result.classList.remove('hidden');

  // 确定哪边是 A 哪边是 B（API 返回的 teamA.name 可能和请求一致）
  const aName = data.teamA.name;
  const bName = data.teamB.name;
  const probA = data.teamA.winProb;
  const probB = data.teamB.winProb;
  const draw = data.draw;

  // 置信度
  const badge = document.getElementById('resultConfidence');
  badge.textContent = data.confidence === '高' ? '🟢 高置信度' : data.confidence === '中' ? '🟡 中置信度' : '🔴 低置信度';
  badge.className = 'result-badge ' + (data.confidence === '高' ? 'confidence-high' : data.confidence === '中' ? 'confidence-mid' : 'confidence-low');

  // 阶段
  document.getElementById('resultStage').textContent = stage;

  // 记分牌
  document.getElementById('resultTeamA').textContent = aName;
  document.getElementById('resultTeamB').textContent = bName;
  document.getElementById('flagA').textContent = FLAG_MAP[aName] || '🏴';
  document.getElementById('flagB').textContent = FLAG_MAP[bName] || '🏴';

  document.getElementById('probA').textContent = probA;
  document.getElementById('probB').textContent = probB;
  document.getElementById('drawProb').textContent = draw;

  // 胜率条
  document.getElementById('barA').style.width = probA + '%';
  document.getElementById('barB').style.width = probB + '%';

  // 预测比分
  document.getElementById('predictedScore').textContent = data.predictedScore || '?-?';

  // 关键因素
  const factorsContainer = document.getElementById('keyFactors');
  factorsContainer.innerHTML = '';
  (data.keyFactors || []).forEach(f => {
    const tag = document.createElement('span');
    tag.className = 'factor-tag';
    tag.textContent = f;
    factorsContainer.appendChild(tag);
  });

  // 分析
  document.getElementById('analysisText').textContent = data.analysis || '暂无分析';

  // 关键球员
  const playersContainer = document.getElementById('playersToWatch');
  playersContainer.innerHTML = '';
  (data.playersToWatch || []).forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.innerHTML = `
      <div class="player-avatar">⭐</div>
      <div class="player-info">
        <div class="player-team">${p.team || ''}</div>
        <div class="player-name">${p.player || ''}</div>
        <div class="player-reason">${p.reason || ''}</div>
      </div>
    `;
    playersContainer.appendChild(card);
  });

  // 滚动到结果
  result.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showError(msg) {
  const error = document.getElementById('errorMessage');
  document.getElementById('errorText').textContent = msg;
  error.classList.remove('hidden');
}

// ========== 情报状态 ==========
async function fetchIntelligence() {
  try {
    const resp = await fetch('/api/intelligence');
    const data = await resp.json();
    const intelText = document.getElementById('intelText');
    const intelDot = document.querySelector('.intel-dot');

    if (data.date && data.date !== '未知') {
      const today = new Date().toISOString().split('T')[0];
      const isFresh = data.date >= today;
      intelText.textContent = `📰 每日情报：${data.date} ${isFresh ? '✅ 最新' : '⚠️ 待更新'}`;
      if (!isFresh) intelDot.classList.add('stale');
    } else {
      intelText.textContent = '📰 每日情报：加载中...';
    }
  } catch (e) {
    document.getElementById('intelText').textContent = '📰 每日情报：离线模式';
  }
}

// ========== 分组渲染 ==========
function renderGroups() {
  const grid = document.getElementById('groupsGrid');
  if (!grid) return;

  Object.entries(GROUPS).forEach(([letter, teams]) => {
    const card = document.createElement('div');
    card.className = 'group-card';
    card.innerHTML = `
      <div class="group-card-header">
        <span class="group-letter">${letter}</span>
        <span>${letter} 组</span>
      </div>
      <ul class="group-team-list">
        ${teams.map((t, i) => `
          <li class="group-team-item" style="animation-delay:${i * 0.1}s">
            <span class="team-flag-sm">${FLAG_MAP[t] || '🏴'}</span>
            <span>${t}</span>
          </li>
        `).join('')}
      </ul>
    `;
    grid.appendChild(card);
  });
}

// ========== 赛事倒计时 ==========
function startCountdown() {
  const GROUPS_END = new Date('2026-06-28T00:00:00-06:00');
  const FINAL = new Date('2026-07-19T12:00:00-06:00');

  function getTarget() {
    const now = new Date();
    if (now < GROUPS_END) return { date: GROUPS_END, title: '🏟️ 小组赛阶段 · 32强即将揭晓' };
    return { date: FINAL, title: '🏆 世界杯决赛倒计时 · 冠军之战' };
  }

  function update() {
    const now = new Date();
    const { date: target, title } = getTarget();
    const diff = target - now;

    if (diff <= 0) {
      document.getElementById('countdownTitle') && (document.getElementById('countdownTitle').textContent = '🏆 2026世界杯已落幕！感谢关注');
      ['cd-days', 'cd-hours', 'cd-mins', 'cd-secs'].forEach(id => {
        document.getElementById(id).textContent = '0';
      });
      return;
    }

    document.getElementById('countdownTitle') && (document.getElementById('countdownTitle').textContent = title);

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    document.getElementById('cd-days').textContent = days;
    document.getElementById('cd-hours').textContent = String(hours).padStart(2, '0');
    document.getElementById('cd-mins').textContent = String(mins).padStart(2, '0');
    document.getElementById('cd-secs').textContent = String(secs).padStart(2, '0');
  }

  update();
  setInterval(update, 1000);
}

// ========== 粒子背景 ==========
function initParticles() {
  const canvas = document.getElementById('particlesCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let particles = [];
  const maxParticles = 50;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() {
      this.reset();
      this.y = Math.random() * canvas.height;
    }
    reset() {
      this.x = Math.random() * canvas.width;
      this.y = -10;
      this.size = Math.random() * 2 + 1;
      this.speed = Math.random() * 0.5 + 0.2;
      this.opacity = Math.random() * 0.5 + 0.1;
      this.color = Math.random() < 0.3 ? '240, 192, 64' : '10, 138, 63';
    }
    update() {
      this.y += this.speed;
      if (this.y > canvas.height + 10) this.reset();
    }
    draw(ctx) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${this.color}, ${this.opacity})`;
      ctx.fill();
    }
  }

  for (let i = 0; i < maxParticles; i++) {
    particles.push(new Particle());
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.update();
      p.draw(ctx);
    });
    requestAnimationFrame(animate);
  }
  animate();
}

// ========== Nav 滚动高亮 ==========
function initNavScroll() {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-link');

  window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(section => {
      const top = section.offsetTop - 100;
      if (window.scrollY >= top) {
        current = section.getAttribute('id');
      }
    });
    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === '#' + current) {
        link.classList.add('active');
      }
    });
  });
}
