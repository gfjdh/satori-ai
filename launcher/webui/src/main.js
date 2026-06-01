import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import Dashboard from './views/Dashboard.vue'
import Environment from './views/Environment.vue'
import Services from './views/Services.vue'
import Update from './views/Update.vue'

const routes = [
  { path: '/', name: 'Dashboard', component: Dashboard },
  { path: '/env', name: 'Environment', component: Environment },
  { path: '/services', name: 'Services', component: Services },
  { path: '/update', name: 'Update', component: Update },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

createApp(App).use(router).mount('#app')
