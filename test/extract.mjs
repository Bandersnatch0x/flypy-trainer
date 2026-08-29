import fs from 'node:fs';

const html = fs.readFileSync('D:/code_space/test/日常/双拼练习/index.html', 'utf8');
const m = html.match(/const DATA = (\{.*?\});/s);
if (!m) { console.error('no match'); process.exit(1); }
const data = JSON.parse(m[1]);
const out = { chars: data.chars, words2: data.words2, words34: data.words34 };
fs.writeFileSync('D:/code_space/flypy-trainer/js/data.js',
  '// 内置练习池：移植自本地验证页（8105 频序 + 最佳读音）\nexport const BUILTIN = ' + JSON.stringify(out) + ';\n');
console.log('chars', out.chars.length, 'words2', out.words2.length, 'words34', out.words34.length);
