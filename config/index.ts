import { defineConfig } from '@tarojs/cli';

export default defineConfig({
  projectName: 'smart-note',
  date: '2026-09-16',
  designWidth: 750,
  deviceRatio: { 750: 1 },
  sourceRoot: 'src',
  outputRoot: `dist/${process.env.TARO_ENV || 'h5'}`,
  framework: 'react',
  compiler: { type: 'webpack5', prebundle: { enable: false } },
  plugins: [
    '@tarojs/plugin-framework-react',
    '@tarojs/plugin-platform-h5',
    '@tarojs/plugin-platform-weapp',
    '@tarojs/plugin-platform-alipay',
  ],
  mini: {},
  h5: { devServer: { port: 5173 } },
});
