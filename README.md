# Smart Note

本地优先的项目备忘录：项目事项可分级，定期事项独立成平铺列表。

## 功能

- 项目和小项可选填最晚截止；没有子项的项目可作为单条事项设置完成时间；大项默认取子项最晚日期，也可手动设置并恢复自动。
- 小项记录进展、完成时间；项目可连同全部子项复制。
- 定期事项支持每周、每月重复，保留完成记录并生成下一次。
- 截止提醒默认 2 天内深红、3 天内浅红、完成绿色；在系统设置中调整。
- 日历按截止日期归集事项，可按子项或按项目查看；默认方式可在设置中选择，自动汇总的大项日期不会重复列出。

## 开发

```bash
npm install
npm run dev
npm test
npm run typecheck:core
npm run build
```

当前页面由 Taro 同时编译为 H5 和微信小程序。H5 继续使用原来的 SQLite WASM + IndexedDB；微信小程序使用本地存储，两端数据暂不自动同步。同一浏览器中，H5 数据还受访问域名和端口影响。

开发阶段可以直接在浏览器使用 H5：运行 `npm run build:h5 && npm run preview -- --host 127.0.0.1`，打开 `http://127.0.0.1:4173/`。修改代码后重新运行 `npm run build:h5` 并刷新页面。要边改边看，可运行 `npm run dev:h5`，打开 `http://127.0.0.1:5173/`。两个端口的数据彼此独立；固定使用同一地址，浏览器才会读到之前保存的事项。数据只保存在该浏览器本机，清除站点数据会删除它。

## 部署（H5）

线上地址：<https://memo.gearicy43.top>（Cloudflare Pages，项目名 `smart-note`，备用域名 `smart-note-ad6.pages.dev`）。

- 构建命令 `npm run build:h5`，产物目录 `dist/h5`，是纯静态站点，没有后端。
- 手动发布：`npm run deploy`（等于构建后再 `wrangler pages deploy dist/h5`）。需要本机已登录 Cloudflare，或设置 `CLOUDFLARE_API_TOKEN`。
- H5 是纯前端哈希路由，不需要 SPA 回退规则；`dist/h5/*.wasm` 由 Pages 按 `application/wasm` 返回。

数据只存在浏览器本地（SQLite WASM + IndexedDB），所以 `127.0.0.1:5174`、`memo.gearicy43.top`、`smart-note-ad6.pages.dev` 各自是一份独立数据，换地址不会带走旧数据。需要迁移时用设置里的导出/导入备份。

## 小程序和安卓

`src/core.ts` 是跨平台入口，导出事项模型、规则、服务和 `NodeRepository` 接口。`npm run typecheck:core` 使用不含 DOM 的 TypeScript 配置检查这些代码。

- **H5 预览**：`npm run dev:h5`，浏览器打开命令显示的地址。每次修改 Taro 页面都会重新编译。
- **微信小程序**：`npm run build:weapp`，用微信开发者工具导入项目根目录。`project.config.json` 中的 `touristappid` 只能用于本地体验，提交/发布前换成自己的小程序 AppID。
- **支付宝小程序**：`npm run build:alipay`，用支付宝小程序开发者工具打开 `dist/alipay`，预览和上传前填入自己的支付宝小程序 AppID。
- **安卓包**：仍可用 Capacitor 包装 Taro H5。网页功能运行在 Android WebView 内；装机后应验证数据保存和重启恢复。

### 生成安卓 APK

1. 安装 Android Studio，并通过它安装 Android SDK。
2. 首次打开：`npm run android:open`，等待 Gradle 同步完成。
3. 在 Android Studio 中选择 **Build > Build Bundle(s) / APK(s) > Build APK(s)**。生成的调试包通常位于 `android/app/build/outputs/apk/debug/app-debug.apk`。
4. 每次修改网页代码后，先运行 `npm run android:sync`，再重新构建 APK。

`capacitor.config.ts` 的 `com.example.smartnote` 是调试占位包名。正式发布前改成自己控制的唯一包名，并在发布后保持不变。当前未生成可安装包。各端本地数据不会自动同步；需要同步或迁移时再加入导入导出或账号同步。

## 代码结构

- `src/domain`：纯 TypeScript 规则
- `src/service`：建项、完成、复制等操作
- `src/repository/types.ts`：跨平台存储接口
- `src/platform/taro.h5.ts`：H5 端沿用 SQLite 数据库
- `src/platform/taro.ts`：小程序端本地存储适配器
- `src/pages`、`src/app.scss`：H5 与小程序共用的 Taro 界面
- `src/App.tsx`、`src/ui`：迁移前网页界面，暂留作对照
