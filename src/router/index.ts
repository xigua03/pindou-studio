import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue'), meta: { title: '图纸库' } },
  { path: '/pattern/:id', name: 'pattern', component: () => import('../views/PatternDetailView.vue'), meta: { title: '图纸详情' } },
  { path: '/generator', name: 'generator', component: () => import('../views/GeneratorView.vue'), meta: { title: '图片转图纸' } },
  { path: '/editor/:id', name: 'editor', component: () => import('../views/EditorView.vue'), meta: { title: '图纸编辑' } },
  { path: '/warehouse', name: 'warehouse', component: () => import('../views/WarehouseView.vue'), meta: { title: '豆仓' } },
  { path: '/mine', name: 'mine', component: () => import('../views/MyView.vue'), meta: { title: '我的' } },
  { path: '/palette', name: 'palette', component: () => import('../views/PaletteView.vue'), meta: { title: '色卡' } },
  { path: '/share/:token', name: 'share', component: () => import('../views/SharedView.vue'), meta: { title: '共享图纸' } }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  }
})

router.afterEach((to) => {
  document.title = (to.meta.title ? `${to.meta.title} · ` : '') + '拼豆工坊'
})

export default router