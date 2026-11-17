"""The cut order of the Word CV (owner's rules, 2026-11-17).

build-cv-docx.py removes items one at a time while the CV is longer than
3 pages. The worker lists items most relevant first, so the last one goes.

- Never cut a latest-role bullet.
- Never cut an item that matches the owner's must-have pattern (keep), or
  an older-role bullet that has a protected phrase (protected_phrases()).
- Order: an accomplishment (down to 5); older roles to 3 bullets, then to
  2 bullets, earliest role first; an accomplishment (down to 4); skill
  groups to 4 (counting Core Competencies); older roles to 1 bullet.
- When the CV is still too long after all steps, cut nothing more: the
  owner decides (OVER_WARNING).
"""
import os
import re

OVER_WARNING = 'CV still over 3 pages after all cuts; owner to decide'

NEVER = re.compile(r'(?!)')


def _plain(t):
    """Lower case, no bold marks, single spaces, no last full stop."""
    t = re.sub(r'\*\*', '', str(t or '')).lower()
    return re.sub(r'\s+', ' ', t).strip().rstrip('.').strip()


def protected_phrases(rules_text):
    """The older-role bullets that are never cut: each phrase in a line
    'Never merge or cut "..."' of the owner's CV rules
    (config/private/cv-rules.md). The facts stay out of git."""
    return [_plain(m) for m in re.findall(r'Never merge or cut "([^"]+)"', rules_text or '') if _plain(m)]


def load_protected(folder):
    """protected_phrases() of config/private/cv-rules.md, else of the
    _example file, else none."""
    for name in ('cv-rules.md', 'cv-rules_example.md'):
        f = os.path.join(folder, name)
        if os.path.exists(f):
            return protected_phrases(open(f, encoding='utf-8').read())
    return []


def is_protected(bullet, phrases):
    b = _plain(bullet)
    return any(ph in b for ph in phrases)


def cut_one(p, keep=NEVER, protected=()):
    """Removes the least important item that the rules let go. Returns
    False when no step can cut anything."""
    exp = p.get('experience') or []

    def pop_older_role(bullets, keep_n):
        """The last bullet of one older role that is not protected."""
        if bullets is None or len(bullets) <= keep_n:
            return False
        for i in range(len(bullets) - 1, -1, -1):
            if not is_protected(bullets[i], protected):
                bullets.pop(i)
                return True
        return False

    def older(keep_n):
        """One bullet from the earliest older role that has more than keep_n."""
        return any(pop_older_role(exp[i].get('bullets'), keep_n) for i in range(len(exp) - 1, 0, -1))

    def pop_acc(keep_n):
        """The last accomplishment that is not a must-have item."""
        accs = p.get('accomplishments')
        if not accs or len(accs) <= keep_n:
            return False
        for i in range(len(accs) - 1, -1, -1):
            if not keep.search(accs[i].get('lead', '') + ' ' + accs[i].get('text', '')):
                accs.pop(i)
                return True
        return False

    def pop_skills(keep_n):
        skills = p.get('skills')
        if skills is not None and len(skills) > keep_n:
            skills.pop()
            return True
        return False

    # Skill groups count "Core Competencies" (the competencies) too.
    core = 1 if p.get('competencies') else 0
    steps = [lambda: pop_acc(5), lambda: older(3), lambda: older(2),
             lambda: pop_acc(4), lambda: pop_skills(4 - core), lambda: older(1)]
    return any(step() for step in steps)


def trim(p, measure, max_lines, keep=NEVER, protected=()):
    """Cuts until measure(p) <= max_lines or nothing more can go.
    Returns (items cut, warning or None)."""
    cut = 0
    while measure(p) > max_lines and cut_one(p, keep, protected):
        cut += 1
    return cut, (OVER_WARNING if measure(p) > max_lines else None)
