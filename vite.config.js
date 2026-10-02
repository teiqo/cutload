import { defineConfig } from 'vite';
import { copyFileSync,cpSync } from 'node:fs';
export default defineConfig({root:'frontend',publicDir:false,clearScreen:false,plugins:[{name:'legacy-design-assets',closeBundle(){for(const file of ['app.js','refinements.js','star.js','favicon.svg'])copyFileSync(`frontend/${file}`,`web-dist/${file}`);for(const directory of ['assets','icons'])cpSync(`frontend/${directory}`,`web-dist/${directory}`,{recursive:true})}}],build:{outDir:'../web-dist',emptyOutDir:true},server:{port:5174,strictPort:true}});
