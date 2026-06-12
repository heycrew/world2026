# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**球场八爪鱼** — 2026 世界杯 AI 预测引擎 Web 应用。基于 [worldcup2026-prediction-skill](https://github.com/TradingAi666/worldcup2026-prediction-skill) 的 system prompt 工程，使用 DeepSeek-V4-Pro 大模型驱动比赛预测。

## 目录结构

| 目录/文件 | 用途 |
|-----------|------|
| `backend/` | Node.js + Express API Server |
| `backend/server.js` | 主服务器：静态文件、API 路由、DeepSeek 集成 |
| `backend/package.json` | 依赖：express, cors, openai, dotenv |
| `backend/.env` | DeepSeek API Key + 配置 |
| `public/` | 前端静态文件 |
| `public/index.html` | 足球主题单页应用 |
| `public/css/style.css` | 足球主题样式（CSS 变量体系） |
| `public/js/app.js` | 前端逻辑：球队选择、预测请求、倒计时、分组渲染 |
| `skill.md` | 核心 system prompt（48 队资料库 + 4 维方法论 + JSON 契约） |

## 技术栈

- **后端**: Node.js + Express 5.x
- **前端**: 原生 HTML/CSS/JS（零框架依赖）
- **AI**: DeepSeek-V4-Pro API（OpenAI 兼容接口）
- **部署**: 支持 Vercel / Railway / 阿里云 / 任意 Node.js 服务器

## 启动方式

```bash
cd backend && npm install && npm start
# 访问 http://localhost:3000
```

## API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/teams` | 48 队列表 |
| GET | `/api/matches` | 分组和对阵信息 |
| POST | `/api/predict` | 单场预测 `{teamA, teamB, stage}` |

## 四层约束架构

1. 资料库锁死 — 48 队完整资料写死在 skill.md
2. 方法论固化 — 4 维权重：近期状态 40% + 硬实力 30% + 历史交锋 15% + 情境因素 15%
3. 输出契约 — 严格 JSON Schema，字段类型长度全部锁死
4. 每日情报区 — 动态覆盖位，伤停信息热更新

## 设计系统

- **主题**: 足球浓郁风格（深色底 + 绿茵色 + 金色点缀）
- **字体**: Noto Sans SC（正文） + Orbitron（数字/标题）
- **响应式**: 移动端 375px → 平板 768px → 桌面 1280px+
- **特色**: 粒子背景、足球弹跳动画、金绿色渐变

## 注意事项

- DeepSeek API 需要 `/v1` 路径前缀
- skill.md 更新后需重启服务器重新加载
- 预测仅供娱乐，内置红线禁止博彩相关内容
