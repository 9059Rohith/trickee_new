const fs = require("fs");
const path = require("path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

const localNodeModules = path.join(__dirname, "node_modules");
const linkedNodeModules = fs.realpathSync(localNodeModules);
const usesExternalDependencyJunction =
  path.normalize(linkedNodeModules).toLowerCase() !==
  path.normalize(localNodeModules).toLowerCase();
const config = usesExternalDependencyJunction
  ? {
      // OneDrive checkouts expose dependencies through a junction. Only that
      // case needs the external directory watched; watching a normal local
      // node_modules tree can make Windows release bundling time out.
      watchFolders: [linkedNodeModules],
      resolver: {
        nodeModulesPaths: [linkedNodeModules],
      },
    }
  : {};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
