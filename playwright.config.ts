import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'**/*.spec.ts',fullyParallel:false,workers:1,
  timeout:30000,retries:0,
  use:{baseURL:'http://127.0.0.1:4321',channel:process.env.PLAYWRIGHT_CHANNEL || undefined,viewport:{width:1512,height:982},screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{command:'node scripts/test-server.mjs',url:'http://127.0.0.1:4321/api/health',reuseExistingServer:false,timeout:20000},
});
