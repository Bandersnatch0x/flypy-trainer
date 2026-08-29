// 方案注册表：V1 仅小鹤双拼，新增输入法 = 注册一个 scheme，不改逻辑（SPEC 扩展点）
import * as flypy from './flypy.js';

export const SCHEMES = {
  flypy: {
    id: 'flypy',
    name: '小鹤双拼',
    YM: flypy.YM,
    SM_KEYS: flypy.SM_KEYS,
    SM_NAME: flypy.SM_NAME,
    ROWS: flypy.ROWS,
    keyPlan: flypy.keyPlan,
    toFly: flypy.toFly,
    toFlyPhrase: flypy.toFlyPhrase,
    entryCode: flypy.entryCode,
    splitPinyin: flypy.splitPinyin,
  },
};

export const DEFAULT_SCHEME = 'flypy';

export function getScheme(id = DEFAULT_SCHEME) {
  return SCHEMES[id] || SCHEMES[DEFAULT_SCHEME];
}
