/**
 * 构建前清理宝塔 .user.ini（可能被 chattr +i 设成不可变）
 * 1) 先尝试 chattr -i 解除不可变属性（Linux root 下有效）
 * 2) 再删除文件，保证 vite build 清空 dist/ 时不会 EPERM
 */
import { execSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const targets = [
  join(root, 'dist', '.user.ini'),
  join(root, '.user.ini')
]

for (const t of targets) {
  if (!existsSync(t)) continue
  try {
    execSync(`chattr -i "${t}"`, { stdio: 'ignore' })
  } catch {
    /* 非 Linux / 无权限时忽略，继续尝试删除 */
  }
  try {
    rmSync(t, { force: true })
    console.log('[prebuild] 已移除', t)
  } catch {
    console.warn('[prebuild] 无法删除', t, '—— 请在服务器上以 root 执行: chattr -i', t, '&& rm -f', t)
  }
}
