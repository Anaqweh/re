// Shared by the editor, preview and mail renderer. Stored content is data, not HTML.
export const richTextPrefix = 'INEXC-RICH-TEXT:1\n';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const merge = (text, variables) => String(text || '').replace(/\{\{(name|email|course)\}\}/g, (_, key) => String(variables[key] || ''));
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
  const arabic = (text.match(/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufefc]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return arabic || latin ? (arabic >= latin ? 'rtl' : 'ltr') : fallback;
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
        type: ['bullet', 'number'].includes(block.type) ? block.type : 'paragraph',
        runs: block.runs.map(run => {
          const clean = { text: String(run?.text || '') };
          for (const mark of ['bold', 'italic', 'underline', 'strike']) if (run?.[mark] === true) clean[mark] = true;
          const href = safeInlineLink(run?.href); if (href) clean.href = href;
          return clean;
        })
      };
    })
  };
}

export function messageText(value, variables = null) {
  const text = messageDocument(value).blocks.map(block => block.runs.map(run => run.text).join('')).join('\n');
  return variables ? merge(text, variables) : text;
}

export function normaliseMessageBody(value) {
  const raw = String(value || '').trim();
  if (raw.length > 80000) throw invalid('حجم تنسيق الرسالة كبير جدًا. قلّل التنسيق ثم أعد الحفظ.');
  const document = messageDocument(raw);
  const text = document.blocks.map(block => block.runs.map(run => run.text).join('')).join('\n');
  if (text.length > 5000) throw invalid('الحد الأقصى لنص الرسالة 5000 حرف.');
  if (!text.trim()) return '';
  return raw.startsWith(richTextPrefix) ? richTextPrefix + JSON.stringify(document) : raw;
}

export function renderMessageBody(value, variables = null) {
  const document = messageDocument(value);
  const plain = messageText(value, variables);
  const direction = document.direction === 'auto' ? messageDirection(plain) : document.direction;
  let html = '', list = '';
  for (const block of document.blocks) {
    const runs = personalizedRuns(block.runs, variables);
    const text = runs.map(run => run.text).join('');
    const dir = document.direction === 'auto' ? messageDirection(text, direction) : direction;
    const alignment = dir === 'rtl' ? 'right' : 'left';
    const type = block.type === 'bullet' ? 'ul' : block.type === 'number' ? 'ol' : '';
    if (list && list !== type) { html += `</${list}>`; list = ''; }
    if (type && !list) { html += `<${type} dir="${dir}" style="margin:10px 0;padding:0 26px;direction:${dir};text-align:${alignment}">`; list = type; }
    const content = runs.map(run => {
      let text = escape(run.text).replace(/\n/g, '<br>');
      if (run.bold) text = `<strong>${text}</strong>`;
      if (run.italic) text = `<em>${text}</em>`;
      if (run.underline) text = `<u>${text}</u>`;
      if (run.strike) text = `<s>${text}</s>`;
      if (run.href) text = `<a href="${escape(run.href)}" style="color:#0866c6;text-decoration:underline" target="_blank" rel="noopener noreferrer">${text}</a>`;
      return text;
    }).join('') || '<br>';
    const tag = type ? 'li' : 'p';
    html += `<${tag} dir="${dir}" style="margin:${type ? '4px 0' : '0 0 12px'};direction:${dir};text-align:${alignment};line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere">${content}</${tag}>`;
  }
  if (list) html += `</${list}>`;
  return { html, text: plain, direction };
}
