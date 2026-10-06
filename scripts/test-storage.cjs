const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
// Isolated contexts only; refuse production URLs to avoid writing test notes there.
const base=process.argv[2] || 'http://127.0.0.1:18191/';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
(async()=>{
 const browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage();
 p.on('pageerror',e=>console.log('PAGEERROR',e.message));
 await p.goto(base);await p.getByText('还没有项目，点击右下角新建',{exact:true}).waitFor();
 console.log('initialized');await p.getByText('＋',{exact:true}).click();await p.waitForTimeout(300);await p.locator('input[placeholder="输入项目或事项名称"]').fill('持久化测试');await p.getByText('创建',{exact:true}).click();await p.getByText('持久化测试',{exact:true}).waitFor();
 await p.reload();await p.getByText('持久化测试',{exact:true}).waitFor();console.log('PASS reload persistence');
 const p2=await ctx.newPage();await p2.goto(base);await p2.getByText('持久化测试',{exact:true}).waitFor();
 await p.getByText('＋',{exact:true}).click();await p.waitForTimeout(300);await p.locator('input[placeholder="输入项目或事项名称"]').fill('另一页新增');await p.getByText('创建',{exact:true}).click();await p.getByText('另一页新增',{exact:true}).waitFor();
 await p2.getByText('＋',{exact:true}).click();await p2.waitForTimeout(300);await p2.locator('input[placeholder="输入项目或事项名称"]').fill('旧页面覆盖');await p2.getByText('创建',{exact:true}).click();await p2.getByText('数据已在其他页面更新，请刷新后再编辑',{exact:true}).waitFor();console.log('PASS stale tab rejected');
 await p2.reload();await p2.getByText('另一页新增',{exact:true}).waitFor();assert.equal(await p2.getByText('旧页面覆盖',{exact:true}).count(),0);
 await p.bringToFront();
 await p.getByText('关闭',{exact:true}).click();
 await p.evaluate(()=>{
 const put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put=function(...args){const r=put.apply(this,args);r.addEventListener('success',()=>this.transaction.abort());return r;};
 });
 await p.getByText('＋',{exact:true}).click();await p.waitForTimeout(300);await p.locator('input[placeholder="输入项目或事项名称"]').fill('失败不能落库');await p.getByText('创建',{exact:true}).click();await p.getByText('无法保存本机数据，请重试或导出备份',{exact:true}).waitFor();console.log('PASS transaction abort reported');
 await p.reload();await p.getByText('持久化测试',{exact:true}).waitFor();assert.equal(await p.getByText('失败不能落库',{exact:true}).count(),0);console.log('PASS abort preserved previous notes');
 const broken=await browser.newContext();await broken.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{get(){return undefined;}});});const b=await broken.newPage();await b.goto(base);await b.getByText('无法读取本机数据，请重试。不要清除站点数据。',{exact:true}).waitFor();assert.equal(await b.getByText('＋',{exact:true}).count(),0);await b.getByText('重试',{exact:true}).waitFor();console.log('PASS unavailable storage startup error');
 await ctx.close();await broken.close();await browser.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
