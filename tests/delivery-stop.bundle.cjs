const path = require('node:path');
require('@temporalio/worker')
  .bundleWorkflowCode({
    workflowsPath: path.resolve('apps/orchestrator/src/workflows/index.ts'),
    webpackConfigHook(config) {
      for (const rule of config.module.rules) {
        if (rule.use?.loader?.includes('swc-loader')) {
          rule.use.options.swcrc = false;
          rule.use.options.jsc.baseUrl = process.cwd();
          rule.use.options.jsc.paths =
            require('../tsconfig.base.json').compilerOptions.paths;
        }
      }
      return config;
    },
  })
  .then((x) =>
    require('node:fs').writeFileSync(
      '.orbit/tmp/stop-proof-workflow-bundle.js',
      x.code
    )
  );
