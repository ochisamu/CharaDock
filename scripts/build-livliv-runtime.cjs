// SPDX-License-Identifier: Apache-2.0
const path=require('node:path');
const esbuild=require(process.env.CHARADOCK_ESBUILD_PATH || 'esbuild');
const root=path.resolve(__dirname,'../vendor/livliv-player');
const banner='/* LivLiv Player 0.5.1, Apache-2.0, Copyright 2026 LivLiv. See LICENSE, NOTICE and UPSTREAM.md. */';
(async()=>{
 await esbuild.build({entryPoints:[path.join(root,'vrm-entry.ts')],outfile:path.join(root,'vrm.js'),bundle:true,format:'iife',globalName:'CharaDockVrmEngine',nodePaths:[path.resolve(__dirname,'../node_modules')],target:'chrome120',banner:{js:banner},minify:true});
 await esbuild.build({entryPoints:[path.join(root,'vrm-reader.ts')],outfile:path.join(root,'vrm-reader.cjs'),bundle:true,format:'cjs',platform:'node',target:'node22',external:['three','three/*','@pixiv/three-vrm'],banner:{js:banner}});
 await esbuild.build({entryPoints:[path.join(root,'charadock-vrm-expression-policy.ts')],outfile:path.join(root,'vrm-policy.cjs'),bundle:true,format:'cjs',platform:'node',target:'node22',banner:{js:banner}});
 await esbuild.build({entryPoints:[path.join(root,'entry.ts')],outfile:path.join(root,'livliv.js'),bundle:true,format:'iife',globalName:'LivLivPlayer',target:'chrome120',banner:{js:banner}});
 await esbuild.build({entryPoints:[path.join(root,'package-reader.ts')],outfile:path.join(root,'package-reader.cjs'),bundle:true,format:'cjs',platform:'node',target:'node22',banner:{js:banner}});
 await esbuild.build({entryPoints:[path.join(root,'src/runtime/format.ts')],outfile:path.join(root,'validator.cjs'),bundle:true,format:'cjs',platform:'node',target:'node22',banner:{js:banner}});
})().catch(error=>{console.error(error);process.exitCode=1;});
