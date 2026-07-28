module.exports = {
  project: {
    android: {
      sourceDir: "./android",
    },
  },
  dependencies: {
    "react-native-vector-icons": {
      platforms: {
        android: null, // auto-linked
      },
    },
  },
  assets: ["./src/assets/fonts/"],
};
