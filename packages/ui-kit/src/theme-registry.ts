/**
 * T3.3 ui-kit 侧的极简主题注册表：宿主（桌面）在解析 Pi 主题后调用 setShikiThemeName，
 * code-block / shiki-command 取色时读取它（默认 github-dark-default）。
 * 避免 ui-kit 反向依赖桌面 store；token 级自定义 shiki 主题为后续增强。
 */
let shikiThemeName = "github-dark-default";

export function setShikiThemeName(name: string): void {
  shikiThemeName = name;
}

export function getShikiThemeName(): string {
  return shikiThemeName;
}
