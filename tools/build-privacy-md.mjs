/**
 * Derives PRIVACY.md from site/privacy.html.
 *
 * The HTML page is what gets hosted on the author's own domain; the Markdown copy
 * gives GitHub a readable, linkable privacy policy at a URL that works today.
 * Generating one from the other keeps them from drifting — never edit PRIVACY.md
 * by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('site/privacy.html', 'utf8');
const body = html.slice(html.indexOf('<h1>'), html.indexOf('<footer'));

const inline = (s) =>
  s
    .replace(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, h, t) => `[${t.trim()}](${h})`)
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, '**$2**')
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/g, '*$2*')
    .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const out = ['<!-- Generated from site/privacy.html by tools/build-privacy-md.mjs. Do not edit. -->', ''];

for (const [, tag, content] of body.matchAll(
  /<(h1|h2|p|ul|table)[^>]*>([\s\S]*?)<\/\1>/g,
)) {
  if (tag === 'h1') out.push(`# ${inline(content)}`, '');
  else if (tag === 'h2') out.push(`## ${inline(content)}`, '');
  else if (tag === 'p') { const t = inline(content); if (t) out.push(t, ''); }
  else if (tag === 'ul') {
    for (const [, li] of content.matchAll(/<li>([\s\S]*?)<\/li>/g)) out.push(`- ${inline(li)}`);
    out.push('');
  } else if (tag === 'table') {
    const rows = [...content.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, r]) =>
      [...r.matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/g)].map(([, c]) => inline(c)),
    );
    if (!rows.length) continue;
    out.push(`| ${rows[0].join(' | ')} |`, `|${rows[0].map(() => '---').join('|')}|`);
    for (const r of rows.slice(1)) out.push(`| ${r.join(' | ')} |`);
    out.push('');
  }
}

out.push('---', '',
  'This policy is also published at the project site. The extension source is public ' +
  'under GPL-3.0, so every statement above can be checked against the code.');

writeFileSync('PRIVACY.md', out.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8');
console.log(`PRIVACY.md written — ${out.length} blocks`);
