"""Tests for tools/cv_cuts.py, the cut order of the Word CV.

npm test runs these after Jest. No file is read or written outside a
temporary folder. The bullets and phrases are made up.
"""
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
from cv_cuts import OVER_WARNING, cut_one, is_protected, load_protected, protected_phrases, trim  # noqa: E402

PROTECTED = 'Set up a 7-person data team from the start.'
RULES = f'- Page budget: never cut a latest-role bullet. Never merge or cut "{PROTECTED}" In the latest role ...\n'


def role(name, n, extra=()):
    return {'role': name, 'bullets': [f'{name} bullet {i + 1}' for i in range(n)] + list(extra)}


def payload(latest=10, older=(4, 4, 4), accs=5, skills=5, competencies=True):
    exp = [role('Latest', latest)] + [role(f'Older{i + 1}', n) for i, n in enumerate(older)]
    return {
        'experience': exp,
        'accomplishments': [{'lead': f'Acc {i + 1}', 'text': 'result'} for i in range(accs)],
        'skills': [{'category': f'Group {i + 1}', 'items': ['x']} for i in range(skills)],
        'competencies': ['c'] if competencies else [],
    }


def items(p):
    """Number of items that a cut can remove, as a stand-in for lines."""
    return sum(len(e['bullets']) for e in p['experience']) + len(p['accomplishments']) + len(p['skills'])


def cut_log(p, n, **kw):
    """The section of each of the first n cuts, as a list of names."""
    log = []
    for _ in range(n):
        before = {
            'acc': len(p['accomplishments']), 'skills': len(p['skills']),
            **{e['role']: len(e['bullets']) for e in p['experience']},
        }
        if not cut_one(p, **kw):
            break
        after = {
            'acc': len(p['accomplishments']), 'skills': len(p['skills']),
            **{e['role']: len(e['bullets']) for e in p['experience']},
        }
        log.append(next(k for k in before if before[k] != after[k]))
    return log


class CutOrder(unittest.TestCase):
    def test_full_order(self):
        # 3 older roles; Older3 is the earliest role (the last entry).
        p = payload(accs=6, older=(4, 4, 4), skills=4)  # 4 + Core Competencies = 5 groups
        log = cut_log(p, 100)
        self.assertEqual(log, [
            'acc',                                   # a) accomplishments to 5
            'Older3', 'Older2', 'Older1',            # b) older roles to 3, earliest first
            'Older3', 'Older2', 'Older1',            # c) older roles to 2, earliest first
            'acc',                                   # d) accomplishments to 4
            'skills',                                # e) skill groups to 4 with Core Competencies
            'Older3', 'Older2', 'Older1',            # f) older roles to 1, earliest first
        ])

    def test_never_cuts_latest_role_bullets(self):
        p = payload(latest=10)
        while cut_one(p):
            pass
        self.assertEqual(len(p['experience'][0]['bullets']), 10)
        self.assertEqual([len(e['bullets']) for e in p['experience'][1:]], [1, 1, 1])
        self.assertEqual(len(p['accomplishments']), 4)
        self.assertEqual(len(p['skills']) + 1, 4)

    def test_skill_groups_without_competencies(self):
        p = payload(skills=5, competencies=False, older=(1,), accs=4)
        self.assertEqual(cut_log(p, 10), ['skills'])
        self.assertEqual(len(p['skills']), 4)

    def test_keep_pattern_protects_accomplishments(self):
        p = payload(accs=6, older=(1,))
        p['accomplishments'][-1]['lead'] = 'Must-have item'
        cut_one(p, keep=re.compile('Must-have'))
        self.assertEqual([a['lead'] for a in p['accomplishments']][-2:], ['Acc 4', 'Must-have item'])

    def test_protected_bullet_is_never_cut(self):
        protected = protected_phrases(RULES)
        p = payload(older=(4,), accs=4)
        # The protected bullet is the last one: the cut takes the one before it.
        p['experience'][1]['bullets'][-1] = f'**{PROTECTED[:-1]}**, with a hiring plan.'
        while cut_one(p, protected=protected):
            pass
        self.assertEqual(p['experience'][1]['bullets'], [f'**{PROTECTED[:-1]}**, with a hiring plan.'])


class Protected(unittest.TestCase):
    def test_phrases_from_the_rules(self):
        self.assertEqual(protected_phrases(RULES), ['set up a 7-person data team from the start'])
        self.assertEqual(protected_phrases('no such line'), [])

    def test_match_ignores_bold_case_and_full_stop(self):
        ph = protected_phrases(RULES)
        self.assertTrue(is_protected('**Set up a 7-person DATA team from the start**, then more.', ph))
        self.assertFalse(is_protected('Set up a data team.', ph))

    def test_load_from_folder(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(load_protected(d), [])
            with open(os.path.join(d, 'cv-rules_example.md'), 'w', encoding='utf-8') as f:
                f.write('Never merge or cut "Example bullet."')
            self.assertEqual(load_protected(d), ['example bullet'])
            with open(os.path.join(d, 'cv-rules.md'), 'w', encoding='utf-8') as f:
                f.write(RULES)
            self.assertEqual(load_protected(d), ['set up a 7-person data team from the start'])


class Trim(unittest.TestCase):
    def test_stops_when_short_enough(self):
        p = payload()
        cut, warning = trim(p, items, items(p) - 3)
        self.assertEqual((cut, warning), (3, None))

    def test_warning_when_still_too_long(self):
        p = payload()
        cut, warning = trim(p, items, 5)
        self.assertEqual(warning, OVER_WARNING)
        self.assertEqual(warning, 'CV still over 3 pages after all cuts; owner to decide')
        # Every allowed cut was made; the latest role is whole.
        self.assertFalse(cut_one(p))
        self.assertEqual(len(p['experience'][0]['bullets']), 10)
        self.assertGreater(cut, 0)

    def test_no_cut_when_short(self):
        p = payload()
        self.assertEqual(trim(p, items, 1000), (0, None))


if __name__ == '__main__':
    unittest.main()
