import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',workers:1,use:{baseURL:'http://127.0.0.1:3000'},webServer:{command:'.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 3000 --no-access-log',url:'http://127.0.0.1:3000/health',reuseExistingServer:false,env:{DATABASE_PATH:'data/browser-e2e.sqlite3'}}});
