/**
 * verify / smoke 要读本机的真实数据，路径和账号因人而异，所以只从环境变量拿。
 * 仓库里不留默认值——默认路径里带着 Windows 用户名和 Steam ID，不该跟着代码走。
 */
export function requireEnv(name: string, hint: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`缺少环境变量 ${name}`);
    console.error(`  ${hint}`);
    console.error('  用法见 README 的「脚本」一节。');
    process.exit(1);
  }
  return value;
}
