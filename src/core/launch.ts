/**
 * 用 Steam 直接把 KovaaK's 拉起来并进到某个场景。
 *
 * 824270 是 KovaaK's 的 Steam appid，`jump-to-scenario` 是游戏自己认的指令，写法抄自
 * evxl.app 的「▶」按钮。场景名按原样拼进去（不做 URL 编码），因为解码是游戏那侧做的，
 * 编了反而对不上场景；名字里带 `;` 的场景会解析不出来，这是这套协议的边界。
 */
export const KOVAAKS_STEAM_APP_ID = 824270;

export function scenarioLaunchUrl(scenario: string): string {
  return `steam://run/${KOVAAKS_STEAM_APP_ID}/?action=jump-to-scenario;name=${scenario};mode=challenge`;
}
