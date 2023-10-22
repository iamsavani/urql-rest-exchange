import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import cjsCheck from 'rollup-plugin-cjs-check';
import cleanup from './cleanup-plugin.mjs';
import * as settings from './settings.mjs';

export const makeBasePlugins = () => [
  resolve({
    dedupe: settings.externalModules,
    extensions: ['.js', '.ts', '.tsx'],
    mainFields: ['module', 'jsnext', 'main'],
    preferBuiltins: false,
    browser: true,
  }),
  commonjs({
    ignoreGlobal: true,
    include: /\/node_modules\//,
  }),
];

export const makePlugins = () => [...makeBasePlugins(), typescript()];

export const makeOutputPlugins = ({ extension }) => {
  if (extension !== '.mjs' && extension !== '.js')
    throw new Error('Missing option `extension` on makeOutputPlugins({ ... })');

  return [cjsCheck({ extension }), cleanup(), terserMinified].filter(Boolean);
};

const terserMinified = terser({
  warnings: true,
  ecma: 2015,
  ie8: false,
  toplevel: true,
  compress: {
    keep_infinity: true,
    pure_getters: true,
    passes: 10,
  },
  mangle: {
    module: true,
  },
  output: {
    comments: false,
  },
});
