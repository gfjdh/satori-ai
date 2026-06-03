import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import Dashboard from './views/Dashboard.vue'
import Setup from './views/Setup.vue'
import Environment from './views/Environment.vue'
import Services from './views/Services.vue'
import Update from './views/Update.vue'
import Guide from './views/Guide.vue'
import './style.css'

const routes = [
  { path: '/', name: 'Dashboard', component: Dashboard },
  { path: '/setup', name: 'Setup', component: Setup },
  { path: '/env', name: 'Environment', component: Environment },
  { path: '/services', name: 'Services', component: Services },
  { path: '/update', name: 'Update', component: Update },
  { path: '/guide', name: 'Guide', component: Guide },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

createApp(App).use(router).mount('#app')
