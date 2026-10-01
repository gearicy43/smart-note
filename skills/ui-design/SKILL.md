---
name: ui-design
description: Review or implement UI in the Smart Note / 备忘录 project (Taro memo app with project → item → sub-item trees, H5 + WeChat mini program). Use when adding, restyling, or reviewing any page, list, tree, bottom sheet, or completion state in that project, so spacing/typography/color stay on the project's token scale instead of accumulating one-off values.
---

# Smart Note UI 规则

这个项目的界面数值只有一个来源：仓库里的 `docs/UI_DESIGN.md`，token 在 `src/styles/tokens.scss`。
**动手前先读这两份文件**，它们比这份清单更权威。

## 什么时候必须走这套检查

- 新增页面、列表、Sheet、控件。
- 调整任何字号、间距、颜色、圆角、行高。
- 修完成态、展开态、空状态、危险操作。
- 用户说"这里看着不太对/再干净一点/对齐一下"这类没有具体数值的反馈。

## 硬性约束

1. 样式里的数值只能取 token。裸的 `17px`、`#999`、`13px` 一律不接受，除非是 `0`、`$hairline`、百分比、`vh/vw`、`env()`、纯数字行高。
2. 间距只用 4 / 8 / 12 / 16 / 24 / 32 pt 六档（`$space-1..6`）。
3. 层级只用「缩进 + 极淡底色 + 一条竖线」表达，不要叠背景色、边框、阴影。
4. 完成态只有一套，见 `app.scss` 的 `.done` 规则。不要为某个页面单独实现完成样式，也不要按"这是项目/事项/子项"分支，只看算出来的 `completed`。
5. 完成状态只有一个数据来源：叶子节点存自己的状态，父级由后代叶子推导，规则在 `src/domain/aggregate.ts`。UI 不新增第二份完成状态。
6. 可点区域 ≥ 44pt（`$touch-min`）。圆圈视觉可以小，命中区不能小。
7. Bottom Sheet 右上角是「关闭」= 结束本次编辑，不是把任务标记成完成。完成只由圆圈控制。
8. `src/app.scss` 里还有没迁移的历史裸值，遵循「改到哪、迁到哪」：动了哪一行就把哪一行换成 token，不整篇重写，也不在旁边复制一套新值。
9. `src/App.tsx`、`src/ui/`、`src/index.css` 是迁移前的旧界面，不参与打包，不要改。

## 改完之后的自查

逐条过，任何一条不过就先改再交付：

1. **对齐**：页面左右边缘、同级元素的起始位置是否一致。
2. **节奏**：同级元素间距是否一致；同一行的上下 padding 是否对称，有没有 16/15 这种差 1px。
3. **字号**：每个字号都能在 `docs/UI_DESIGN.md` 的字号表里找到；同一层级字重一致。
4. **颜色**：文字只有三档 + 完成态一档；背景只用了那 5 个 surface token。
5. **层级**：有没有用两种以上手法重复表达同一层关系（底色 + 边框 + 阴影同时上就是错的）。
6. **命中区**：圆圈、箭头、`···`、左滑按钮够不够 44pt，事件有没有互相冒泡。
7. **完成态**：项目 / 事项 / 子项在列表和详情里的表现是否完全一致；取消完成后是否立刻恢复。
8. **状态齐全**：展开 / 收起、空列表、危险操作二次确认、长标题截断都覆盖到了。

## 交付前

改完样式跑一遍：

```bash
npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run build:weapp
```

H5 是主要形态，最好在浏览器里实际看一眼（`npm run dev:h5`，iPhone 宽度），
不要只看代码就宣布改完了。发布用 `npm run deploy`。
