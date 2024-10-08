const LTS = 12; // The current oldest LTS supported by Node

module.exports = (api) => {
  api.cache.using(() => process.env.NODE_ENV === 'development');
  const plugins = [
    ['@babel/proposal-class-properties', { loose: false }],
    '@babel/proposal-export-default-from',
    '@babel/proposal-export-namespace-from',
    // '@babel/proposal-logical-assignment-operators', // may be activated at a later date
    // ['@babel/proposal-optional-chaining', { loose: false }], // may be activated at a later date
  ];
  const presets = [
    [
      '@babel/env',
      {
        targets: {
          browsers: ['last 2 versions', '> 1%'],
          node: api.env('test') ? 'current' : LTS,
        },
        modules: api.env('test') ? 'commonjs' : false,
        useBuiltIns: 'usage',
        corejs: 3,
      },
    ],
    '@babel/flow',
  ];
  if (api.env('test')) {
    return { plugins, presets };
  }
  const ignore = ['**/*.test.js'];
  return { ignore, plugins, presets };
};
