require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ===== 路径与常量 =====
const skillPath = path.join(__dirname, '..', 'skill.md');
const intelligencePath = path.join(__dirname, '..', 'intelligence.md');
const resultsPath = path.join(__dirname, 'confirmed_results.json');
const SKILL_RAW = fs.readFileSync(skillPath, 'utf-8');

// 解析 skill.md：分离稳定基（一~五节）和每日情报（第六节）
const SECTION6_MARKER = '## 六、最新情报（每日更新区）';
const section6Index = SKILL_RAW.indexOf(SECTION6_MARKER);
const SKILL_BASE = section6Index > 0 ? SKILL_RAW.substring(0, section6Index).trimEnd() : SKILL_RAW;

// ===== 已确认比赛结果（结构化数据源，自动刷新不会覆盖） =====
function loadConfirmedResults() {
  try {
    if (fs.existsSync(resultsPath)) {
      return JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
    }
  } catch (e) {
    console.error('⚠️ 读取 confirmed_results.json 失败:', e.message);
  }
  return { lastUpdated: null, matches: [], highlights: [] };
}

let confirmedResults = loadConfirmedResults();

function saveConfirmedResults() {
  confirmedResults.lastUpdated = new Date().toISOString().split('T')[0];
  fs.writeFileSync(resultsPath, JSON.stringify(confirmedResults, null, 2), 'utf-8');
}

// ===== 情报构建引擎（核心） =====

// 根据 confirmed_results.json + 赛程 → 生成完整情报 markdown
function buildIntelligenceFromData(extraInsights = '') {
  const today = new Date().toISOString().split('T')[0];
  const matches = getUpcomingMatches();
  const results = confirmedResults.matches || [];
  const highlights = confirmedResults.highlights || [];

  // 按日期分组已完赛结果
  const completedByDate = {};
  results.forEach(m => {
    const d = m.date;
    if (!completedByDate[d]) completedByDate[d] = [];
    completedByDate[d].push(m);
  });

  let md = '## 六、最新情报（每日更新区）\n\n';
  md += '> 本节由每日情报流程覆盖更新。**当本节与第四节冲突时，以本节为准**（本节更新）。\n\n';
  md += `**情报日期：${today}**\n\n`;

  // === 已确认赛果 ===
  if (results.length > 0) {
    const sortedDates = Object.keys(completedByDate).sort();
    md += '### 已确认赛果\n\n';
    md += '| 日期 | 组 | 比赛 | 比分 |\n';
    md += '|------|----|------|------|\n';
    sortedDates.forEach(date => {
      completedByDate[date].forEach(m => {
        md += `| ${m.date} | ${m.group} | ${m.teamA} vs ${m.teamB} | ${m.scoreA}-${m.scoreB} |\n`;
      });
    });
    md += '\n';
  }

  // === 关键看点 ===
  if (highlights.length > 0) {
    md += '### 关键看点\n\n';
    highlights.forEach(h => { md += `- ${h}\n`; });
    md += '\n';
  }

  // === 今日/明日赛程 ===
  if (matches.today || matches.tomorrow) {
    md += '### 赛程\n\n';
    md += '| 类型 | 比赛 |\n';
    md += '|------|------|\n';
    if (matches.today) {
      matches.today.matches.forEach(m => { md += `| 🟢 今日 | ${m} |\n`; });
    }
    if (matches.tomorrow) {
      matches.tomorrow.matches.forEach(m => { md += `| 🔵 明日 | ${m} |\n`; });
    }
    if (!matches.today && !matches.tomorrow) {
      md += '| — | 今日暂无比赛 |\n';
    }
    md += '\n';
  }

  // === 伤停/状态（来自 AI 或手动） ===
  if (extraInsights && extraInsights.trim().length > 10) {
    md += '### 伤停/状态变动\n\n';
    md += extraInsights.trim() + '\n';
  } else {
    md += '### 伤停/状态变动\n\n- 暂无经确认的伤停变动，按第四节资料执行\n';
  }

  return md.trim();
}

// 加载情报：优先从 intelligence.md，若不存在或过期则从结构化数据重建
function loadIntelligence() {
  // 优先从结构化数据重建（确保比分不会被覆盖）
  const rebuilt = buildIntelligenceFromData();
  if (fs.existsSync(intelligencePath)) {
    const cached = fs.readFileSync(intelligencePath, 'utf-8').trim();
    // 如果缓存的情报日期 < 今日，使用重建版本
    const cachedDate = (cached.match(/情报日期[：:]\s*(\d{4}-\d{2}-\d{2})/) || [])[1];
    const today = new Date().toISOString().split('T')[0];
    if (cachedDate && cachedDate >= today) {
      return cached;
    }
  }
  // 写入重建版本
  fs.writeFileSync(intelligencePath, rebuilt, 'utf-8');
  return rebuilt;
}

let currentIntelligence = loadIntelligence();

// 组装完整 system prompt
function buildSystemPrompt() {
  return SKILL_BASE + '\n\n' + currentIntelligence;
}

// 提取情报日期
function getIntelligenceDate() {
  const match = currentIntelligence.match(/情报日期[：:]\s*(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

// LLM 客户端配置
let aiClient = null;

function getAIClient() {
  if (aiClient) return aiClient;
  // 兼容 openai 和 @anthropic 等多种 SDK
  const OpenAI = require('openai');
  aiClient = new OpenAI({
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY || '',
  });
  return aiClient;
}

const app = express();

// 安全：隐藏技术栈标识
app.disable('x-powered-by');

app.use(cors());
app.use(express.json());

// 静态文件服务（前端页面）
app.use(express.static(path.join(__dirname, '..', 'public')));

// 安全：错误信息脱敏，不泄露 API Key
function sanitizeError(err) {
  const msg = (err.message || '') + ' ' + (err.response?.body || err.response?.data || '');
  return msg.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***REDACTED***');
}

// ===== API 路由 =====

// 单场预测
app.post('/api/predict', async (req, res) => {
  try {
    const { teamA, teamB, stage = '小组赛' } = req.body;
    console.log(`📥 预测请求: ${teamA} vs ${teamB} [${stage}] (teamA hex: ${Buffer.from(teamA||'', 'utf-8').toString('hex')}, teamB hex: ${Buffer.from(teamB||'', 'utf-8').toString('hex')})`);
    if (!teamA || !teamB) {
      return res.status(400).json({ error: '请提供 teamA 和 teamB' });
    }

    const client = getAIClient();
    const userMsg = `🔴 最高优先级指令：你正在为用户预测一场假设性比赛。用户指定的对阵是：【${stage}】${teamA} vs ${teamB}。\n⚠️ 你必须原样使用 ${teamA} 和 ${teamB} 作为对阵双方。即使这与实际世界杯分组或赛程不符，也严禁替换球队。这是用户的假设场景分析，不是错误。\n请严格按约束文档的 JSON 格式输出预测，禁止输出任何非 JSON 内容。`;

    // 带重试的 API 调用（最多2次）
    let resp;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        resp = await client.chat.completions.create({
          model: 'deepseek-chat',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user', content: userMsg },
          ],
          temperature: 0.3,
          max_tokens: 1200,
        });
        const content = (resp.choices[0].message.content || '').trim();
        if (content) break; // 有内容就跳出
        console.log(`Attempt ${attempt + 1}: 空内容，重试...`);
      } catch (e) {
        lastError = e;
        console.log(`Attempt ${attempt + 1} failed: ${e.message}`);
        if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!resp) {
      throw lastError || new Error('API 调用失败');
    }

    const rawContent = (resp.choices[0].message.content || '').trim();
    if (!rawContent) {
      console.error('DeepSeek 返回空内容（已重试2次）');
      return res.status(502).json({ error: 'AI 服务暂时繁忙，请稍后重试' });
    }
    console.log('DeepSeek raw (first 200 chars):', rawContent.substring(0, 200));

    // 清理可能的 markdown 代码块包裹
    const jsonContent = rawContent
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let prediction;
    try {
      prediction = JSON.parse(jsonContent);
    } catch (parseErr) {
      console.error('JSON 解析失败:', parseErr.message);
      return res.status(502).json({
        error: 'AI 返回格式解析失败',
        raw: rawContent.substring(0, 500),
      });
    }

    res.json(prediction);
  } catch (err) {
    console.error('预测失败:', sanitizeError(err));
    res.status(500).json({
      error: '预测服务暂时不可用，请稍后重试',
    });
  }
});

// ===== 每日情报 API（v2：结构化数据驱动 + AI 补充） =====

// 根据赛程数组生成当日/次日对阵列表
function getUpcomingMatches() {
  const today = new Date();
  const openerDate = new Date('2026-06-11');
  const dayIndex = Math.floor((today - openerDate) / (1000 * 60 * 60 * 24));

  // 小组赛完整赛程（基于真实分组）
  // Round 1: A-H组 6/11-16, I-L组 6/16-17
  // Round 2: 6/17-22, Round 3: 6/23-27
  const schedule = [
    // === 第一轮 ===
    { day: 0, matches: ['墨西哥 vs 南非（揭幕战·阿兹特克）', '韩国 vs 捷克'] },
    { day: 1, matches: ['加拿大 vs 波黑（多伦多）', '美国 vs 巴拉圭（英格尔伍德）'] },
    { day: 2, matches: ['巴西 vs 摩洛哥', '海地 vs 苏格兰'] },
    { day: 3, matches: ['德国 vs 库拉索', '科特迪瓦 vs 厄瓜多尔'] },
    { day: 4, matches: ['荷兰 vs 日本', '瑞典 vs 突尼斯'] },
    { day: 5, matches: ['比利时 vs 埃及', '伊朗 vs 新西兰', '西班牙 vs 佛得角', '沙特 vs 乌拉圭'] },
    { day: 6, matches: ['法国 vs 塞内加尔（纽约）', '伊拉克 vs 挪威（波士顿）', '阿根廷 vs 阿尔及利亚（堪萨斯城）'] },
    { day: 7, matches: ['奥地利 vs 约旦（旧金山）', '葡萄牙 vs 刚果金（休斯顿）', '英格兰 vs 克罗地亚（达拉斯）', '加纳 vs 巴拿马（多伦多）', '乌兹别克斯坦 vs 哥伦比亚（墨西哥城）'] },
    // === 第二轮 ===
    { day: 8, matches: ['墨西哥 vs 韩国', '南非 vs 捷克', '加拿大 vs 卡塔尔', '波黑 vs 瑞士'] },
    { day: 9, matches: ['巴西 vs 海地', '摩洛哥 vs 苏格兰', '美国 vs 澳大利亚', '巴拉圭 vs 土耳其'] },
    { day: 10, matches: ['德国 vs 科特迪瓦', '库拉索 vs 厄瓜多尔', '荷兰 vs 瑞典', '日本 vs 突尼斯'] },
    { day: 11, matches: ['比利时 vs 伊朗', '埃及 vs 新西兰', '西班牙 vs 沙特', '佛得角 vs 乌拉圭'] },
    { day: 12, matches: ['法国 vs 伊拉克', '塞内加尔 vs 挪威', '阿根廷 vs 约旦', '阿尔及利亚 vs 奥地利'] },
    { day: 13, matches: ['葡萄牙 vs 乌兹别克斯坦', '刚果金 vs 哥伦比亚', '英格兰 vs 巴拿马', '克罗地亚 vs 加纳'] },
    // === 第三轮（同组同时开球） ===
    { day: 14, matches: ['墨西哥 vs 捷克', '南非 vs 韩国', '加拿大 vs 瑞士', '波黑 vs 卡塔尔'] },
    { day: 15, matches: ['巴西 vs 苏格兰', '摩洛哥 vs 海地', '美国 vs 土耳其', '巴拉圭 vs 澳大利亚'] },
    { day: 16, matches: ['德国 vs 厄瓜多尔', '库拉索 vs 科特迪瓦', '荷兰 vs 突尼斯', '日本 vs 瑞典'] },
    { day: 17, matches: ['比利时 vs 新西兰', '埃及 vs 伊朗', '西班牙 vs 乌拉圭', '佛得角 vs 沙特'] },
    { day: 18, matches: ['法国 vs 挪威', '塞内加尔 vs 伊拉克', '阿根廷 vs 奥地利', '阿尔及利亚 vs 约旦'] },
    { day: 19, matches: ['葡萄牙 vs 哥伦比亚', '刚果金 vs 乌兹别克斯坦', '英格兰 vs 加纳', '克罗地亚 vs 巴拿马'] },
  ];

  const todayEntry = schedule.find(s => s.day === dayIndex);
  const tomorrowEntry = schedule.find(s => s.day === dayIndex + 1);
  return { today: todayEntry, tomorrow: tomorrowEntry, dayIndex };
}

// 获取当前情报
app.get('/api/intelligence', (req, res) => {
  const date = getIntelligenceDate();
  const matches = getUpcomingMatches();
  res.json({
    date: date || '未知',
    content: currentIntelligence,
    updated: date ? (new Date(date).toISOString()) : null,
    autoRefresh: true,
    refreshInterval: '每6小时自动检查，情报过期时自动从结构化数据重建',
    results: confirmedResults.matches || [],
    highlights: confirmedResults.highlights || [],
    upcoming: {
      today: matches.today ? matches.today.matches : [],
      tomorrow: matches.tomorrow ? matches.tomorrow.matches : [],
      dayIndex: matches.dayIndex,
    },
  });
});

// 手动刷新情报（从结构化数据重建 + AI补充伤停）
app.post('/api/intelligence/refresh', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // 尝试用 AI 生成伤停/状态补充
    let aiInsights = '';
    try {
      const client = getAIClient();
      const matches = getUpcomingMatches();
      const todayMatches = matches.today ? matches.today.matches.join('；') : '今日无比赛';
      const resp = await client.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: `你是世界杯伤停情报编辑。基于你的足球知识，列出截至2026年6月可确认的球队伤停/状态变动。只写真实可确认的信息，不确定的写"暂无经确认的伤停变动，按第四节资料执行"。格式：每行以"- "开头，每条20字以内。输出纯文本，不要markdown标题。` },
          { role: 'user', content: `今日对阵: ${todayMatches}\n请列出今日涉及球队的伤停状态。` },
        ],
        temperature: 0.2,
        max_tokens: 300,
      });
      aiInsights = (resp.choices[0].message.content || '').trim();
    } catch (aiErr) {
      console.log('AI 伤停补充失败，使用默认:', aiErr.message);
    }

    // 从结构化数据重建情报
    const newIntel = buildIntelligenceFromData(aiInsights);
    if (!newIntel || newIntel.length < 100) {
      return res.status(502).json({ error: '情报生成失败' });
    }

    fs.writeFileSync(intelligencePath, newIntel, 'utf-8');
    currentIntelligence = newIntel;
    console.log(`📰 情报已手动刷新: ${today}`);

    res.json({ success: true, date: getIntelligenceDate(), content: newIntel });
  } catch (err) {
    console.error('情报刷新失败:', sanitizeError(err));
    res.status(500).json({ error: '情报刷新失败' });
  }
});

// 自动刷新（被 setInterval 和启动时调用）
async function autoRefreshIntelligence() {
  const intelDate = getIntelligenceDate();
  const today = new Date().toISOString().split('T')[0];

  if (!intelDate) {
    console.log(`📰 情报日期缺失，从结构化数据重建`);
    const newIntel = buildIntelligenceFromData();
    if (newIntel) {
      fs.writeFileSync(intelligencePath, newIntel, 'utf-8');
      currentIntelligence = newIntel;
    }
    return;
  }

  if (intelDate >= today) {
    console.log(`📰 情报日期 ${intelDate} ≥ 今日 ${today}，无需更新`);
    return;
  }

  console.log(`📰 情报过期（${intelDate} < ${today}），自动重建中...`);

  // 从结构化数据重建情报（不依赖 AI，保证比分数据不丢失）
  const newIntel = buildIntelligenceFromData();
  if (newIntel && newIntel.length >= 100) {
    fs.writeFileSync(intelligencePath, newIntel, 'utf-8');
    currentIntelligence = newIntel;
    console.log(`📰 情报自动更新完成: ${today}`);
  } else {
    console.log('📰 自动更新生成内容不符合要求，跳过');
  }
}

// ===== 比赛结果管理 API =====

// 获取所有已确认结果
app.get('/api/results', (req, res) => {
  res.json(confirmedResults);
});

// 添加/更新比赛结果
app.post('/api/results', (req, res) => {
  const { match, highlights: newHighlights } = req.body;

  if (match) {
    const { date, group, teamA, teamB, scoreA, scoreB, stage, round } = match;
    if (!teamA || !teamB || scoreA === undefined || scoreB === undefined) {
      return res.status(400).json({ error: '缺少必填字段：teamA, teamB, scoreA, scoreB' });
    }

    // 查找是否已存在相同对阵
    const existingIdx = confirmedResults.matches.findIndex(
      m => m.teamA === teamA && m.teamB === teamB && m.round === (round || 1)
    );

    const newMatch = {
      date: date || new Date().toISOString().split('T')[0],
      group: group || '?',
      teamA,
      teamB,
      scoreA: parseInt(scoreA),
      scoreB: parseInt(scoreB),
      stage: stage || '小组赛',
      round: round || 1,
    };

    if (existingIdx >= 0) {
      confirmedResults.matches[existingIdx] = newMatch;
    } else {
      confirmedResults.matches.push(newMatch);
    }

    console.log(`📊 比分更新: ${teamA} ${scoreA}-${scoreB} ${teamB}`);
  }

  if (newHighlights && Array.isArray(newHighlights)) {
    confirmedResults.highlights = newHighlights;
  }

  saveConfirmedResults();

  // 自动重建情报
  const newIntel = buildIntelligenceFromData();
  fs.writeFileSync(intelligencePath, newIntel, 'utf-8');
  currentIntelligence = newIntel;

  res.json({ success: true, results: confirmedResults });
});

// 批量导入结果
app.post('/api/results/batch', (req, res) => {
  const { matches: newMatches, highlights: newHighlights } = req.body;

  if (!newMatches || !Array.isArray(newMatches)) {
    return res.status(400).json({ error: '请提供 matches 数组' });
  }

  newMatches.forEach(match => {
    const existingIdx = confirmedResults.matches.findIndex(
      m => m.teamA === match.teamA && m.teamB === match.teamB && m.round === (match.round || 1)
    );
    const normalized = {
      date: match.date,
      group: match.group || '?',
      teamA: match.teamA,
      teamB: match.teamB,
      scoreA: parseInt(match.scoreA),
      scoreB: parseInt(match.scoreB),
      stage: match.stage || '小组赛',
      round: match.round || 1,
    };
    if (existingIdx >= 0) {
      confirmedResults.matches[existingIdx] = normalized;
    } else {
      confirmedResults.matches.push(normalized);
    }
  });

  if (newHighlights && Array.isArray(newHighlights)) {
    confirmedResults.highlights = newHighlights;
  }

  saveConfirmedResults();

  const newIntel = buildIntelligenceFromData();
  fs.writeFileSync(intelligencePath, newIntel, 'utf-8');
  currentIntelligence = newIntel;

  console.log(`📊 批量导入 ${newMatches.length} 场比赛结果`);
  res.json({ success: true, count: newMatches.length, total: confirmedResults.matches.length });
});

// 删除某条结果
app.delete('/api/results', (req, res) => {
  const { teamA, teamB, round } = req.body;
  if (!teamA || !teamB) {
    return res.status(400).json({ error: '请提供 teamA 和 teamB' });
  }

  const idx = confirmedResults.matches.findIndex(
    m => m.teamA === teamA && m.teamB === teamB && m.round === (round || 1)
  );

  if (idx >= 0) {
    confirmedResults.matches.splice(idx, 1);
    saveConfirmedResults();
    const newIntel = buildIntelligenceFromData();
    fs.writeFileSync(intelligencePath, newIntel, 'utf-8');
    currentIntelligence = newIntel;
    res.json({ success: true, deleted: true });
  } else {
    res.status(404).json({ error: '未找到该比赛结果' });
  }
});

// 获取所有对阵信息
app.get('/api/matches', (req, res) => {
  res.json(MATCHES);
});

// 获取球队列表
app.get('/api/teams', (req, res) => {
  res.json(TEAMS);
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 安全：自定义 404 — 不暴露技术栈（必须放在所有 /api 路由之后）
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '接口不存在' });
  }
  res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ===== 数据 =====

const TEAMS = [
  // 夺冠热门
  { name: '阿根廷', group: 'J', tier: 'hot' },
  { name: '西班牙', group: 'H', tier: 'hot' },
  { name: '法国', group: 'I', tier: 'hot' },
  { name: '英格兰', group: 'L', tier: 'hot' },
  { name: '巴西', group: 'C', tier: 'hot' },
  // 一线强队
  { name: '德国', group: 'E', tier: 'tier1' },
  { name: '葡萄牙', group: 'K', tier: 'tier1' },
  { name: '荷兰', group: 'F', tier: 'tier1' },
  { name: '乌拉圭', group: 'H', tier: 'tier1' },
  { name: '克罗地亚', group: 'L', tier: 'tier1' },
  { name: '摩洛哥', group: 'C', tier: 'tier1' },
  { name: '哥伦比亚', group: 'K', tier: 'tier1' },
  { name: '日本', group: 'F', tier: 'tier1' },
  { name: '挪威', group: 'I', tier: 'tier1' },
  // 二线/东道主
  { name: '美国', group: 'D', tier: 'tier2' },
  { name: '墨西哥', group: 'A', tier: 'tier2' },
  { name: '加拿大', group: 'B', tier: 'tier2' },
  { name: '瑞士', group: 'B', tier: 'tier2' },
  { name: '韩国', group: 'A', tier: 'tier2' },
  { name: '土耳其', group: 'D', tier: 'tier2' },
  { name: '瑞典', group: 'F', tier: 'tier2' },
  { name: '奥地利', group: 'J', tier: 'tier2' },
  { name: '比利时', group: 'G', tier: 'tier2' },
  { name: '塞内加尔', group: 'I', tier: 'tier2' },
  { name: '厄瓜多尔', group: 'E', tier: 'tier2' },
  { name: '埃及', group: 'G', tier: 'tier2' },
  { name: '澳大利亚', group: 'D', tier: 'tier2' },
  { name: '苏格兰', group: 'C', tier: 'tier2' },
  // 中游/新军
  { name: '捷克', group: 'A', tier: 'tier3' },
  { name: '波黑', group: 'B', tier: 'tier3' },
  { name: '卡塔尔', group: 'B', tier: 'tier3' },
  { name: '巴拉圭', group: 'D', tier: 'tier3' },
  { name: '科特迪瓦', group: 'E', tier: 'tier3' },
  { name: '突尼斯', group: 'F', tier: 'tier3' },
  { name: '伊朗', group: 'G', tier: 'tier3' },
  { name: '新西兰', group: 'G', tier: 'tier3' },
  { name: '沙特', group: 'H', tier: 'tier3' },
  { name: '阿尔及利亚', group: 'J', tier: 'tier3' },
  { name: '加纳', group: 'L', tier: 'tier3' },
  { name: '巴拿马', group: 'L', tier: 'tier3' },
  { name: '伊拉克', group: 'I', tier: 'tier3' },
  { name: '乌兹别克斯坦', group: 'K', tier: 'tier3' },
  { name: '约旦', group: 'J', tier: 'tier3' },
  { name: '南非', group: 'A', tier: 'tier3' },
  { name: '海地', group: 'C', tier: 'tier3' },
  { name: '库拉索', group: 'E', tier: 'tier3' },
  { name: '佛得角', group: 'H', tier: 'tier3' },
  { name: '刚果金', group: 'K', tier: 'tier3' },
];

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
  L: ['英格兰', '克罗地亚', '加纳', '巴拿马'],
};

function generateGroupMatches() {
  const matches = [];
  const groupLetters = Object.keys(GROUPS);
  groupLetters.forEach((g) => {
    const teams = GROUPS[g];
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        matches.push({
          group: g,
          teamA: teams[i],
          teamB: teams[j],
          stage: '小组赛',
        });
      }
    }
  });
  return matches;
}

const MATCHES = {
  groups: GROUPS,
  groupMatches: generateGroupMatches(),
  stages: ['小组赛', '32强', '16强', '8强', '半决赛', '决赛'],
  totalMatches: 64,
  opener: { teamA: '墨西哥', teamB: '南非', date: '2026-06-11', venue: '阿兹特克球场' },
};

// ===== 启动与定时任务 =====
const PORT = process.env.PORT || 3000;
const REFRESH_INTERVAL_MS = parseInt(process.env.REFRESH_INTERVAL_MS || '21600000'); // 默认6小时

let refreshTimer = null;

function startScheduledRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    console.log(`⏰ 定时检查情报（间隔 ${Math.round(REFRESH_INTERVAL_MS / 3600000)} 小时）...`);
    await autoRefreshIntelligence();
  }, REFRESH_INTERVAL_MS);
  console.log(`⏰ 定时刷新已启动：每 ${Math.round(REFRESH_INTERVAL_MS / 3600000)} 小时检查一次`);
}

app.listen(PORT, async () => {
  console.log(`⚽ 球场八爪鱼已就绪 → http://localhost:${PORT}`);
  console.log(`📡 DeepSeek API: ${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'}`);
  console.log(`📰 情报日期: ${getIntelligenceDate() || '未设置'}`);
  console.log(`📊 已确认赛果: ${confirmedResults.matches.length} 场`);
  // 启动时检查情报是否过期
  await autoRefreshIntelligence();
  // 启动定时自动刷新
  startScheduledRefresh();
});

// 优雅退出
process.on('SIGTERM', () => { if (refreshTimer) clearInterval(refreshTimer); });
process.on('SIGINT', () => { if (refreshTimer) clearInterval(refreshTimer); process.exit(); });
