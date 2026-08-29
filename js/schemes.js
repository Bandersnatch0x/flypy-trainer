// 方案注册表：键位表译自 iDvel/rime-ice 官方 schema algebra 段（ADR-0005）
import { normalizeSyllable, splitSyllable, splitPinyin } from './flypy.js';

function makeScheme(cfg) {
  const keyPlan = (sylIn) => {
    const syl = normalizeSyllable(sylIn);
    if (!syl) return null;
    const [sm, ym] = splitSyllable(syl);
    if (!sm) {
      if (/^[aoe]$/.test(syl)) {
        return { smKey: syl, smName: syl, ymKey: syl, ymName: syl, code: syl + syl, zeroDouble: true };
      }
      const lead = cfg.zero === 'o' ? 'o' : syl[0];
      const ymKey = cfg.YM[ym] || ym[0];
      return { smKey: lead, smName: lead, ymKey, ymName: ym, code: lead + ymKey };
    }
    const smKey = cfg.SM_KEYS[sm] || sm;
    const ym2 = cfg.jqxyV && 'jqxy'.includes(sm) && ym === 'u' ? 'v' : ym;
    const ymKey = cfg.YM[ym2] || ym2;
    return { smKey, smName: sm, ymKey, ymName: ym2, code: smKey + ymKey };
  };
  const toFly = (syl) => keyPlan(syl)?.code ?? '';
  const toFlyPhrase = (py) => py.trim().split(/\s+/).map(toFly).join('');
  const entryCode = (entry) => {
    if (entry.code && cfg.id === 'flypy') return entry.code.toLowerCase();
    if (entry.py) {
      const syls = splitPinyin(entry.py.replace(/\s+/g, ''));
      if (syls) return toFlyPhrase(syls.join(' '));
      return toFlyPhrase(entry.py);
    }
    return '';
  };
  return {
    id: cfg.id, name: cfg.name, YM: cfg.YM, SM_KEYS: cfg.SM_KEYS, SM_NAME: cfg.SM_NAME,
    ROWS: cfg.ROWS || ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
    extraKeys: cfg.extraKeys || [], zero: cfg.zero, keyPlan, toFly, toFlyPhrase, entryCode,
  };
}

const ROWS3 = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const ID = { i: 'i', u: 'u', v: 'v' };

export const SCHEMES = {
  flypy: makeScheme({
    id: 'flypy', name: '小鹤双拼', zero: 'first', jqxyV: true, ROWS: ROWS3,
    SM_KEYS: { zh: 'v', ch: 'i', sh: 'u' }, SM_NAME: { v: 'zh', i: 'ch', u: 'sh' },
    YM: { iu: 'q', ei: 'w', uan: 'r', er: 'r', ue: 't', ve: 't', un: 'y', uo: 'o', ie: 'p',
      ong: 's', iong: 's', ing: 'k', uai: 'k', ai: 'd', en: 'f', eng: 'g', iang: 'l',
      uang: 'l', ang: 'h', ian: 'm', an: 'j', ou: 'z', a: 'a', o: 'o', e: 'e', ia: 'x',
      ua: 'x', ao: 'c', ui: 'v', in: 'b', iao: 'n', ...ID },
  }),
  mspy: makeScheme({
    id: 'mspy', name: '微软双拼', zero: 'first', jqxyV: true, ROWS: ROWS3, extraKeys: [';'],
    SM_KEYS: { zh: 'v', ch: 'i', sh: 'u' }, SM_NAME: { v: 'zh', i: 'ch', u: 'sh' },
    YM: { ...ID, iu: 'q', ia: 'w', ua: 'w', uan: 'r', er: 'r', ue: 't', ve: 't', uo: 'o',
      uai: 'y', v: 'y', ong: 's', iong: 's', iang: 'd', uang: 'd', en: 'f', eng: 'g',
      ang: 'h', ian: 'm', an: 'j', iao: 'c', ao: 'k', ai: 'l', ei: 'z', ie: 'x', ui: 'v',
      ou: 'b', in: 'n', ing: ';', un: 'p' },
  }),
  sogou: makeScheme({
    id: 'sogou', name: '搜狗双拼', zero: 'first', jqxyV: true, ROWS: ROWS3, extraKeys: [';'],
    SM_KEYS: { zh: 'v', ch: 'i', sh: 'u' }, SM_NAME: { v: 'zh', i: 'ch', u: 'sh' },
    YM: { ...ID, iu: 'q', ia: 'w', ua: 'w', uan: 'r', er: 'r', ue: 't', ve: 't', uo: 'o',
      uai: 'y', v: 'y', ong: 's', iong: 's', iang: 'd', uang: 'd', en: 'f', eng: 'g',
      ang: 'h', ian: 'm', an: 'j', iao: 'c', ao: 'k', ai: 'l', ei: 'z', ie: 'x', ui: 'v',
      ou: 'b', in: 'n', ing: ';', un: 'p' },
  }),
  abc: makeScheme({
    id: 'abc', name: '智能ABC', zero: 'o', jqxyV: false, ROWS: ROWS3,
    SM_KEYS: { zh: 'a', ch: 'e', sh: 'v' }, SM_NAME: { a: 'zh', e: 'ch', v: 'sh' },
    YM: { ei: 'q', ian: 'w', er: 'r', iu: 'r', iang: 't', uang: 't', ing: 'y', uo: 'o',
      uan: 'p', ong: 's', iong: 's', ia: 'd', ua: 'd', en: 'f', eng: 'g', ang: 'h',
      an: 'j', iao: 'z', ao: 'k', in: 'c', uai: 'c', ai: 'l', ie: 'x', ou: 'b', un: 'n',
      ve: 'm', ui: 'm', ...ID },
  }),
};

export const DEFAULT_SCHEME = 'flypy';
export function getScheme(id) { return SCHEMES[id] || SCHEMES[DEFAULT_SCHEME]; }
export const SCHEME_LIST = Object.values(SCHEMES).map(s => ({ id: s.id, name: s.name }));
