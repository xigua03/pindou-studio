import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'

// 兼容旧的 #/xxx 深链/分享链接：转换成 History 路径
if (location.hash.startsWith('#/')) {
  history.replaceState(null, '', location.pathname + location.hash.slice(1))
}

createApp(App).use(router).mount('#app')