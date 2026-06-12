require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// 加载 skill.md（system prompt）
const skillPath = path.join(__dirname, '..', 'skill.md');
const intelligencePath = path.join(__dirname, '..', 'intelligence.md');
const SKILL_RAW = fs.readFileSync(skillPath, 'utf-8');

// 解析 skill.md：分离稳定基（一~五节）和每日情报（第六节）
const SECTION6_MARKER = '## 六、最新情报（每日更新区）';
const section6Index = SKILL_RAW.indexOf(SECTION6_MARKER);
const SKILL_BASE = section6Index > 0 ? SKILL_RAW.substring(0, section6Index).trimEnd() : SKILL_RAW;

// 加载每日情报（优先从独立文件，fallback 到 skill.md）
function loadIntelligence() {
  if (fs.existsSync(intelligencePath)) {
    return fs.readFileSync(intelligencePath, 'utf-8').trim();
  }
  if (section6Index > 0) {
    const raw = SKILL_RAW.substring(section6Index).trim();
    fs.writeFileSync(intelligencePath, raw, 'utf-8');
    return raw;
  }
  return '';
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

// ===== 每日情报 API =====

// 根据真实分组生成当日/次日赛程
function getUpcomingMatches() {
  const today = new Date();
  const openerDate = new Date('2026-06-11');
  const dayIndex = Math.floor((today - openerDate) / (1000 * 60 * 60 * 24));

  // 揭幕战赛程（小组赛前两轮的真实对阵，基于原skill.md）
  const schedule = [
    { day: 0, matches: ['墨西哥 vs 南非（阿兹特克球场）', '韩国 vs 捷克'] },
    { day: 1, matches: ['加拿大 vs 波黑（多伦多）', '美国 vs 巴拉圭（英格尔伍德）'] },
    { day: 2, matches: ['巴西 vs 海地', '苏格兰 vs 摩洛哥'] },
    { day: 3, matches: ['德国 vs 库拉索', '科特迪瓦 vs 厄瓜多尔'] },
    { day: 4, matches: ['荷兰 vs 瑞典', '日本 vs 突尼斯'] },
    { day: 5, matches: ['比利时 vs 伊朗', '埃及 vs 新西兰'] },
    { day: 6, matches: ['西班牙 vs 佛得角', '沙特 vs 乌拉圭'] },
    { day: 7, matches: ['法国 vs 伊拉克', '塞内加尔 vs 挪威'] },
    { day: 8, matches: ['阿根廷 vs 约旦', '阿尔及利亚 vs 奥地利'] },
    { day: 9, matches: ['葡萄牙 vs 乌兹别克斯坦', '刚果金 vs 哥伦比亚'] },
    { day: 10, matches: ['英格兰 vs 巴拿马', '克罗地亚 vs 加纳'] },
    { day: 11, matches: ['瑞士 vs 卡塔尔', '加拿大 vs 波黑'] },
    { day: 12, matches: ['美国 vs 澳大利亚', '巴拉圭 vs 土耳其'] },
    { day: 13, matches: ['巴西 vs 苏格兰', '摩洛哥 vs 海地'] },
    { day: 14, matches: ['德国 vs 科特迪瓦', '厄瓜多尔 vs 库拉索'] },
    { day: 15, matches: ['荷兰 vs 突尼斯', '日本 vs 瑞典'] },
    { day: 16, matches: ['比利时 vs 新西兰', '埃及 vs 伊朗'] },
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
    refreshInterval: '每次服务器启动时检查，情报日期 < 当前日期则自动更新',
    upcoming: {
      today: matches.today ? matches.today.matches : [],
      tomorrow: matches.tomorrow ? matches.tomorrow.matches : [],
      dayIndex: matches.dayIndex,
    },
  });
});

// 手动刷新情报
app.post('/api/intelligence/refresh', async (req, res) => {
  try {
    const client = getAIClient();
    const today = new Date().toISOString().split('T')[0];
    const matches = getUpcomingMatches();
    const todayMatches = matches.today ? matches.today.matches.join('；') : '今日无比赛';
    const tomorrowMatches = matches.tomorrow ? matches.tomorrow.matches.join('；') : '明日无比赛';

    const resp = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: `你是世界杯每日情报编辑。禁止编造对阵——对阵数据已由系统提供，你只需补充伤停信息。

情报格式要求（严格复制此格式）：
## 六、最新情报（每日更新区）

> 本节由每日情报流程覆盖更新。**当本节与第四节冲突时，以本节为准**（本节更新）。

**情报日期：${today}**

- ${todayMatches}
- ${tomorrowMatches}
- [伤停信息：基于你的足球知识，列出截至2026年6月可确认的伤停变动。只写真实可确认的信息，不确定的写"暂无经确认的伤停变动，按第四节资料执行"]

⚠️ 严禁编造对阵！严禁修改系统提供的对阵数据！` },
        { role: 'user', content: `今日对阵: ${todayMatches}\n明日对阵: ${tomorrowMatches}\n\n请基于以上对阵，生成今日情报。只补充真实的伤停信息，不确定就写"暂无经确认的伤停变动"。` },
      ],
      temperature: 0.2,
      max_tokens: 500,
    });

    const newIntel = (resp.choices[0].message.content || '').trim();
    if (!newIntel || newIntel.length < 100) {
      return res.status(502).json({ error: 'AI 生成情报失败' });
    }

    // 验证包含关键字段
    if (!newIntel.includes(today)) {
      return res.status(502).json({ error: 'AI 生成情报日期错误，请重试' });
    }

    fs.writeFileSync(intelligencePath, newIntel, 'utf-8');
    currentIntelligence = newIntel;
    console.log(`📰 情报已手动更新为 ${today}`);

    res.json({ success: true, date: getIntelligenceDate(), content: newIntel });
  } catch (err) {
    console.error('情报更新失败:', sanitizeError(err));
    res.status(500).json({ error: '情报更新失败' });
  }
});

// 自动检查
async function autoRefreshIntelligence() {
  const intelDate = getIntelligenceDate();
  const today = new Date().toISOString().split('T')[0];

  if (!intelDate) {
    console.log(`📰 情报日期缺失，跳过自动更新`);
    return;
  }

  if (intelDate >= today) {
    console.log(`📰 情报日期 ${intelDate} ≥ 今日 ${today}，无需更新`);
    return;
  }

  console.log(`📰 情报过期（${intelDate} < ${today}），自动更新中...`);
  try {
    const client = getAIClient();
    const matches = getUpcomingMatches();
    const todayMatches = matches.today ? matches.today.matches.join('；') : '今日无比赛';
    const tomorrowMatches = matches.tomorrow ? matches.tomorrow.matches.join('；') : '明日无比赛';

    const resp = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: `世界杯每日情报编辑。格式：## 六、最新情报（每日更新区）→ 情报日期：${today} → 比赛对阵（使用系统提供数据）→ 伤停信息（只写可确认的，不确定写"暂无经确认的伤停变动，按第四节资料执行"）。严禁编造对阵。` },
        { role: 'user', content: `今日对阵: ${todayMatches}\n明日对阵: ${tomorrowMatches}\n生成情报。` },
      ],
      temperature: 0.2,
      max_tokens: 400,
    });

    const newIntel = (resp.choices[0].message.content || '').trim();
    if (newIntel && newIntel.length >= 100 && newIntel.includes(today)) {
      fs.writeFileSync(intelligencePath, newIntel, 'utf-8');
      currentIntelligence = newIntel;
      console.log(`📰 情报自动更新完成: ${today}`);
    } else {
      console.log('📰 自动更新生成内容不符合要求，跳过');
    }
  } catch (err) {
    console.error('📰 自动更新失败:', sanitizeError(err));
  }
}

// 安全：自定义 404 — 不暴露技术栈
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '接口不存在' });
  }
  res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html'));
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

// 启动
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`⚽ 球场八爪鱼已就绪 → http://localhost:${PORT}`);
  console.log(`📡 DeepSeek API: ${process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'}`);
  console.log(`📰 情报日期: ${getIntelligenceDate() || '未设置'}`);
  // 启动时检查情报是否过期
  await autoRefreshIntelligence();
});
