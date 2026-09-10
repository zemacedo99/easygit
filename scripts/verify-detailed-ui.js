'use strict';
// Run: .\node_modules\.bin\electron.cmd scripts/verify-detailed-ui.js
// Real main/preload/renderer, isolated profile and disposable Git project.
// One sacrificial file is sent to the OS Recycle Bin; no user project is used.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'easygit-ui-'));
app.setPath('userData', temp);
const root = path.join(temp, 'sample'); fs.mkdirSync(root);
const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
git('init', '-q'); git('config', 'user.name', 'UI Test'); git('config', 'user.email', 'ui@example.invalid');
fs.writeFileSync(path.join(root, 'example.txt'), 'before\n'); git('add', '.'); git('commit', '-qm', 'Initial project');
fs.writeFileSync(path.join(root, 'example.txt'), 'after\n'); git('add', '.'); git('commit', '-qm', 'Improve example');
for (let i = 0; i < 250; i++) fs.writeFileSync(path.join(root, `change-${i}.txt`), 'temporary\n');
const timeout = setTimeout(() => { console.error('UI verification timed out'); app.exit(1); }, 90000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_event, _level, message) => console.log('renderer:', message));
  win.webContents.once('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const ui = await import('./ui.js');
        const api = window.easygit;
        const added = await api.addRepo(${JSON.stringify(root)});
        if (!added.ok) throw Error('Add failed');
        const id = added.repo.id;
        let snapshot = await api.checkOne(id, { fetch: false });
        const handlers = {
          onOpenCode: () => api.openCode(id), onSettings: () => {}, onCheck: () => {}, onOpenFolder: () => {}, onRename: () => {}, onRemove: () => {},
          onStashList: () => api.stashList(id), onStashFiles: oid => api.stashFiles(id, oid), onStashChange: (op, value) => api.stashChange(id, op, value),
          onCommitFiles: oid => api.commitFiles(id, oid), onCommitDiff: (oid, file, limit) => api.commitDiff(id, oid, file, limit),
          onTrash: file => ui.confirmTrash(file, async () => { window.trashResult = await api.trashFile(id, file); }),
          onStage: () => {}, onStageAll: () => {}, onUnstage: () => {}, onReveal: () => {},
        };
        const render = advanced => ui.renderDetails(added.repo, snapshot.details, handlers, { showAdvanced: advanced });
        const click = text => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim().includes(text)); if (!button) throw Error('Missing button '+text); button.click(); };
        const waitFor = async predicate => { for (let i=0;i<100;i++) { if(predicate()) return; await new Promise(r=>setTimeout(r,50)); } throw Error('Timed out waiting for UI'); };
        render(false);
        if (document.querySelector('.area-stash') || document.body.textContent.includes('View changes')) throw Error('Simple mode leaked controls');
        ui.renderDetails(added.repo, null, handlers, {});
        if (!document.body.textContent.includes('Open in VS Code')) throw Error('Launcher missing before check');
        ui.showSettingsModal({showVSCode:true}, async settings => { await api.setSettings(settings); });
        const setting = [...document.querySelectorAll('label')].find(el=>el.textContent.includes('Show “Open in VS Code”'));
        setting.querySelector('input').click(); click('Done');
        await waitFor(() => !document.querySelector('.modal-overlay'));
        const saved = await api.getSettings(); if(saved.showVSCode !== false) throw Error('Preference not persisted');
        const disabledHandlers = {...handlers, onOpenCode:null}; ui.renderDetails(added.repo, null, disabledHandlers, {});
        if(document.body.textContent.includes('Open in VS Code')) throw Error('Disabled launcher visible');
        render(true);
        const scroll = document.querySelector('.area-computer .area-scroll');
        if(scroll.scrollHeight <= scroll.clientHeight || scroll.clientHeight > 361) throw Error('List is not capped');
        if(document.querySelectorAll('.area-computer .file-row').length !== 250) throw Error('Files hidden');
        click('View changes'); await waitFor(()=>document.querySelector('.inspection-files button'));
        document.querySelector('.inspection-files button').click(); await waitFor(()=>document.querySelector('.diff-add'));
        if(!document.querySelector('.diff-remove')) throw Error('Missing removed lines');
        click('Close');
        click('Set changes aside');
        const description = document.querySelector('input[maxlength="500"]'); description.value='UI stack test';
        const buttons = [...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Set changes aside')); buttons.at(-1).click();
        await waitFor(()=>!document.querySelector('input[maxlength="500"]'));
        // Await the operation via stack reads without issuing another mutation.
        let stack; for(let i=0;i<50;i++){ stack=await api.stashList(id); if(stack.entries.length) break; await new Promise(r=>setTimeout(r,50)); }
        if(stack.entries.length!==1) throw Error('UI set-aside failed');
        click('Show / refresh stack'); await waitFor(()=>document.querySelector('.stash-entry'));
        click('Show files'); await waitFor(()=>document.querySelector('.stash-entry .inspection-files'));
        if(document.querySelectorAll('.stash-entry li').length!==250) throw Error('Stack files missing');
        const restored=await api.stashChange(id,'pop',stack.entries[0].oid); if(!restored.ok) throw Error('Restore failed');
        window.trashResult=null;
        document.querySelector('[title="Move to Recycle Bin"]').click();
        if(window.trashResult) throw Error('Removed before confirmation');
        click('Continue'); if(window.trashResult) throw Error('Removed before second confirmation');
        click('Yes, move it'); await waitFor(()=>window.trashResult);
        if(!window.trashResult.ok) throw Error('Recycle Bin failed');
        snapshot=await api.checkOne(id,{fetch:false}); render(true);
        return {files:snapshot.details.working.length, checks:'Simple/Detailed visibility, settings, 250-file scrolling, lazy diff, stash and OS Recycle Bin'};
      })()`, true);
      assert.equal(result.files, 249);
      console.log('View and IPC checks passed; reloading controller');
      // Reload to test the controller itself, not just isolated view callbacks.
      await win.webContents.executeJavaScript('window.easygit.setSettings({showAdvanced:true,showVSCode:true})');
      const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
      win.reload(); await loaded;
      console.log('Controller reloaded');
      const controller = await win.webContents.executeJavaScript(`(async () => {
        const waitFor = async predicate => { for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50));} throw Error('Controller timed out'); };
        const click = text => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().includes(text));if(!b)throw Error('Missing '+text);b.click(); };
        await waitFor(()=>document.querySelector('.repo-card')); document.querySelector('.repo-card').click();
        click('Check changes'); await waitFor(()=>document.querySelector('.area-stash'));
        click('Set changes aside'); document.querySelector('input[maxlength="500"]').value='Controller stack';
        [...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Set changes aside')).at(-1).click();
        await waitFor(()=>document.querySelector('.toast')?.textContent.includes('Changes set aside'));
        await waitFor(()=>!document.querySelector('#details.busy'));
        click('Show / refresh stack'); await waitFor(()=>document.querySelector('.stash-entry'));
        click('Restore changes'); [...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Restore changes')).at(-1).click();
        await waitFor(()=>[...document.querySelectorAll('.toast')].some(t=>t.textContent.includes('Changes restored')));
        await waitFor(()=>document.querySelectorAll('.area-computer .file-row').length===249);
        click('View changes'); await waitFor(()=>document.querySelector('.inspection-files button'));
        document.querySelector('.inspection-files button').click(); await waitFor(()=>document.querySelector('.diff-add')); click('Close');
        // Existing description/Suggest dialog still calls the real local engine.
        const ui=await import('./ui.js'); const repos=await window.easygit.listRepos(); const id=repos[0].id;
        ui.showUploadMessageModal({onSubmit:()=>{},onSuggest:()=>window.easygit.suggestMessage(id,{staged:false})});
        click('Suggest'); await waitFor(()=>document.querySelector('textarea').value.length>0); click('Cancel');
        document.getElementById('btn-scan').click();
        if(!document.body.textContent.includes('Add repository from link or SSH'))throw Error('Clone entry missing');
        click('Cancel');
        click('View changes'); await waitFor(()=>document.querySelector('.inspection-files button'));
        document.querySelector('.inspection-files button').click(); await waitFor(()=>document.querySelector('.diff-add'));
        // Native editor integration is opt-in for a repeatable harness.
        return {controller:'Passed: real controller stash/restore, diff, Suggest and scan entry'};
      })()`, true);
      console.log(JSON.stringify(controller));
      const screenshot = path.join(temp, 'detailed-ui.png');
      win.show(); win.focus();
      let capture;
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        capture = await win.webContents.capturePage();
        if (!capture.isEmpty()) break;
      }
      if (!capture.isEmpty()) fs.writeFileSync(screenshot, capture.toPNG());
      console.log(JSON.stringify({ ...result, screenshot: capture.isEmpty() ? 'Unavailable: desktop capture returned empty' : screenshot, profile: temp }));
      clearTimeout(timeout); app.exit(0);
    } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
  });
});
require('../src/main/main');
