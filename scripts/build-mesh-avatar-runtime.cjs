// SPDX-License-Identifier: Apache-2.0
const path=require('node:path');
const esbuild=require(process.env.CHARADOCK_ESBUILD_PATH || 'esbuild');
const root=path.resolve(__dirname,'../vendor/mesh-avatar-studio');
const banner='/* Mesh Avatar Studio, MIT, (c) 2026 Yuki Shindo. See LICENSE and UPSTREAM.md. */';
(async()=>{
  await esbuild.build({entryPoints:[path.join(root,'entry.js')],outfile:path.join(root,'mesh-avatar.js'),bundle:true,format:'iife',globalName:'MeshAvatarStudio',target:'chrome120',banner:{js:banner}});
  await esbuild.build({entryPoints:[path.join(root,'rig/validate.ts')],outfile:path.join(root,'rig-validator.cjs'),bundle:true,format:'cjs',platform:'node',target:'node22',banner:{js:banner}});
})().catch(error=>{console.error(error);process.exitCode=1;});
