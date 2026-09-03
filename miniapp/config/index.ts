import { defineConfig, type UserConfigExport } from '@tarojs/cli';

// 设计稿宽 375；px 值会按比例自动转成 rpx。
export default defineConfig(async () => {
  const config: UserConfigExport<'webpack5'> = {
    projectName: 'place-debate-miniapp',
    date: '2026-8-30',
    designWidth: 375,
    deviceRatio: { 640: 2.34 / 2, 750: 1, 375: 2, 828: 1.81 / 2 },
    sourceRoot: 'src',
    outputRoot: 'dist',
    plugins: [],
    defineConstants: {},
    framework: 'react',
    compiler: 'webpack5',
    mini: {
      postcss: {
        pxtransform: { enable: true, config: {} },
        cssModules: { enable: false },
      },
    },
    h5: {
      publicPath: '/',
      devServer: {
        // 浏览器预览端口；/api 代理到本机后端，避开 CORS。
        port: 5200,
        proxy: {
          '/api': {
            target: 'http://127.0.0.1:3100',
            changeOrigin: true,
          },
        },
      },
    },
  };
  return config;
});
