import {fontById,fontStack,buttonSettings,buttonHref,safeButtonHref,renderButton} from './message-design.js';
// Shared by the editor, preview and mail renderer. Stored content is data, not HTML.
export const richTextPrefix = 'INEXC-RICH-TEXT:1\n';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const merge = (text, variables) => String(text || '').replace(/\{\{(name|email|course)\}\}/g, (_, key) => String(variables[key] || ''));
export const messageColors = ['#343a40', '#0866c6', '#137b55', '#a33a2b', '#7355a4'];
const invalid = message => Object.assign(new Error(message), { status: 400 });

function personalizedRuns(runs, variables) {
  if (!variables) return runs;
  const fullText = runs.map(run => run.text).join('');
  const tokens = [...fullText.matchAll(/\{\{(name|email|course)\}\}/g)];
  let offset = 0;
  return runs.map(run => {
    const start = offset, end = offset + run.text.length; offset = end;
    let cursor = start, text = '';
    for (const token of tokens) {
      const tokenStart = token.index, tokenEnd = tokenStart + token[0].length;
      if (tokenEnd <= start || tokenStart >= end) continue;
      text += fullText.slice(cursor, Math.max(cursor, tokenStart));
      if (tokenStart >= start) text += String(variables[token[1]] || '');
      cursor = Math.min(end, tokenEnd);
    }
    text += fullText.slice(cursor, end);
    return { ...run, text };
  });
}

export function safeInlineLink(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !/[\u0000-\u001f\u007f]/.test(value) ? url.href : '';
  } catch { return ''; }
}

export function messageDirection(value, fallback = 'rtl') {
  const text = String(value || '').replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+|\{\{\w+\}\}/g, '');
  const first = text.match(/[A-Za-z\u0620-\u064a\u066e-\u06d3\u06fa-\u06fc]/)?.[0];
  return first ? (/[A-Za-z]/.test(first) ? 'ltr' : 'rtl') : fallback;
}

export function messageDocument(value) {
  const raw = String(value || '');
  if (!raw.startsWith(richTextPrefix)) return { direction: 'auto', blocks: raw.split(/\r?\n/).map(text => ({ type: 'paragraph', runs: [{ text }] })) };
  let document;
  try { document = JSON.parse(raw.slice(richTextPrefix.length)); } catch { throw invalid('تعذر قراءة تنسيق الرسالة. أعد فتح القالب وحفظه.'); }
  if (!Array.isArray(document?.blocks) || document.blocks.length > 2000) throw invalid('تنسيق الرسالة غير صالح أو يحتوي على فقرات كثيرة جدًا.');
  let runCount = 0;
  return {
    direction: ['rtl', 'ltr'].includes(document.direction) ? document.direction : 'auto',
    blocks: document.blocks.map(block => {
      if (!Array.isArray(block?.runs) || (runCount += block.runs.length) > 10000) throw invalid('تنسيق الكلمات أكبر من الحد المسموح. بسّط التنسيق ثم احفظ.');
      return {
        type: ['bullet', 'number', 'heading', 'image', 'divider', 'button'].includes(block.type) ? block.type : 'paragraph',
        direction: ['rtl','ltr'].includes(block.direction) ? block.direction : 'auto',
        align: ['right','left','center'].includes(block.align) ? block.align : '',
        ...(block.type === 'image' ? {src: safeInlineLink(block.src).startsWith('https:') ? safeInlineLink(block.src) : '', alt: String(block.alt || '').slice(0,200)} : {}),
        ...(block.type === 'button' ? {href: safeButtonHref(block.href),...(block.button?{button:buttonSettings(block.button)}:{})} : {}),
        runs: block.runs.map(run => {
          const clean = { text: String(run?.text || '') };
          for (const mark of ['bold', 'italic', 'underline', 'strike']) if (run?.[mark] === true) clean[mark] = true;
          if (/^#[a-f0-9]{6}$/i.test(run?.color||'')) clean.color = run.color;
          if(fontById(run?.font))clean.font=run.font;
          if(Number.isFinite(Number(run?.size))&&Number(run.size)>=8&&Number(run.size)<=96)clean.size=Number(run.size);
          const href = safeInlineLink(run?.href); if (href) clean.href = href;
          return clean;
        })
      };
    })
  };
}

export function messageText(value, variables = null) {
  const text = messageDocument(value).blocks.map(block => (block.type === 'image' ? block.alt || '' : block.runs.map(run => run.text).join(''))).join('\n');
  return variables ? merge(text, variables) : text;
}

export function normaliseMessageBody(value) {
  const raw = String(value || '').trim();
  if (raw.length > 80000) throw invalid('حجم تنسيق الرسالة كبير جدًا. قلّل التنسيق ثم أعد الحفظ.');
  const document = messageDocument(raw);
  const text = document.blocks.map(block => (block.type === 'image' ? block.alt || '' : block.runs.map(run => run.text).join(''))).join('\n');
  if (text.length > 5000) throw invalid('الحد الأقصى لنص الرسالة 5000 حرف.');
  if (!text.trim() && !document.blocks.some(b => b.type === 'image' && b.src)) return '';
  return raw.startsWith(richTextPrefix) ? richTextPrefix + JSON.stringify(document) : raw;
}

export function renderMessageBody(value, variables = null, defaults = {}) {
  const document = messageDocument(value);
  const plain = messageText(value, variables);
  const direction = document.direction === 'auto' ? messageDirection(plain) : document.direction;
  let html = '', list = ''; const plainBlocks=[];
  for (const block of document.blocks) {
    const runs = personalizedRuns(block.runs, variables);
    const text = runs.map(run => run.text).join('');
    plainBlocks.push(block.type==='image'?block.alt||'':text);
    const dir = block.direction !== 'auto' && block.direction ? block.direction : document.direction === 'auto' ? messageDirection(text, direction) : direction;
    const alignment = block.align || (dir === 'rtl' ? 'right' : 'left');
    const type = block.type === 'bullet' ? 'ul' : block.type === 'number' ? 'ol' : '';
    if (list && list !== type) { html += `</${list}>`; list = ''; }
    if (type && !list) { html += `<${type} dir="${dir}" style="margin:10px 0;padding:0 26px;direction:${dir};text-align:${alignment}">`; list = type; }
    const content = runs.map(run => {
      let text = escape(run.text).replace(/\n/g, '<br>');
      text = text.replace(/(?:https?:\/\/[^\s<]+|[A-Za-z0-9.+_-]+@[A-Za-z0-9.-]+|\+?\d[\d .-]{3,}\d)/g, token => `<bdi dir="ltr" style="direction:ltr;unicode-bidi:isolate">${token}</bdi>`);
      if(run.font||run.size)text=`<span${run.font?` data-font="${run.font}"`:''} style="${run.font?'font-family:'+escape(fontStack(run.font))+';':''}${run.size?'font-size:'+run.size+'px;':''}">${text}</span>`;
      if (run.color) text = `<span style="color:${run.color}">${text}</span>`;
      if (run.bold) text = `<strong>${text}</strong>`;
      if (run.italic) text = `<em>${text}</em>`;
      if (run.underline) text = `<u>${text}</u>`;
      if (run.strike) text = `<s>${text}</s>`;
      if (run.href) text = `<a href="${escape(run.href)}" style="color:#0866c6;text-decoration:underline" target="_blank" rel="noopener noreferrer">${text}</a>`;
      return text;
    }).join('') || '<br>';
    if (block.type === 'image') {
      if (block.src) html += `<p data-block="image" data-direction="${block.direction || 'auto'}" data-align="${block.align || ''}" dir="${dir}" style="text-align:${alignment};margin:16px 0"><img src="${escape(block.src)}" alt="${escape(block.alt)}" width="540" style="max-width:100%;height:auto;display:inline-block;border:0" loading="lazy"></p>`;
      continue;
    }
    if (block.type === 'divider') { html += '<hr style="border:0;border-top:1px solid #dce6f0;margin:24px 0">'; continue; }
    if (block.type === 'button') {
      const style=block.button?buttonSettings(block.button):null;
      const href=style&&variables?buttonHref({...style,message:merge(style.message,variables)}):block.href;
      if(href)plainBlocks[plainBlocks.length-1]+=': '+href;
      html += `<p data-block="button" ${style?`data-button="${escape(JSON.stringify(style))}"`:''} data-direction="${block.direction || 'auto'}" data-align="${block.align || ''}" dir="${dir}" style="text-align:${style?.align||alignment};margin:20px 0">${style?renderButton(style,{family:defaults.font||'tahoma',label:text,href}):`<a href="${escape(href || '')}" style="background:#0866c6;color:#fff;display:inline-block;padding:12px 24px;border-radius:6px;text-decoration:none">${content}</a>`}</p>`;
      continue;
    }
    const tag = type ? 'li' : block.type === 'heading' ? 'h2' : 'p';
    html += `<${tag} dir="${dir}" data-direction="${block.direction || 'auto'}" data-align="${block.align || ''}" style="margin:${type ? '4px 0' : '0 0 12px'};direction:${dir};text-align:${alignment};line-height:${defaults.lineHeight||1.9};white-space:pre-wrap;overflow-wrap:anywhere">${content}</${tag}>`;
  }
  if (list) html += `</${list}>`;
  return { html, text: plainBlocks.join('\n'), direction };
}
