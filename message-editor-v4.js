import { richTextPrefix, messageDocument, messageText, messageDirection, renderMessageBody, safeInlineLink, messageColors } from './inexc-api/message-format-v4.js?v=20261012-studio2';

export function createMessageEditor(textarea) {
  if (!document.querySelector('[data-message-editor-style]')) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./message-editor.css?v=20261012-studio2', import.meta.url).href; link.dataset.messageEditorStyle = ''; document.head.append(link);
  }
  const id = textarea.id, placeholder = textarea.placeholder;
  const shell = document.createElement('div'); shell.className = 'mc-editor-shell';
  shell.innerHTML = `<div class="mc-editor-toolbar" role="toolbar" aria-label="تنسيق نص الرسالة">
    <button type="button" data-command="bold" title="عريض (Ctrl+B)" aria-label="عريض" aria-pressed="false"><b>B</b></button>
    <button type="button" data-command="italic" title="مائل (Ctrl+I)" aria-label="مائل" aria-pressed="false"><i>I</i></button>
    <button type="button" data-command="underline" title="تسطير (Ctrl+U)" aria-label="تسطير" aria-pressed="false"><u>U</u></button>
    <button type="button" data-command="strikeThrough" title="شطب" aria-label="شطب" aria-pressed="false"><s>S</s></button>
    <button type="button" data-command="insertUnorderedList" title="قائمة نقطية" aria-label="قائمة نقطية">• قائمة</button>
    <button type="button" data-command="insertOrderedList" title="قائمة مرقمة" aria-label="قائمة مرقمة">1. قائمة</button>
    <button type="button" data-link title="إضافة رابط إلى الكلمات المحددة">رابط</button>
    <button type="button" data-command="removeFormat" title="مسح تنسيق الكلمات المحددة">مسح التنسيق</button>
    <button type="button" data-command="undo" title="تراجع (Ctrl+Z)" aria-label="تراجع">↶</button>
    <button type="button" data-command="redo" title="إعادة" aria-label="إعادة">↷</button>
  </div><div class="mc-editor-link" hidden><label for="${id}-link">رابط الكلمات المحددة</label><input id="${id}-link" type="url" dir="ltr" placeholder="https://..." aria-label="رابط الكلمات المحددة"><button type="button" data-apply-link>إضافة الرابط</button><button type="button" data-cancel-link>إلغاء</button></div>
  <div id="${id}" class="mc-rich-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${id === 'mc-body' ? 'نص الرسالة' : 'نص القالب'}" aria-describedby="${id}-help" spellcheck="true" tabindex="0" dir="auto"></div>
  <div class="mc-editor-bottom"><div class="mc-editor-direction" role="group" aria-label="اتجاه الرسالة"><button type="button" data-direction="auto" aria-pressed="true">تلقائي</button><button type="button" data-direction="rtl" aria-pressed="false">يمين</button><button type="button" data-direction="ltr" aria-pressed="false">يسار</button></div><span class="mc-editor-count" aria-live="polite">0 / 5000</span></div>
  <p id="${id}-help" class="mc-helper">حدّد الكلمات ثم اختر التنسيق. تتجه الفقرات تلقائيًا بحسب لغتها، ويُحفظ التنسيق مع القالب.</p>`;
  shell.querySelector('.mc-editor-toolbar').insertAdjacentHTML('beforeend', `<button type="button" data-heading title="عنوان فقرة">عنوان</button><button type="button" data-align="right" title="محاذاة لليمين">يمين</button><button type="button" data-align="center" title="توسيط">وسط</button><button type="button" data-align="left" title="محاذاة لليسار">يسار</button><button type="button" data-paragraph-dir="rtl" title="اتجاه الفقرة العربية">RTL</button><button type="button" data-paragraph-dir="ltr" title="اتجاه الفقرة الإنجليزية">LTR</button><button type="button" data-paragraph-dir="auto" title="اتجاه الفقرة تلقائي">تلقائي</button><select data-color aria-label="لون الكلمات المحددة"><option value="">لون النص</option>${messageColors.map((c,i)=>`<option value="${c}">${['حبر','أزرق','أخضر','أحمر','بنفسجي'][i]}</option>`).join('')}</select><button type="button" data-insert="image">صورة</button><button type="button" data-insert="button">زر</button><button type="button" data-divider>فاصل</button><button type="button" data-move="up" title="نقل الكتلة لأعلى">↑ كتلة</button><button type="button" data-move="down" title="نقل الكتلة لأسفل">↓ كتلة</button>`);
  shell.querySelector('.mc-editor-toolbar').insertAdjacentHTML('afterend', `<div class="mc-editor-media" hidden><label>الرابط<input data-media-url dir="ltr" placeholder="https://..."></label><label><span data-media-label>النص البديل</span><input data-media-text maxlength="200"></label><button type="button" data-media-apply>إدراج</button><button type="button" data-media-close>إلغاء</button><span data-media-error role="status"></span></div>`);
  textarea.replaceWith(shell);
  const editor = shell.querySelector('.mc-rich-editor');
  editor.dataset.placeholder = placeholder;
  let direction = 'auto', savedRange = null;

  function documentFromEditor(root = editor) {
    const blocks = []; let current = null;
    const flush = () => { if (current) blocks.push(current); current = null; };
    const walk = (node, marks = {}, list = '') => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.textContent) return;
        current ||= { type: list || 'paragraph', runs: [] };
        const run = { text: node.textContent, ...marks }, previous = current.runs.at(-1);
        if (previous && ['bold','italic','underline','strike','href','color'].every(key => previous[key] === run[key])) previous.text += run.text;
        else current.runs.push(run);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || ['SCRIPT','STYLE','IFRAME','OBJECT','SVG','META','LINK','FORM','INPUT','BUTTON'].includes(node.tagName)) return;
      const tag = node.tagName;
      const placement = {direction:node.dataset.direction || 'auto',align:node.dataset.align || ''};
      if (tag === 'IMG') { flush(); blocks.push({type:'image',src:node.getAttribute('src')||'',alt:node.getAttribute('alt')||'',runs:[],...placement}); return; }
      if (tag === 'HR') { flush(); blocks.push({type:'divider',runs:[]}); return; }
      if (node.dataset.block === 'image') { flush(); const img=node.querySelector('img'); if(img)blocks.push({type:'image',src:img.getAttribute('src'),alt:img.alt,runs:[],...placement}); return; }
      if (node.dataset.block === 'button') { flush(); const a=node.querySelector('a'); if(a)blocks.push({type:'button',href:a.getAttribute('href'),runs:[{text:a.textContent}],...placement}); return; }
      if (tag === 'BR') { if (node.parentElement.childNodes.length === 1) return; current ||= { type: list || 'paragraph', runs: [] }; current.runs.push({ text: '\n', ...marks }); return; }
      if (tag === 'UL' || tag === 'OL') { flush(); [...node.childNodes].forEach(child => walk(child, marks, tag === 'UL' ? 'bullet' : 'number')); flush(); return; }
      const block = ['P','DIV','LI','H1','H2','H3','BLOCKQUOTE'].includes(tag);
      if (block) { flush(); current = { type: list || (/^H[1-6]$/.test(tag) ? 'heading' : 'paragraph'), runs: [], ...placement }; }
      const next = { ...marks };
      if (['STRONG','B'].includes(tag) || /^(bold|[7-9]00)$/.test(node.style.fontWeight)) next.bold = true;
      if (['EM','I'].includes(tag) || node.style.fontStyle === 'italic') next.italic = true;
      if (tag === 'U' || node.style.textDecoration.includes('underline')) next.underline = true;
      if (['S','STRIKE','DEL'].includes(tag) || node.style.textDecoration.includes('line-through')) next.strike = true;
      const rgb = node.style.color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
      const color = rgb ? '#'+rgb.slice(1).map(n=>Number(n).toString(16).padStart(2,'0')).join('') : node.getAttribute('color') || node.style.color;
      if(messageColors.includes(color)) next.color=color;
      if (tag === 'A') { const href = safeInlineLink(node.getAttribute('href')); if (href) next.href = href; }
      [...node.childNodes].forEach(child => walk(child, next, list));
      if (block) flush();
    };
    [...root.childNodes].forEach(node => walk(node)); flush();
    return { direction, blocks };
  }

  function sync() {
    const text = editor.innerText || '';
    const dir = direction === 'auto' ? messageDirection(text) : direction;
    editor.dir = dir; editor.style.textAlign = dir === 'rtl' ? 'right' : 'left';
    editor.querySelectorAll('p,div,li,h1,h2,h3').forEach(node => {
      const localDir = ['rtl','ltr'].includes(node.dataset.direction) ? node.dataset.direction : direction === 'auto' ? messageDirection(node.textContent, dir) : direction;
      node.dir = localDir; node.style.direction = localDir; node.style.textAlign = node.dataset.align || (localDir === 'rtl' ? 'right' : 'left');
    });
    const count = documentFromEditor().blocks.map(block => block.runs.map(run => run.text).join('')).join('\n').length;
    shell.querySelector('.mc-editor-count').textContent = `${count} / 5000`;
    shell.querySelector('.mc-editor-count').classList.toggle('mc-editor-over-limit', count > 5000);
    editor.setAttribute('aria-invalid', String(count > 5000));
    shell.querySelectorAll('[data-direction]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.direction === direction)));
  }
  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
      savedRange = selection.getRangeAt(0).cloneRange();
      shell.querySelectorAll('[aria-pressed][data-command]').forEach(button => button.setAttribute('aria-pressed', String(document.queryCommandState(button.dataset.command))));
    }
  };
  const restoreSelection = () => {
    editor.focus();
    const selection = window.getSelection();
    if (savedRange && editor.contains(savedRange.commonAncestorContainer)) { selection.removeAllRanges(); selection.addRange(savedRange); }
    else { const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false); selection.removeAllRanges(); selection.addRange(range); }
  };
  const changed = () => { sync(); rememberSelection(); editor.dispatchEvent(new Event('input', { bubbles: true })); };
  function command(name, value = null) {
    rememberSelection();
    restoreSelection();
    // Native editing commands retain the browser's undo history.
    document.execCommand('styleWithCSS', false, false);
    document.execCommand(name, false, value);
    if (name === 'removeFormat') document.execCommand('unlink', false);
    changed();
  }
  shell.querySelectorAll('button').forEach(button => button.addEventListener('mousedown', event => event.preventDefault()));
  shell.querySelectorAll('[data-command]').forEach(button => button.onclick = () => command(button.dataset.command));
  shell.querySelectorAll('[data-direction]').forEach(button => button.onclick = () => { direction = button.dataset.direction; sync(); editor.dispatchEvent(new Event('input', { bubbles: true })); });
  shell.querySelector('[data-link]').onclick = () => {
    rememberSelection();
    if (!savedRange || savedRange.collapsed) { shell.querySelector(`#${id}-help`).textContent = 'حدّد الكلمات التي تريد تحويلها إلى رابط أولًا.'; editor.focus(); return; }
    shell.querySelector('.mc-editor-link').hidden = false; shell.querySelector('input').focus();
  };
  shell.querySelector('[data-cancel-link]').onclick = () => { shell.querySelector('.mc-editor-link').hidden = true; restoreSelection(); };
  shell.querySelector('[data-apply-link]').onclick = () => {
    const input = shell.querySelector('input'), href = safeInlineLink(input.value);
    input.setCustomValidity(href ? '' : 'اكتب رابطًا صحيحًا يبدأ بـ https:// أو http:// أو mailto:');
    if (!href) { input.reportValidity(); return; }
    command('createLink', href); input.value = ''; shell.querySelector('.mc-editor-link').hidden = true;
  };
  editor.addEventListener('input', sync);
  editor.addEventListener('paste', event => {
    event.preventDefault(); const html=event.clipboardData.getData('text/html');
    if(!html) { command('insertHTML',renderMessageBody(event.clipboardData.getData('text/plain')).html); return; }
    const detached=new DOMParser().parseFromString(html,'text/html').body;
    const doc=documentFromEditor(detached); command('insertHTML',renderMessageBody(richTextPrefix+JSON.stringify(doc)).html);
  });
  editor.addEventListener('drop', event => { event.preventDefault(); command('insertText', event.dataTransfer.getData('text/plain')); });
  editor.addEventListener('keyup', rememberSelection); editor.addEventListener('mouseup', rememberSelection);
  document.addEventListener('selectionchange', rememberSelection);
  Object.defineProperty(editor, 'value', {
    get() { const doc = documentFromEditor(); return doc.blocks.some(block => block.type === 'image' || block.runs.some(run => run.text.trim())) ? richTextPrefix + JSON.stringify(doc) : ''; },
    set(value) { const doc = messageDocument(value); direction = doc.direction; editor.innerHTML = doc.blocks.length ? renderMessageBody(value).html : ''; savedRange = null; sync(); }
  });
  const activeBlock = () => {
    restoreSelection(); const node=window.getSelection()?.anchorNode;
    let block=(node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement)?.closest('p,div,li,h1,h2,h3');
    if(!block || block===editor || !editor.contains(block)){command('formatBlock','p');block=window.getSelection()?.anchorNode?.parentElement?.closest('p,div,li,h1,h2,h3');}
    return block && block!==editor ? block : null;
  };
  shell.querySelector('[data-heading]').onclick=()=>command('formatBlock','h2');
  shell.querySelectorAll('[data-align]').forEach(button=>button.onclick=()=>{const block=activeBlock();if(block){block.dataset.align=button.dataset.align;changed();}});
  shell.querySelectorAll('[data-paragraph-dir]').forEach(button=>button.onclick=()=>{const block=activeBlock();if(block){block.dataset.direction=button.dataset.paragraphDir;block.dataset.align='';changed();}});
  const color=shell.querySelector('[data-color]');color.onmousedown=rememberSelection;color.onchange=()=>{if(color.value)command('foreColor',color.value);color.value='';};
  shell.querySelector('[data-divider]').onclick=()=>command('insertHTML','<hr><p><br></p>');
  let insertType='image';
  const media=shell.querySelector('.mc-editor-media');
  shell.querySelectorAll('[data-insert]').forEach(button=>button.onclick=()=>{rememberSelection();insertType=button.dataset.insert;media.hidden=false;media.querySelector('[data-media-label]').textContent=insertType==='image'?'نص بديل يصف الصورة':'نص الزر';media.querySelector('input').focus();});
  shell.querySelector('[data-media-close]').onclick=()=>{media.hidden=true;restoreSelection();};
  shell.querySelector('[data-media-apply]').onclick=()=>{
    const url=safeInlineLink(media.querySelector('[data-media-url]').value),text=media.querySelector('[data-media-text]').value.trim();
    if(!url.startsWith('https:')||!text){media.querySelector('[data-media-error]').textContent='أدخل رابط HTTPS كاملًا ونصًا واضحًا.';return;}
    const block=insertType==='image'?{type:'image',src:url,alt:text,runs:[]}:{type:'button',href:url,runs:[{text}]};
    command('insertHTML',renderMessageBody(richTextPrefix+JSON.stringify({blocks:[block,{type:'paragraph',runs:[{text:''}]}]})).html);media.hidden=true;
    media.querySelectorAll('input').forEach(i=>i.value='');media.querySelector('[data-media-error]').textContent='';
  };
  shell.querySelectorAll('[data-move]').forEach(button=>button.onclick=()=>{const block=activeBlock();if(!block)return;const sibling=button.dataset.move==='up'?block.previousElementSibling:block.nextElementSibling;if(!sibling)return;if(button.dataset.move==='up')sibling.before(block);else sibling.after(block);changed();});
  editor.value = textarea.value;
  const label = shell.previousElementSibling; if (label?.tagName === 'LABEL') label.htmlFor = id;
  return { element: editor, insertText: text => command('insertText', text), insertBody: body => command('insertHTML',renderMessageBody(body).html) };
}
