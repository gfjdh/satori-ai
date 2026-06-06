import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

import Dashboard from './views/Dashboard.vue'
import Setup from './views/Setup.vue'
import Services from './views/Services.vue'
import Guide from './views/Guide.vue'

const routes = [
  { path: '/', component: Dashboard },
  { path: '/setup', component: Setup },
  { path: '/services', component: Services },
  { path: '/guide', component: Guide }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

createApp(App).use(router).mount('#app')
