import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from '../utils/api'
import { authState } from '../composables/useAuth'

/**
 * 懒加载包装：给动态 import 加超时 + 单次自动重试。
 * 服务器休眠/连接冷却时，裸 import() 会无限挂起，表现为「点击导航没反应」——
 * 这里超时后主动报错（路由 onError 提示），用户再点一次即可恢复，不会卡死。
 */
function lazyLoad(factory: () => Promise<{ default: unknown }>) {
  return () => {
    const attempt = (): Promise<{ default: unknown }> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('chunk-timeout')), 20000)
        factory().then(
          (m) => {
            clearTimeout(timer)
            resolve(m)
          },
          (e) => {
            clearTimeout(timer)
            reject(e)
          }
        )
      })
    return attempt().catch((e) => {
      if (String((e && e.message) || e).includes('chunk-timeout')) {
        // 超时后重试一次（冷启动/网络恢复场景）
        return attempt()
      }
      throw e
    })
  }
}

const routes = [
  { path: '/', name: 'home', component: lazyLoad(() => import('../views/HomeView.vue')), meta: { title: '图纸库', feature: 'gallery' } },
  { path: '/pattern/:id', name: 'pattern', component: lazyLoad(() => import('../views/PatternDetailView.vue')), meta: { title: '图纸详情', feature: 'gallery' } },
  { path: '/generator', name: 'generator', component: lazyLoad(() => import('../views/GeneratorView.vue')), meta: { title: '图片转图纸', feature: 'generator' } },
  { path: '/ai', name: 'ai', component: lazyLoad(() => import('../views/AiView.vue')), meta: { title: 'AI 生成图纸', feature: 'ai' } },
  { path: '/editor/:id', name: 'editor', component: lazyLoad(() => import('../views/EditorView.vue')), meta: { title: '图纸编辑', feature: 'gallery' } },
  { path: '/warehouse', name: 'warehouse', component: lazyLoad(() => import('../views/WarehouseView.vue')), meta: { title: '豆仓', feature: 'warehouse' } },
  { path: '/mine', name: 'mine', component: lazyLoad(() => import('../views/MyView.vue')), meta: { title: '我的' } },
  { path: '/palette', name: 'palette', component: lazyLoad(() => import('../views/PaletteView.vue')), meta: { title: '色卡', feature: 'palette' } },
  { path: '/share/:token', name: 'share', component: lazyLoad(() => import('../views/SharedView.vue')), meta: { title: '共享图纸', feature: 'share' } },
  { path: '/login', name: 'login', component: lazyLoad(() => import('../views/AuthView.vue')), meta: { title: '登录 / 注册', guestOnly: true } },
  { path: '/reset-password', name: 'reset-password', component: lazyLoad(() => import('../views/ResetPasswordView.vue')), meta: { title: '重置密码', guestOnly: true } },
  { path: '/profile/:tab?', name: 'profile', component: lazyLoad(() => import('../views/ProfileView.vue')), meta: { title: '个人中心', requiresAuth: true } },
  { path: '/admin/:tab?', name: 'admin', component: lazyLoad(() => import('../views/AdminView.vue')), meta: { title: '后台管理', requiresAuth: true, requiresAdmin: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  }
})

router.beforeEach((to) => {
  const hasToken = !!getToken()
  if (to.meta.requiresAuth && !hasToken) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (to.meta.guestOnly && hasToken) {
    return { path: '/profile' }
  }
  if (to.meta.requiresAdmin && authState.user && authState.user.role !== 'admin') {
    return { path: '/' }
  }
  return true
})

router.afterEach((to) => {
  document.title = (to.meta.title ? `${to.meta.title} · ` : '') + '拼豆工坊'
})

/** 路由加载失败（懒加载 chunk 超时/断网等）：给出提示而不是静默卡死 */
router.onError((err) => {
  if (String((err && err.message) || err).includes('chunk-timeout')) {
    const msg = document.getElementById('pd-route-error')
    if (msg) msg.hidden = false
    const btn = document.getElementById('pd-route-error-close')
    if (btn) {
      btn.onclick = () => {
        if (msg) msg.hidden = true
      }
    }
  }
})

export default router
