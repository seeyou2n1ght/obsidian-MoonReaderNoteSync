import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { readFile } from "node:fs/promises";

const prod = (process.argv[2] === "production");

const context = await esbuild.context({
  banner: {
    js: '/*\nBuilt from https://github.com/seeyou2n1ght/obsidian-MoonReaderNoteSync\n\n' +
      await readFile('THIRD-PARTY-NOTICES.txt', 'utf8') + '\n*/',
  },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
