import { chromium } from 'playwright'
const B='http://localhost:3000'
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-proxy-server']})
const c=await b.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:2,colorScheme:'dark'})
const p=await c.newPage()
await p.goto(B+'/login',{waitUntil:'domcontentloaded'})
await p.fill('input[type="email"]','alex@bluecroft.co.uk'); await p.fill('input[type="password"]','Bluecroft2026!')
await p.click('button[type="submit"]'); await p.waitForURL(u=>!u.pathname.startsWith('/login'),{timeout:40000,waitUntil:'commit'})
await p.close()
for (const [n,u] of [['dashboard','/'],['inventory','/inventory'],['new','/inventory/new'],['profile','/settings/profile'],['reports','/reports']]) {
  const page=await c.newPage()
  await page.goto(B+u,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(1500)
  await page.screenshot({path:`/tmp/qa/k-${n}.png`, fullPage:true})
  await page.close()
}
await b.close(); console.log('dark captured')
