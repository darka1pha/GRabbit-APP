const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.extraNodeModules = new Proxy(
  {},
  {
    get: (_target, name) => path.join(projectRoot, 'node_modules', String(name)),
  }
);

// Force singleton React & React Native packages to always resolve from apps/mobile/node_modules
// (prevents pnpm from resolving React 19 hoisted from apps/desktop when bundling expo-router / @react-navigation)
const mobileOrigin = path.join(projectRoot, 'package.json');
const singletonPackages = [
  'react',
  'react-native',
  'react-native-safe-area-context',
  'react-native-screens',
];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isSingleton = singletonPackages.some(
    (pkg) => moduleName === pkg || moduleName.startsWith(`${pkg}/`)
  );
  const targetContext = isSingleton
    ? {
        ...context,
        originModulePath: mobileOrigin,
        nodeModulesPaths: [path.resolve(projectRoot, 'node_modules')],
      }
    : context;

  if (defaultResolveRequest) {
    return defaultResolveRequest(targetContext, moduleName, platform);
  }
  return targetContext.resolveRequest(targetContext, moduleName, platform);
};

module.exports = config;

