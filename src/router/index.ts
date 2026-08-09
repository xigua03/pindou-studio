import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from '../utils/api'
import { authState } from '../composables/useAuth'

const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue'), meta: { title: '图纸库', feature: 'gallery' } },
  { path: '/pattern/:id', name: 'pattern', component: () => import('../views/PatternDetailView.vue'), meta: { title: '图纸详情', feature: 'gallery' } },
  { path: '/generator', name: 'generator', component: () => import('../views/GeneratorView.vue'), meta: { title: '图片转图纸', feature: 'generator' } },
  { path: '/ai', name: 'ai', component: () => import('../views/AiView.vue'), meta: { title: 'AI 生成图纸', feature: 'ai' } },
  { path: '/editor/:id', name: 'editor', component: () => import('../views/EditorView.vue'), meta: { title: '图纸编辑', feature: 'gallery' } },
  { path: '/warehouse', name: 'warehouse', component: () => import('../views/WarehouseView.vue'), meta: { title: '豆仓', feature: 'warehouse' } },
  { path: '/mine', name: 'mine', component: () => import('../views/MyView.vue'), meta: { title: '我的' } },
  { path: '/palette', name: 'palette', component: () => import('../views/PaletteView.vue'), meta: { title: '色卡', feature: 'palette' } },
  { path: '/share/:token', name: 'share', component: () => import('../views/SharedView.vue'), meta: { title: '共享图纸', feature: 'share' } },
  { path: '/login', name: 'login', component: () => import('../views/AuthView.vue'), meta: { title: '登录 / 注册', guestOnly: true } },
  { path: '/reset-password', name: 'reset-password', component: () => import('../views/ResetPasswordView.vue'), meta: { title: '重置密码', guestOnly: true } },
  { path: '/profile/:tab?', name: 'profile', component: () => import('../views/ProfileView.vue'), meta: { title: '个人中心', requiresAuth: true } },
  { path: '/admin/:tab?', name: 'admin', component: () => import('../views/AdminView.vue'), meta: { title: '后台管理', requiresAuth: true, requiresAdmin: true } },
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

export default router
