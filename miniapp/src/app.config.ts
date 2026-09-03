export default defineAppConfig({
  pages: ['pages/home/index', 'pages/debate/index', 'pages/result/index'],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff9f2',
    navigationBarTitleText: '地点辩论会',
    navigationBarTextStyle: 'black',
    backgroundColor: '#fff9f2',
  },
  permission: {
    'scope.userLocation': { desc: '用于查找你附近的地点并展开辩论' },
  },
  requiredPrivateInfos: ['getLocation'],
  lazyCodeLoading: 'requiredComponents',
});
