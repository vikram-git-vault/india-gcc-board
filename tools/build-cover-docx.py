#!/usr/bin/env python3
"""Builds a Word cover letter from a career-ops cover payload (JSON).

Usage: build-cover-docx.py <payload.json> <out.docx> <template.docx>

tailor.js runs it. The payload is
  {"greeting": "Dear Hiring Team,", "paragraphs": ["...", "..."], "closing": "Regards,"}
The template (Resume/templates/cover-letter.docx, gitignored) is one of the
owner's own letters: a greeting, body paragraphs, a closing line and the
name last. Its page setup and paragraph formats stay as they are; the name
paragraph is kept as it is.
"""
import json, re, sys, zipfile
from xml.sax.saxutils import escape

payload_path, out_path, template_path = sys.argv[1:4]
p = json.load(open(payload_path, encoding='utf-8'))
if not p.get('paragraphs'):
    sys.exit('cover payload has no paragraphs')

with zipfile.ZipFile(template_path) as z:
    parts = {n: z.read(n) for n in z.namelist()}
doc = parts['word/document.xml'].decode('utf-8')
head, rest = doc.split('<w:body>', 1)
body, tail = rest.rsplit('</w:body>', 1)
sect = re.findall(r'<w:sectPr\b.*?</w:sectPr>', body, re.S)[-1]
paras = [x for x in re.findall(r'<w:p\b[^>]*>.*?</w:p>', body, re.S)
         if re.search(r'<w:t(?:\s[^>]*)?>[^<]+</w:t>', x)]
if len(paras) < 4:
    sys.exit('template needs a greeting, a body paragraph, a closing and the name')
P_GREETING, P_BODY, P_CLOSING, P_NAME = paras[0], paras[1], paras[-2], paras[-1]


def ppr(px):
    m = re.search(r'<w:pPr>.*?</w:pPr>', px, re.S)
    return m.group(0) if m else ''


def rpr(px):
    for r in re.findall(r'<w:r\b[^>]*>.*?</w:r>', px, re.S):
        if '<w:t' in r:
            m = re.search(r'<w:rPr>.*?</w:rPr>', r, re.S)
            return m.group(0) if m else ''
    return ''


def para(proto, t):
    t = t.replace('**', '')
    return f'<w:p>{ppr(proto)}<w:r>{rpr(proto)}<w:t xml:space="preserve">{escape(t)}</w:t></w:r></w:p>'


out = [para(P_GREETING, p.get('greeting') or 'Dear Hiring Team,')]
out += [para(P_BODY, x) for x in p['paragraphs']]
out += [para(P_CLOSING, p.get('closing') or 'Regards,'), P_NAME]

parts['word/document.xml'] = (head + '<w:body>' + ''.join(out) + sect + '</w:body>' + tail).encode('utf-8')
with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for n, data in parts.items():
        z.writestr(n, data)
words = sum(len(x.split()) for x in p['paragraphs'])
print(f'wrote {out_path}: {len(p["paragraphs"])} paragraphs, {words} words')
