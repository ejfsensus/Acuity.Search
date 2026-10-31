import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const AG='https://agent.acuity.institute'
const env = Object.fromEntries(readFileSync('/workspace/.secrets/acuity-auth.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]))
const b = await chromium.launch({ executablePath: '/home/box/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome' })
const p = await (await b.newContext()).newPage(); const out = {}; let prompts = 0
p.on('framenavigated', f => { if (f === p.mainFrame() && /auth\.acuity\.institute\/sign-in/.test(f.url())) prompts++ })
await p.goto('https://search.acuity.institute/auth/login', { waitUntil: 'networkidle' }); await p.getByRole('button', { name: /acuity/i }).first().click()
await p.waitForURL(/auth\.acuity\.institute\/sign-in/, { timeout: 30000 }); await p.waitForTimeout(800); await p.fill('#email', env.STAGING_TEST_OIDC_EMAIL); await p.fill('#password', env.STAGING_TEST_OIDC_PASSWORD); await p.click('#submit')
await p.waitForURL(u => u.host === 'search.acuity.institute', { timeout: 30000 }); await p.waitForTimeout(2500)
out.search = !(await p.evaluate(() => document.body.innerText)).includes('Sign in to consult')
const first = prompts
await p.goto(AG + '/login', { waitUntil: 'networkidle' }); await p.getByRole('button', { name: /acuity/i }).first().click()
await p.waitForURL(u => u.host === 'agent.acuity.institute' && !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(()=>{}); await p.waitForTimeout(2500)
out.agentUrl = p.url().replace(/\?.*/,''); out.agent = !!(await p.evaluate(async () => (await fetch('/api/auth/get-session')).json()))?.user
const k = await p.evaluate(async () => { const r = await fetch('/api/auth/api-key/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'STAGING TEST smoke key',expiresIn:86400})}); const j = await r.json(); const d = await fetch('/api/auth/api-key/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({keyId:j.id})}); return [r.status, d.status] })
out.apiKey = k
await p.goto('https://codex.acuity.institute/api/acuity/oidc/login', { waitUntil: 'networkidle' }).catch(()=>{}); await p.waitForTimeout(2500)
out.codexMe = await p.evaluate(async () => (await fetch('/api/acuity/me')).status)
out.promptsAfterFirst = prompts - first
console.log(JSON.stringify(out, null, 1)); await b.close()
