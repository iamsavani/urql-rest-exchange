import { dts } from 'rollup-plugin-dts';
import * as settings from './settings.mjs';
import { makePlugins, makeBasePlugins, makeOutputPlugins } from './plugins.mjs';
import cleanup from './cleanup-plugin.mjs'
const plugins = makePlugins();

const chunkFileNames = extension => {
  let hasDynamicChunk = false;
  return chunkInfo => {
    if (
      chunkInfo.isDynamicEntry ||
      chunkInfo.isEntry ||
      chunkInfo.isImplicitEntry
    ) {
      return `[name]${extension}`;
    } else if (!hasDynamicChunk) {
      hasDynamicChunk = true;
      return `${settings.name}-chunk${extension}`;
    } else {
      return `[name]-chunk${extension}`;
    }
  };
};

const input = settings.sources.reduce((acc, source) => {
  acc[source.name] = source.source;
  return acc;
}, {});

const output = ({ format, isProduction }) => {
  if (typeof isProduction !== 'boolean')
    throw new Error('Invalid option `isProduction` at output({ ... })');
  if (format !== 'cjs' && format !== 'esm')
    throw new Error('Invalid option `format` at output({ ... })');

  let extension =
    format === 'esm'
      ? settings.hasReact && !settings.hasNext
        ? '.es.js'
        : '.mjs'
      : '.js';
  if (isProduction) {
    extension = '.min' + extension;
  }

  return {
    entryFileNames: `[name]${extension}`,
    chunkFileNames: chunkFileNames(extension),
    dir: './dist',
    exports: 'named',
    sourcemap: true,
    banner: chunk => (chunk.name === 'urql-next' ? '"use client"' : undefined),
    sourcemapExcludeSources: false,
    hoistTransitiveImports: false,
    indent: false,
    freeze: false,
    strict: false,
    format,
    plugins: makeOutputPlugins({
      isProduction,
      extension: format === 'esm' ? '.mjs' : '.js',
    }),
    // NOTE: All below settings are important for cjs-module-lexer to detect the export
    // When this changes (and terser mangles the output) this will interfere with Node.js ESM intercompatibility
    esModule: format !== 'esm',
    externalLiveBindings: format !== 'esm',
    interop(id) {
      if (format === 'esm') {
        return 'esModule';
      } else if (id === 'react') {
        return 'esModule';
      } else {
        return 'auto';
      }
    },
    generatedCode: {
      preset: 'es5',
      reservedNamesAsProps: false,
      objectShorthand: false,
      constBindings: false,
    },
  };
};
const commonConfig = {
  input,
  external: settings.isExternal,
  onwarn() {},
  treeshake: {
    unknownGlobalSideEffects: false,
    tryCatchDeoptimization: false,
    moduleSideEffects: false,
  },
};

export default [
  {
    ...commonConfig,
    plugins,
    output: [
      output({ format: 'cjs', isProduction: false }),
      output({ format: 'esm', isProduction: false }),
      output({ format: 'cjs', isProduction: true }),
      output({ format: 'esm', isProduction: true }),
    ].filter(Boolean),
  },
  {
    ...commonConfig,
    plugins: [
      ...makeBasePlugins(),
      dts({
        compilerOptions: {
          preserveSymlinks: false,
        },
      }),
    ],
    output: {
      minifyInternalExports: false,
      entryFileNames: '[name].d.ts',
      chunkFileNames: chunkFileNames('.d.ts'),
      dir: './dist',
      plugins: [cleanup()],
    },
  }
];
