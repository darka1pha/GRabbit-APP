const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.extraNodeModules = new Proxy(
  {},
  {
    get: (_target, name) => path.join(projectRoot, 'node_modules', String(name)),
  }
);

module.exports = config;
