#!/usr/bin/env node
import { build } from 'esbuild'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function collectTsFiles(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      collectTsFiles(full, files)
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      files.push(full)
    }
  }
  return files
}

const entryPoints = collectTsFiles('src')

await build({
  entryPoints,
  outbase: 'src',
  outdir: 'dist',
  platform: 'node',
  format: 'esm',
  bundle: false,
  sourcemap: true,
  logLevel: 'info',
})
