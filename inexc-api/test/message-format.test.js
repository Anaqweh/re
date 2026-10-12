import test from 'node:test';
import assert from 'node:assert/strict';
import { richTextPrefix, normaliseMessageBody, messageDocument, messageText, messageDirection, renderMessageBody } from '../message-format.js';
const rich = (blocks, direction = 'auto') => richTextPrefix + JSON.stringify({ direction, blocks });

test('Arabic, English and mixed paragraphs have explicit email-safe alignment', () => {
  const result = renderMessageBody('مرحبًا بكم في عالم التدريب\nWelcome to our training programs');
  assert.match(result.html, /<p dir="rtl"[^>]*text-align:right/);
  assert.match(result.html, /<p dir="ltr"[^>]*text-align:left/);
  assert.equal(messageDirection('مرحبًا name@example.com'),'rtl');
  assert.equal(messageDirection('Welcome {{name}}'),'ltr');
});

test('Bold, italic, underline, lists and links survive serialization and rendering', () => {
  const body = rich([
    { type:'paragraph', runs:[{text:'مرحبًا ',bold:true},{text:'بكم',italic:true,underline:true}] },
    { type:'bullet', runs:[{text:'Visit',href:'https://example.com/?a=1&b=2'}] },
    { type:'number', runs:[{text:'Step one',strike:true}] }
  ]);
  const normalized=normaliseMessageBody(body), result=renderMessageBody(normalized);
  assert.equal(messageText(normalized),'مرحبًا بكم\nVisit\nStep one');
  assert.match(result.html, /<strong>مرحبًا <\/strong>/);
  assert.match(result.html, /<u><em>بكم<\/em><\/u>/);
  assert.match(result.html, /<ul /); assert.match(result.html, /<ol /);
  assert.match(result.html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.match(result.html, /<s>Step one<\/s>/);
  assert.equal(normaliseMessageBody(normalized),normalized);
});

test('HTML, unsafe links, unknown attributes and personalized values remain inert', () => {
  const body=rich([{type:'script',runs:[{text:'{{name}} <img src=x onerror=alert(1)>',bold:true,href:'javascript:alert(1)',onclick:'bad',color:'red'}]}]);
  const output=renderMessageBody(normaliseMessageBody(body),{name:'<script>alert(1)</script>'}).html;
  assert.ok(output.includes('&lt;script&gt;'));
  assert.ok(output.includes('&lt;img'));
  assert.ok(!output.includes('<script>')); assert.ok(!output.includes('<img')); assert.ok(!output.includes('href='));
  assert.ok(!normaliseMessageBody(body).includes('onclick'));
});

test('Legacy plain text remains literal and empty or excessive rich text is handled', () => {
  assert.equal(normaliseMessageBody('Old **literal** template'),'Old **literal** template');
  assert.equal(normaliseMessageBody(rich([{type:'paragraph',runs:[{text:'\n'}]}])), '');
  assert.throws(()=>normaliseMessageBody(rich([{runs:[{text:'a'.repeat(5001)}]}])),/5000/);
  assert.throws(()=>normaliseMessageBody(richTextPrefix+'broken'),/تنسيق/);
  const body=rich([{runs:[{text:'مرحبا'}]}],'ltr');
  assert.equal(messageDocument(body).direction,'ltr');
  assert.match(renderMessageBody(body).html,/text-align:left/);
});

test('Personalization still works when formatting splits a variable between text runs', () => {
  const body=rich([{runs:[{text:'Hello {{na',bold:true},{text:'me}}, welcome {{course}}!'}]}]);
  const result=renderMessageBody(body,{name:'<Ahmed>',course:'AI'});
  assert.equal(result.text,'Hello <Ahmed>, welcome AI!');
  assert.match(result.html, /<strong>Hello &lt;Ahmed&gt;<\/strong>, welcome AI!/);
  assert.ok(!result.html.includes('{{'));
});
