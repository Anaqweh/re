import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const unzip = promisify(execFile);
const maxTextBytes = 24 * 1024 * 1024;
const readerPath = fileURLToPath(new URL('./message-file-reader.py', import.meta.url));
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailHeaders = new Set(['email', 'emails', 'emailaddress', 'البريد', 'البريدالالكتروني', 'البريدالالكترونى', 'الايميل', 'عنوانالبريدالالكتروني']);
const nameHeaders = new Set(['name', 'fullname', 'الاسم', 'الاسمالكامل']);
const headerKey = value => String(value || '').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/[\s_\-\uFEFF]/g, '');

export function extractEmails(value) {
  const text = decodeXml(String(value || '')).replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
  return [...text.matchAll(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi)]
    .map(match => match[0].replace(/^\.+|\.+$/g, ''))
    .filter(email => email.length <= 254 && email.split('@')[0].length <= 64 && !email.includes('..'));
}

const emailContacts = text => extractEmails(text).map(email => ({ name: '', email }));
const ocrContacts = text => emailContacts(text.replace(/([A-Z0-9._%+-]+)[ \t]*@[ \t]*([A-Z0-9-]+(?:[ \t]*\.[ \t]*[A-Z0-9-]+)+)/gi, email => email.replace(/[ \t]/g, '')));

export function parseDelimited(raw, delimiter) {
  const text = String(raw).replace(/^\uFEFF/, '');
  const rows = [], row = [];
  let field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (quoted || !field.trim()) quoted = !quoted;
      else field += char;
    } else if (!quoted && (char === delimiter || char === '\n' || char === '\r')) {
      row.push(field.trim()); field = '';
      if (char !== delimiter) {
        if (row.some(Boolean)) rows.push([...row]);
        row.length = 0;
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else field += char;
  }
  if (quoted) throw new Error('علامات الاقتباس غير مكتملة في ملف CSV.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function contactsFromRows(rows) {
  const first = rows.findIndex(row => row.some(value => String(value || '').trim()));
  if (first < 0) return [];
  const headers = rows[first].map(headerKey);
  const emailIndex = headers.findIndex(value => emailHeaders.has(value));
  const nameIndex = headers.findIndex(value => nameHeaders.has(value));
  const hasHeader = emailIndex >= 0 || nameIndex >= 0;
  return rows.slice(first + (hasHeader ? 1 : 0)).flatMap(row => {
    if (hasHeader) {
      const name = String(row[nameIndex] || '').trim();
      // Addresses can be embedded in text, mailto links, or share one cell.
      const emails = extractEmails(emailIndex >= 0 ? row[emailIndex] : row.join(' '));
      return emails.length ? emails.map(email => ({ name, email })) : [{ name, email: '' }];
    }
    const cells = row.map(value => String(value || '').trim()).filter(Boolean);
    const emails = cells.filter(value => emailPattern.test(value));
    if (emails.length) {
      const name = cells.filter(value => !emailPattern.test(value)).join(' ');
      return emails.map((email, i) => ({ name: i ? '' : name, email }));
    }
    const text = cells.join(' ');
    const inlineEmails = extractEmails(text);
    const name = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '').replace(/[<>|]/g, ' ').trim();
    return inlineEmails.length ? inlineEmails.map((email, i) => ({ name: i ? '' : name, email })) : [{ name, email: '' }];
  }).filter(row => row.name || row.email);
}

function decodeXml(value) {
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, entity) => {
    if (entity[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity.toLowerCase()] || all;
    const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
  });
}
const xmlText = xml => [...String(xml || '').matchAll(/<(?:[\w.-]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g)].map(match => decodeXml(match[1])).join('');
const attribute = (attrs, key) => attrs.match(new RegExp('(?:^|\\s)' + key + '=(["\'])(.*?)\\1'))?.[2] || '';

export function worksheetRows(xml, sharedStrings = []) {
  const rows = [];
  for (const row of xml.matchAll(/<(?:[\w.-]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?row>/g)) {
    const cells = [];
    for (const cell of row[1].matchAll(/<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c>)/g)) {
      const address = attribute(cell[1], 'r').match(/^([A-Z]+)\d+$/)?.[1];
      let column = address ? [...address].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1 : cells.length;
      if (column > 16383) throw new Error('عنوان عمود Excel غير صالح.');
      const type = attribute(cell[1], 't');
      const value = (cell[2] || '').match(/<(?:[\w.-]+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?v>/)?.[1] || '';
      cells[column] = type === 's' ? sharedStrings[Number(value)] || '' : type === 'inlineStr' ? xmlText(cell[2]) : decodeXml(value);
    }
    if (cells.some(Boolean)) rows.push(Array.from(cells, value => value || ''));
  }
  return rows;
}

async function readOfficeArchive(file, run) {
  const entries = (await run('unzip', ['-Z1', file.path])).split(/\r?\n/).filter(Boolean);
  if (entries.length > 2000) throw new Error('الملف يحتوي على أجزاء كثيرة جدًا. قسّمه إلى ملفات أصغر.');
  const sheets = entries.filter(name => /^xl\/worksheets\/[^/]+\.xml$/.test(name));
  if (!sheets.length) {
    const documents = entries.filter(name => /^(?:word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml|ppt\/slides\/slide\d+\.xml|content\.xml)$/.test(name));
    if (!documents.length) throw new Error('هذا ملف مضغوط. فك الضغط وارفع المستند أو قائمة البريد الموجودة بداخله.');
    const contacts = [];
    for (const document of documents) {
      const xml = await run('unzip', ['-p', file.path, document]);
      // Join adjacent rich-text runs, but keep paragraphs and cells separate.
      const text = xml.replace(/<\/(?:[\w.-]+:)?(?:p|tc|table-cell|table-row)>/g, '\n').replace(/<[^>]*>/g, '');
      contacts.push(...emailContacts(text));
    }
    return contacts;
  }
  if (sheets.length > 30) throw new Error('الحد الأقصى 30 ورقة بيانات. قسّم الملف إلى قوائم أصغر.');
  let shared = [];
  if (entries.includes('xl/sharedStrings.xml')) {
    const xml = await run('unzip', ['-p', file.path, 'xl/sharedStrings.xml']);
    shared = [...xml.matchAll(/<(?:[\w.-]+:)?si(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?si>/g)].map(match => xmlText(match[1]));
  }
  const contacts = [];
  for (const sheet of sheets) {
    const xml = await run('unzip', ['-p', file.path, sheet]);
    contacts.push(...contactsFromRows(worksheetRows(xml, shared)));
  }
  return contacts;
}

function decodeText(buffer) {
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  if ((buffer[0] === 0xff && buffer[1] === 0xfe) || buffer.subarray(0, 200).filter((value, index) => index % 2 && value === 0).length > 20) return buffer.toString('utf16le');
  return buffer.toString('utf8');
}

function contactsFromText(raw, extension) {
  const firstLine = raw.replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
  // Only structured lists retain names. Other documents contribute emails only.
  if (['.csv', '.tsv', '.txt'].includes(extension) || firstLine.split(delimiter).some(value => emailHeaders.has(headerKey(value)) || nameHeaders.has(headerKey(value)))) {
    try {
      const contacts = contactsFromRows(parseDelimited(raw, delimiter));
      if (contacts.some(row => row.email) || firstLine.split(delimiter).some(value => nameHeaders.has(headerKey(value)))) return contacts;
    } catch { /* Irregular text need not obey CSV quoting rules. */ }
  }
  let text = raw.replace(/\\u([\da-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\'([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(?:par|line|tab)\b/g, '\n');
  if (/^\s*\{\\rtf/.test(raw)) text = text.replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, ' ');
  if (/^\s*</.test(raw)) text = text.replace(/<\/(?:p|div|li|td|tr)>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ');
  return emailContacts(/^\s*</.test(raw) ? `${raw}\n${text}` : text);
}

export async function readContactFile(file) {
  const stat = await fs.stat(file.path);
  if (stat.size > 5 * 1024 * 1024) throw new Error('حجم الملف يتجاوز 5MB. قسّمه إلى ملفات أصغر.');
  const data = await fs.readFile(file.path);
  if (!data.length) throw new Error('الملف فارغ. اختر ملفًا يحتوي على عناوين البريد.');
  const extension = path.extname(file.originalname || '').toLowerCase();
  const deadline = Date.now() + 45000;
  let outputBytes = 0;
  const run = async (command, args) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('استغرقت قراءة الملف وقتًا طويلًا. قسّمه إلى ملفات أصغر.');
    try {
      const { stdout } = await unzip(command, args, { maxBuffer: maxTextBytes - outputBytes, timeout: Math.min(20000, remaining), env: { ...process.env, OMP_THREAD_LIMIT: '1' } });
      outputBytes += Buffer.byteLength(stdout);
      if (outputBytes >= maxTextBytes) throw new Error('النص المستخرج أكبر من الحد المسموح. قسّم الملف إلى ملفات أصغر.');
      return stdout;
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('أداة قراءة هذا النوع غير متاحة على الخادم. يلزم تثبيت تحديث الاستيراد.');
      if (error.killed || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error('الملف كبير أو معقّد بعد فكّه. قسّمه إلى ملفات أصغر.');
      if (error.code || error.signal) throw new Error('تعذرت قراءة الملف. تأكد أنه غير تالف أو محمي بكلمة مرور.');
      throw error;
    }
  };
  let contacts;
  const isPdf = data.subarray(0, 1024).includes(Buffer.from('%PDF-'));
  const isZip = data[0] === 0x50 && data[1] === 0x4b;
  const isOle = data.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  const isBiff = [0x0009, 0x0209, 0x0409, 0x0809].includes(data.length >= 2 ? data.readUInt16LE(0) : -1);
  const isImage = data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || data.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) || /^GIF8|^BM|^II\*|^MM\x00\*/.test(data.subarray(0, 4).toString('latin1')) || data.subarray(8, 12).toString() === 'WEBP';
  if (isZip) contacts = await readOfficeArchive(file, run);
  else if (isPdf || isImage) {
    const pdfText = isPdf ? await run('pdftotext', ['-layout', file.path, '-']) : '';
    contacts = emailContacts(pdfText);
    const textPages = isPdf ? pdfText.replace(/\f$/, '').split('\f') : [];
    // OCR unreadable pages even when other pages already contain text addresses.
    let ocrPages = isPdf ? textPages.flatMap((text, index) => !/[\p{L}\p{N}]{3}/u.test(text) ? [index + 1] : []) : [1];
    if (ocrPages.length) {
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'inexc-email-ocr-'));
      try {
        if (isPdf) {
          const info = await run('pdfinfo', [file.path]);
          const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
          if (!pages) throw new Error('تعذر تحديد صفحات PDF. احفظ نسخة غير محمية وأعد رفعها.');
          if (!pdfText.trim()) ocrPages = Array.from({ length: Math.min(pages, 13) }, (_, index) => index + 1);
          if (ocrPages.length > 12) throw new Error('ملف PDF يحتوي على أكثر من 12 صفحة تحتاج قراءة ضوئية. قسّمه إلى أجزاء أصغر.');
        }
        for (const page of ocrPages) {
          const imagePath = path.join(temporary, 'page.png');
          if (isPdf) await run('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to', '2200', '-png', file.path, path.join(temporary, 'page')]);
          else await run('python3', [readerPath, 'image', file.path, imagePath]);
          contacts.push(...ocrContacts(await run('tesseract', [imagePath, 'stdout', '-l', 'eng', '--psm', '6'])));
        }
      } finally { await fs.rm(temporary, { recursive: true, force: true }); }
    }
  } else if (isOle || isBiff) {
    if (data.includes(Buffer.from('EncryptedPackage', 'utf16le'))) throw new Error('الملف محمي بكلمة مرور. احفظ نسخة غير محمية ثم ارفعها.');
    const isWord = data.includes(Buffer.from('WordDocument', 'utf16le'));
    if (isWord) contacts = emailContacts(await run('antiword', [file.path]));
    else {
      const sheets = JSON.parse(await run('python3', [readerPath, 'xls', file.path]));
      contacts = sheets.flatMap(contactsFromRows);
    }
  } else contacts = contactsFromText(decodeText(data), extension);
  const seen = new Set();
  const unique = contacts.filter(contact => {
    if (!contact.email) return Boolean(contact.name);
    const key = contact.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  if (unique.length > 3000) throw new Error('الحد الأقصى للقائمة 3000 جهة بعد إزالة التكرار. قسّم الملف إلى قوائم أصغر.');
  if (!unique.length) throw new Error('لم نعثر على بريد قابل للاستخراج. تأكد من وجود عناوين واضحة، أو احفظ الملف بصيغة Excel أو CSV. للصور وPDF المصوّر استخدم نسخة أوضح وغير محمية.');
  return unique;
}
