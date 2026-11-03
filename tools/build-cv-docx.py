#!/usr/bin/env python3
"""Builds a Word CV from a career-ops CV payload (JSON).

Usage: build-cv-docx.py <payload.json> <out.docx> <template.docx> [cv.md]

tailor.js runs it. The template (Resume/templates/resume.docx, gitignored)
must have these paragraphs: the name first and the headline second, a
contact line with "@" and "|", the section headings "Professional Summary",
"Domain Expertise", "Accomplishments", "Area of Expertise" and "Recognition",
a "Scope:" line, and Heading4 paragraphs with a tab before the dates.

The template is one of the owner's own Word resumes. Its styles, numbering,
page setup, header and footer stay as they are. Only the body is rebuilt, by
cloning the template's own paragraphs for each part of the CV.
"""
import json, math, re, sys, zipfile
from xml.sax.saxutils import escape

payload_path, out_path, template_path = sys.argv[1:4]
cv_path = sys.argv[4] if len(sys.argv) > 4 else None
p = json.load(open(payload_path, encoding='utf-8'))

MAX_LINES = 160  # 3 pages, with a small margin (see est_lines)


def cv_section(md, name):
    m = re.search(rf'^## {re.escape(name)}\s*\n(.*?)(?=^## |\Z)', md, re.S | re.M)
    return [l[2:].strip() for l in (m.group(1) if m else '').splitlines() if l.startswith('- ')]


# Sections the worker may leave out are taken verbatim from cv.md. The
# accomplishments are ranked by word overlap with the tailored summary and
# competencies, so the most relevant come first.
if cv_path:
    md = open(cv_path, encoding='utf-8').read()
    if not p.get('domain_expertise'):
        items = cv_section(md, 'Domain Expertise')
        half = (len(items) + 1) // 2
        p['domain_expertise'] = [' • '.join(x) for x in (items[:half], items[half:]) if x]
    if not p.get('accomplishments'):
        focus = set(re.findall(r'[a-z0-9]{4,}', (p.get('summary', '') + ' ' + ' '.join(p.get('competencies') or [])).lower()))
        accs = []
        for line in cv_section(md, 'Accomplishments'):
            m = re.match(r'\*\*(.+?)\*\*\s*(.*)', line)
            if m:
                accs.append({'lead': m.group(1).rstrip('.'), 'text': m.group(2)})
        accs.sort(key=lambda a: -len(focus & set(re.findall(r'[a-z0-9]{4,}', (a['lead'] + ' ' + a['text']).lower()))))
        p['accomplishments'] = accs[:6]

# Owner's date style: "Aug 2022 to Jun 2026".
for e in p.get('experience') or []:
    e['dates'] = re.sub(r'\s*[-–—]\s*', ' to ', e.get('dates', ''))

with zipfile.ZipFile(template_path) as z:
    parts = {n: z.read(n) for n in z.namelist()}
doc = parts['word/document.xml'].decode('utf-8')
head, rest = doc.split('<w:body>', 1)
body, tail = rest.rsplit('</w:body>', 1)
sect = re.findall(r'<w:sectPr\b.*?</w:sectPr>', body, re.S)[-1]
paras = re.findall(r'<w:p\b[^>]*>.*?</w:p>', body, re.S)


def text(px):
    return ''.join(re.findall(r'<w:t(?:\s[^>]*)?>([^<]*)</w:t>', px))


def find(pred, what):
    for px in paras:
        if pred(text(px).strip()):
            return px
    sys.exit(f'template has no {what} paragraph')


def after(px):
    return paras[paras.index(px) + 1]


def ppr(px):
    m = re.search(r'<w:pPr>.*?</w:pPr>', px, re.S)
    return m.group(0) if m else ''


def rprs(px):
    out = []
    for r in re.findall(r'<w:r\b[^>]*>.*?</w:r>', px, re.S):
        if '<w:t' in r:
            m = re.search(r'<w:rPr>.*?</w:rPr>', r, re.S)
            out.append(m.group(0) if m else '')
    return out


def rpr(px, i=0):
    rs = rprs(px)
    return rs[min(i, len(rs) - 1)] if rs else ''


def bold(r):
    if '<w:b/>' in r:
        return r
    return r.replace('<w:rPr>', '<w:rPr><w:b/><w:bCs/>', 1) if r else '<w:rPr><w:b/><w:bCs/></w:rPr>'


def run(t, r='', tab=False):
    return f'<w:r>{r}{"<w:tab/>" if tab else ""}<w:t xml:space="preserve">{escape(t)}</w:t></w:r>'


def runs_md(t, r):
    """Text with **bold** spans as runs."""
    return ''.join(run(seg, bold(r) if i % 2 else r)
                   for i, seg in enumerate(re.split(r'\*\*', t)) if seg)


def para(proto, inner):
    return f'<w:p>{ppr(proto)}{inner}</w:p>'


# Prototype paragraphs from the template.
P_NAME = paras[0]
P_HEAD = paras[1]
P_CONTACT = find(lambda t: '@' in t and '|' in t, 'contact')
P_SECTION = find(lambda t: t == 'Accomplishments', 'section heading')
P_ACC = after(P_SECTION)
P_SUMMARY = after(find(lambda t: t == 'Professional Summary', 'summary heading'))
P_DOMAIN = after(find(lambda t: t == 'Domain Expertise', 'domain heading'))
# A heading with a right tab before the dates: the first is a role, the
# last is an education entry.
TAB_HEADS = [x for x in paras if 'Heading4' in x and '<w:tab/>' in x]
if not TAB_HEADS:
    sys.exit('template has no role heading (Heading4 with a tab)')
P_ROLE = TAB_HEADS[0]
P_SCOPE = find(lambda t: t.startswith('Scope:'), 'scope line')
P_BULLET = after(P_SCOPE)
P_SKILL = after(find(lambda t: t == 'Area of Expertise', 'skills heading'))
P_RECOG = after(find(lambda t: t == 'Recognition', 'recognition heading'))
P_EDU_HEAD = TAB_HEADS[-1]
P_EDU_LINE = after(P_EDU_HEAD)
P_SEC_PAD = next((x for x in paras if 'AfterSectionNamePadding' in x), '')
P_CARD_PAD = next((x for x in paras if 'AfterCardPadding' in x), '')


def headline(p):
    """Line under the name: the role title, then the JD's top keywords."""
    if p.get('headline'):
        return p['headline']
    title = (p.get('candidate') or {}).get('title') or ''
    seen = set(re.findall(r'[a-z]{4,}', title.lower()))
    out = [title] if title else []
    for c in p.get('competencies') or []:
        words = set(re.findall(r'[a-z]{4,}', c.lower()))
        if words and not words <= seen and len(' | '.join(out + [c])) <= 135:
            out.append(c)
            seen |= words
    return ' | '.join(out)


def build(p):
    out = [P_NAME]

    def section(name):
        out.append(para(P_SECTION, run(name, rpr(P_SECTION))))

    title = headline(p)
    if title:
        out.append(para(P_HEAD, run(title.upper(), rpr(P_HEAD))))
    out.append(P_CONTACT)

    if p.get('summary'):
        section('Professional Summary')
        out.append(para(P_SUMMARY, runs_md(p['summary'], rpr(P_SUMMARY))))

    if p.get('domain_expertise'):
        section('Domain Expertise')
        for line in p['domain_expertise']:
            out.append(para(P_DOMAIN, runs_md(line, rpr(P_DOMAIN))))

    if p.get('accomplishments'):
        section('Accomplishments')
        for a in p['accomplishments']:
            lead = a.get('lead', '')
            inner = run(lead.rstrip('.') + '. ', bold(rpr(P_ACC, 0))) if lead else ''
            out.append(para(P_ACC, inner + runs_md(a.get('text', ''), rpr(P_ACC, 1))))

    if p.get('experience'):
        section('Professional Experience')
        for e in p['experience']:
            role = ', '.join(x for x in [e.get('role'), e.get('company')] if x)
            out.append(para(P_ROLE, run(role, rpr(P_ROLE, 0)) + run(' ' + e.get('dates', ''), rpr(P_ROLE, 1), tab=True)))
            if e.get('context'):
                out.append(para(P_SCOPE, runs_md(e['context'], rpr(P_SCOPE))))
            for b in e.get('bullets', []):
                out.append(para(P_BULLET, runs_md(b, rpr(P_BULLET))))

    skills = list(p.get('skills') or [])
    if p.get('competencies'):
        skills.insert(0, {'category': 'Core Competencies', 'items': p['competencies']})
    if skills:
        section('Area of Expertise')
        for s in skills:
            items = s['items'] if isinstance(s['items'], str) else ' • '.join(s['items'])
            cat = s.get('category')
            inner = run(cat.rstrip(':') + ': ', bold(rpr(P_SKILL, 0))) if cat else ''
            out.append(para(P_SKILL, inner + runs_md(items, rpr(P_SKILL, 1))))

    if p.get('awards'):
        section('Recognition')
        for a in p['awards']:
            rest_txt = ', '.join(x for x in [a.get('org'), a.get('year')] if x)
            inner = run(a['title'], bold(rpr(P_RECOG, 0))) + (run('. ' + rest_txt, rpr(P_RECOG, 1)) if rest_txt else '')
            out.append(para(P_RECOG, inner))

    edu = list(p.get('education') or []) + list(p.get('certifications') or [])
    if edu:
        section('Education')
        if P_SEC_PAD:
            out.append(P_SEC_PAD)
        for i, x in enumerate(edu):
            org = ', '.join(v for v in [x.get('org'), x.get('location')] if v)
            out.append(para(P_EDU_HEAD, run(org or x['title'], rpr(P_EDU_HEAD, 0)) + run(' ' + (x.get('year') or ''), rpr(P_EDU_HEAD, 1), tab=True)))
            if org:
                out.append(para(P_EDU_LINE, runs_md(x['title'], rpr(P_EDU_LINE))))
            if x.get('description'):
                out.append(para(P_EDU_LINE, runs_md(x['description'], rpr(P_EDU_LINE))))
            if P_CARD_PAD and i < len(edu) - 1:
                out.append(P_CARD_PAD)
    return out


def est_lines(paras_):
    """Estimated printed lines. Calibrated on the owner's own Word resumes in
    this template, whose saved page counts say 140-170 lines print as 3 pages."""
    n = 0.0
    for px in paras_:
        big = 'w:val="44"' in px or 'w:val="32"' in px
        n += max(1, math.ceil(len(text(px)) * (1.6 if big else 1) / 118)) + 0.3
    return n


def cut_one(p):
    """Removes the least important item. The worker lists items most relevant
    first, so the last one goes. Returns False when nothing is left to cut."""
    exp = p.get('experience') or []

    def pop(lst, keep):
        if lst is not None and len(lst) > keep:
            lst.pop()
            return True
        return False

    def older(keep):
        return any(pop(exp[i].get('bullets'), keep) for i in range(len(exp) - 1, 0, -1))

    lead = exp[0].get('bullets') if exp else None
    steps = [lambda: pop(p.get('accomplishments'), 5), lambda: pop(lead, 10),
             lambda: pop(p.get('skills'), 5), lambda: older(2),
             lambda: pop(p.get('accomplishments'), 4), lambda: pop(lead, 8),
             lambda: pop(p.get('skills'), 4), lambda: older(1), lambda: pop(lead, 6)]
    return any(step() for step in steps)


out = build(p)
cut = 0
while est_lines(out) > MAX_LINES and cut_one(p):
    cut += 1
    out = build(p)

parts['word/document.xml'] = (head + '<w:body>' + ''.join(out) + sect + '</w:body>' + tail).encode('utf-8')
with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for n, data in parts.items():
        z.writestr(n, data)
print(f'wrote {out_path}: ~{est_lines(out):.0f} lines (limit {MAX_LINES}), {cut} items cut, headline: {headline(p)}')
