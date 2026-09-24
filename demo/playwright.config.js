import {defineConfig} from '@playwright/test'
export default defineConfig({testDir:'./tests',timeout:90000,use:{baseURL:'http://127.0.0.1:5179',viewport:{width:1440,height:1000},launchOptions:{channel:'msedge',args:['--enable-unsafe-swiftshader']}},webServer:{command:'npm.cmd run dev -- --host 127.0.0.1 --port 5179 --strictPort',url:'http://127.0.0.1:5179',reuseExistingServer:true}})
