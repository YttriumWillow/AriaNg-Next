# 文档索引

这里是 AriaNg-Next 的**深入文档**。README 面向"想用这个面板的人"，这里面向"想读懂 / 改这个项目的人"。

| 文档 | 内容 | 适合谁 |
|---|---|---|
| [LEARNING.md](./LEARNING.md) | 学习路线：从零读懂整个前端项目 | 第一次接触前端、想拿这个项目当教材的人 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构说明：core / ui 分层、数据流、扩展方式 | 想改功能、加页面、加协议的人 |
| [CUSTOM-CSS.md](./CUSTOM-CSS.md) | 自定义 CSS 指南与设计令牌体系 | 想改外观、写主题的人 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 开发环境、工具链、联调、FAQ | 想参与开发或排查问题的人 |
| [VERIFICATION.md](./VERIFICATION.md) | **实测报告**：各协议真实下载能力、多主机管理、实测中发现的缺陷 | 想知道「到底哪些功能是真的能用」的人 |

## 其它资料

| 路径 | 内容 |
|---|---|
| [`design/wireframe-v0.1.html`](./design/wireframe-v0.1.html) | 结构线框稿（双击用浏览器打开） |
| [`verification/`](./verification/) | 视觉验证产物：真实 Firefox 渲染的截图与前后对比 |

## 一句话架构

```
ui  ──依赖──▶  stores  ──依赖──▶  core
```

`core/` 是**零框架依赖的纯 TypeScript**，所有业务规则都在那里；`ui/` 只负责把状态画出来。
这条分界线既是本项目最重要的架构决策，也是最值得先读懂的地方 —— 详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。
