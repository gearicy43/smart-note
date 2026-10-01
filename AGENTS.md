# Smart Note（备忘录）

Taro 4 + React 18，一套代码同时编译 H5 和微信小程序。H5 是主要形态，按 iPhone 尺寸优先设计。
数据只存在本机（H5 用 SQLite WASM + IndexedDB，小程序用本地存储），没有后端。

## 常用命令

- 开发：`npm run dev:h5`（H5 热更新）
- 检查：`npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p tsconfig.core.json`、`npm test`、`npm run build:weapp`
- 发布 H5：`npm run deploy`（构建 + 推 Cloudflare Pages）

## 改 UI 之前先读

- `docs/UI_DESIGN.md`：间距 / 字号 / 颜色 / 项目树 / Sheet / 完成态的唯一规则来源。
- `src/styles/tokens.scss`：数值 token。
- `skills/ui-design/SKILL.md`：改完 UI 的自查清单。

## 硬性约束

- 样式数值只能取 token，不写裸的 `17px`、`#999`。`src/app.scss` 里的历史裸值遵循「改到哪、迁到哪」。
- 层级只用「缩进 + 极淡底色 + 一条竖线」，不要叠加背景色、边框、阴影。
- 完成态只有一套（`.done` 规则），不按节点类型分支，只看算出来的 `completed`。
- 完成状态只有一个来源：叶子节点存，父级由后代叶子推导（`src/domain/aggregate.ts`）；UI 不新增第二份状态。
- Bottom Sheet 右上角「关闭」= 结束本次编辑，不等于把任务标记为完成。
- `src/App.tsx`、`src/ui/`、`src/index.css` 是迁移前的旧界面，不参与 Taro 打包，不要基于它们改。
