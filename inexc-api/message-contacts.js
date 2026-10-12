import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const unzip = promisify(execFile);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailHeaders = new Set(['email', 'emailaddress', 'البريد', 'البريدالالكتروني', 'الايميل']);
const nameHeaders = new Set(['name', 'fullname', 'الاسم', 'الاسمالكامل']);
const headerKey = value => String(value || '').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/[\s_\-\uFEFF]/g, '');

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
    if (hasHeader) return [{ name: String(row[nameIndex] || '').trim(), email: String(row[emailIndex] || '').trim() }];
    const cells = row.map(value => String(value || '').trim()).filter(Boolean);
    const emails = cells.filter(value => emailPattern.test(value));
    if (emails.length) {
      const name = cells.filter(value => !emailPattern.test(value)).join(' ');
      return emails.map((email, i) => ({ name: i ? '' : name, email }));
    }
    const text = cells.join(' ');
    const inlineEmails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
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
const xmlText = xml => [...String(xml || '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(match => decodeXml(match[1])).join('');
const attribute = (attrs, key) => attrs.match(new RegExp('(?:^|\\s)' + key + '=(["\'])(.*?)\\1'))?.[2] || '';

export function worksheetRows(xml, sharedStrings = []) {
  const rows = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const address = attribute(cell[1], 'r').match(/^([A-Z]+)\d+$/)?.[1];
      let column = address ? [...address].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1 : cells.length;
      if (column > 16383) throw new Error('عنوان عمود Excel غير صالح.');
      const type = attribute(cell[1], 't');
      const value = cell[2].match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] || '';
      cells[column] = type === 's' ? sharedStrings[Number(value)] || '' : type === 'inlineStr' ? xmlText(cell[2]) : decodeXml(value);
    }
    if (cells.some(Boolean)) rows.push(Array.from(cells, value => value || ''));
  }
  return rows;
}

export async function readContactFile(file) {
  if (path.extname(file.originalname || '').toLowerCase() !== '.xlsx') {
    const raw = await fs.readFile(file.path, 'utf8');
    const firstLine = raw.split(/\r?\n/)[0] || '';
    const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
    return contactsFromRows(parseDelimited(raw, delimiter));
  }
  const limits = { maxBuffer: 16 * 1024 * 1024, timeout: 15000 };
  const entries = (await unzip('unzip', ['-Z1', file.path], limits)).stdout.split(/\r?\n/);
  const sheets = entries.filter(name => /^xl\/worksheets\/[^/]+\.xml$/.test(name));
  if (!sheets.length || sheets.length > 30) throw new Error('ارفع ملف Excel يحتوي على 1 إلى 30 ورقة بيانات.');
  let shared = [];
  if (entries.includes('xl/sharedStrings.xml')) {
    const xml = (await unzip('unzip', ['-p', file.path, 'xl/sharedStrings.xml'], limits)).stdout;
    shared = [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(match => xmlText(match[1]));
  }
  const contacts = [];
  for (const sheet of sheets) {
    const xml = (await unzip('unzip', ['-p', file.path, sheet], limits)).stdout;
    contacts.push(...contactsFromRows(worksheetRows(xml, shared)));
    if (contacts.length > 3000) throw new Error('الحد الأقصى للقائمة 3000 جهة. قسّم الملف إلى قوائم أصغر.');
  }
  return contacts;
}
