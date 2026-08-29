// 成绩分享卡：canvas 本地绘制，无外链
export function downloadShareCard({ acc, kpm, secs, words, schemeName, streak }) {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 500;
  const x = c.getContext('2d');
  x.fillStyle = '#101014'; x.fillRect(0, 0, 900, 500);
  x.strokeStyle = 'rgba(255,255,255,0.08)'; x.strokeRect(24, 24, 852, 452);
  x.fillStyle = '#D96C4F'; x.beginPath(); x.arc(70, 84, 10, 0, 7); x.fill();
  x.fillStyle = '#EDEDEF'; x.font = '600 44px "Noto Serif SC", serif';
  x.fillText('鹤练 · 小鹤双拼', 96, 100);
  x.fillStyle = '#8B8B93'; x.font = '20px sans-serif';
  x.fillText(`${schemeName} · ${new Date().toLocaleDateString('zh-CN')}`, 96, 136);
  x.fillStyle = '#EDEDEF'; x.font = '600 120px "JetBrains Mono", monospace';
  x.fillText(`${acc}%`, 70, 300);
  x.fillStyle = '#8B8B93'; x.font = '22px sans-serif';
  x.fillText('准确率', 70, 340);
  x.fillStyle = '#7FA98C'; x.font = '600 72px "JetBrains Mono", monospace';
  x.fillText(`${kpm}`, 400, 292);
  x.fillStyle = '#8B8B93'; x.font = '22px sans-serif';
  x.fillText('键/分', 400, 340);
  x.fillStyle = '#EDEDEF'; x.font = '600 72px "JetBrains Mono", monospace';
  x.fillText(`${words}`, 620, 292);
  x.fillStyle = '#8B8B93'; x.font = '22px sans-serif';
  x.fillText(`词 · ${Math.floor(secs / 60)}分${secs % 60}秒`, 620, 340);
  x.fillStyle = '#8B8B93'; x.font = '20px sans-serif';
  x.fillText(streak ? `已连续练习 ${streak} 天 · flypy-trainer.vercel.app` : 'flypy-trainer.vercel.app', 70, 430);
  const a = document.createElement('a');
  a.download = `helian-${Date.now()}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
}
