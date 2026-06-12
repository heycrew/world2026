/**
 * 球场八爪鱼 · 每日情报自动更新脚本
 * 由 cron 每小时触发，校验情报日期并自动更新
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const SKILL_PATH = path.join(__dirname, '..', 'skill.md');
const INTEL_PATH = path.join(__dirname, '..', 'intelligence.md');
const LOG_PATH = path.join(__dirname, 'logs', 'intel-update.log');

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
}

// 赛程数据（硬编码，禁止编造）
function getUpcomingMatches() {
  const today = new Date();
  const openerDate = new Date('2026-06-11');
  const dayIndex = Math.floor((today - openerDate) / (1000 * 60 * 60 * 24));

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

function getIntelligenceDate(content) {
  const match = content.match(/情报日期[：:]\s*(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

async function main() {
  log('========== 情报更新检查 ==========');

  // 读取当前情报
  let currentIntel = '';
  if (fs.existsSync(INTEL_PATH)) {
    currentIntel = fs.readFileSync(INTEL_PATH, 'utf-8').trim();
  } else if (fs.existsSync(SKILL_PATH)) {
    const raw = fs.readFileSync(SKILL_PATH, 'utf-8');
    const marker = '## 六、最新情报（每日更新区）';
    const idx = raw.indexOf(marker);
    if (idx > 0) currentIntel = raw.substring(idx).trim();
  }

  if (!currentIntel) {
    log('❌ 无现有情报数据，跳过');
    return;
  }

  const intelDate = getIntelligenceDate(currentIntel);
  const today = new Date().toISOString().split('T')[0];

  if (!intelDate) {
    log('⚠️ 无法解析情报日期，跳过');
    return;
  }

  if (intelDate >= today) {
    log(`✅ 情报日期 ${intelDate} ≥ 今日 ${today}，无需更新`);
    return;
  }

  log(`🔄 情报过期 (${intelDate} < ${today})，开始更新...`);

  try {
    const OpenAI = require('openai');
    const client = new OpenAI({
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
    });

    const matches = getUpcomingMatches();
    const todayMatches = matches.today ? matches.today.matches.join('；') : '今日无比赛';
    const tomorrowMatches = matches.tomorrow ? matches.tomorrow.matches.join('；') : '明日无比赛';

    const resp = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: `世界杯每日情报编辑。格式：## 六、最新情报（每日更新区）→ > 本节由每日情报流程覆盖更新... → **情报日期：${today}** → 比赛对阵（使用系统提供数据，严禁编造）→ 伤停信息（只写可确认的，不确定写"暂无经确认的伤停变动，按第四节资料执行"）。`,
        },
        {
          role: 'user',
          content: `今日对阵: ${todayMatches}\n明日对阵: ${tomorrowMatches}\n生成今日情报。只补充真实伤停信息。`,
        },
      ],
      temperature: 0.2,
      max_tokens: 400,
    });

    const newIntel = (resp.choices[0].message.content || '').trim();

    // 校验
    if (!newIntel || newIntel.length < 80) {
      log('❌ AI 返回内容过短，拒绝更新');
      return;
    }
    if (!newIntel.includes(today)) {
      log('❌ AI 返回日期不匹配，拒绝更新');
      return;
    }
    if (!newIntel.includes('情报日期')) {
      log('❌ AI 返回格式不符合要求，拒绝更新');
      return;
    }

    // 写入文件
    fs.writeFileSync(INTEL_PATH, newIntel, 'utf-8');
    log(`✅ 情报更新成功: ${today} (${newIntel.length} 字符)`);
  } catch (err) {
    log(`❌ 更新失败: ${err.message}`);
  }
}

main().catch(err => {
  log(`❌ 脚本异常: ${err.message}`);
  process.exit(1);
});
