module.exports = function (api) {
  api.cache(true);
  // uniwind needs no babel preset of its own; it is a Metro transform.
  return { presets: ["babel-preset-expo"] };
};
