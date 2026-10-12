import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readContactFile, contactsFromRows, worksheetRows } from '../message-contacts.js';

const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const addresses = rows => rows.map(row => row.email.toLowerCase()).sort();
async function fromText(text, name = 'contacts.anything') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'inexc-import-test-'));
  try {
    const file = path.join(directory, 'upload');
    await fs.writeFile(file, text);
    return await readContactFile({ originalname: name, path: file });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('namespace-prefixed XLSX reads shared and inline strings even with the wrong extension', async () => {
  const rows = await readContactFile({ originalname: 'contacts.dat', path: fixture('prefixed-contacts.xlsx') });
  assert.deepEqual(addresses(rows), ['inline@example.com', 'prefix@example.com']);
  assert.deepEqual(worksheetRows('<x:row><x:c r="A1"/><x:c r="B1" t="inlineStr"><x:is><x:t>b@example.com</x:t></x:is></x:c></x:row>'), [['', 'b@example.com']]);
});

test('emails can share cells, have arbitrary column positions, and use display names', () => {
  assert.deepEqual(contactsFromRows([['الاسم', 'رمز', 'البريد الإلكتروني'], ['اسم', '1', 'User <one@example.com>; two@example.com']]), [
    { name: 'اسم', email: 'one@example.com' }, { name: 'اسم', email: 'two@example.com' }
  ]);
});

test('UTF-16, JSON escapes, HTML entities, RTF, and unknown extensions extract addresses', async () => {
  const cases = [
    [Buffer.from('\ufeffEmail;Name\nutf16@example.com;Test', 'utf16le'), 'list.csv', 'utf16@example.com'],
    ['{"contact":"json\\u0040example.com"}', 'list.json', 'json@example.com'],
    ['<p>html&#64;example.com</p>', 'list.html', 'html@example.com'],
    ['{\\rtf1\\ansi Contact rtf@example.com\\par}', 'list.rtf', 'rtf@example.com'],
    ['EMAIL;TYPE=INTERNET:card@example.com', 'list.vcf', 'card@example.com'],
    ['From: eml@example.com\nSubject: Test', 'list.eml', 'eml@example.com'],
    ['Email\nchanged@example.com', 'renamed.doc', 'changed@example.com'],
    ['Email\n"unfinished csv@example.com', 'broken.csv', 'csv@example.com'],
  ];
  for (const [text, name, expected] of cases) assert.deepEqual(addresses(await fromText(text, name)), [expected], name);
});

test('DOCX, OpenDocument, PowerPoint and legacy XLS read their document contents', async () => {
  for (const [name, expected] of [
    ['contacts.docx', ['word@example.com']], ['contacts.ods', ['ods@example.com', 'second@example.com']],
    ['contacts.pptx', ['slides@example.com']], ['legacy-contacts.xls', ['legacy@example.com']],
  ]) assert.deepEqual(addresses(await readContactFile({ originalname: name, path: fixture(name) })), expected, name);
});

test('PDF text, image OCR and mixed PDF pages retain all extracted addresses', async () => {
  for (const [name, expected] of [
    ['contacts.pdf', ['pdf@example.com']], ['contacts.png', ['scanned@example.com']],
    ['mixed-contacts.pdf', ['pdf@example.com', 'scanned@example.com']],
  ]) assert.deepEqual(addresses(await readContactFile({ originalname: name, path: fixture(name) })), expected, name);
});

test('deduplication happens before the 3000-contact limit and does not silently truncate', async () => {
  assert.equal((await fromText('Email\n' + 'same@example.com\n'.repeat(3100), 'contacts.csv')).length, 1);
  await assert.rejects(fromText('Email\n' + Array.from({ length: 3001 }, (_, i) => `u${i}@example.com`).join('\n'), 'contacts.csv'), /3000/);
});

test('empty, oversized, unreadable and corrupt files return an actionable error', async () => {
  await assert.rejects(fromText(''), /الملف فارغ/);
  await assert.rejects(fromText(Buffer.alloc(5 * 1024 * 1024 + 1)), /5MB/);
  await assert.rejects(fromText('A document without addresses.'), /لم نعثر على بريد/);
  await assert.rejects(fromText('PK\x03\x04broken', 'contacts.xlsx'), /تالف أو محمي/);
});
