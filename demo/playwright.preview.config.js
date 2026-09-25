import {defineConfig} from '@playwright/test'
export default defineConfig({
  testDir:'./tests',testMatch:'production-preview.spec.js',timeout:180000,
  use:{baseURL:'http://127.0.0.1:5184',viewport:{width:1440,height:1000},launchOptions:{channel:'msedge',args:['--enable-unsafe-swiftshader']}},
  webServer:{command:'npm.cmd run preview -- --host 127.0.0.1 --port 5184 --strictPort',url:'http://127.0.0.1:5184',reuseExistingServer:false},
})
