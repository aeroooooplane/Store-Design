import copy
import unittest
from sync_source_inventory import prepare


class IncrementTests(unittest.TestCase):
    def setUp(self):
        self.old = {'source_id': 'NEW-101', 'filename': 'old.pdf', 'sha256': 'a',
                    'bytes': 1, 'page_count': 1, 'role': 'primary', 'git_tracked': True,
                    'path': '资源库/01_各门店原图纸/old.pdf',
                    'legacy_ids': {'sample_id': 'preserved'}}
        self.base = {'sources': [self.old], 'archives': [{'sha256': 'a', 'archive_source_id': 'NEW-101',
                     'store_id': None, 'filenames': ['old.pdf'], 'source_ids': ['NEW-101']}],
                     'summary': {}, 'rules': {}}

    def test_addition_preserves_identity_and_is_idempotent(self):
        new = dict(self.old, filename='new.pdf', sha256='b', path='资源库/01_各门店原图纸/new.pdf')
        before = copy.deepcopy(self.base)
        result, added = prepare(self.base, [self.old, new], 'time')
        self.assertEqual(self.base, before)
        self.assertEqual(result['sources'][0]['legacy_ids'], self.old['legacy_ids'])
        self.assertEqual(added[0]['source_id'], 'NEW-102')
        repeated, added_again = prepare(result, [self.old, new], 'later')
        self.assertEqual(added_again, [])
        self.assertEqual(repeated['sources'], result['sources'])

    def test_missing_or_replaced_source_is_rejected(self):
        for inventory in ([], [dict(self.old, sha256='different')]):
            with self.assertRaises(ValueError):
                prepare(self.base, inventory, 'time')

    def test_alias_keeps_existing_archive(self):
        result, added = prepare(self.base, [self.old, dict(self.old, filename='alias.pdf')], 'time')
        self.assertEqual(result['summary']['unique_sha256'], 1)
        self.assertEqual(result['summary']['alias_files'], 1)
        self.assertEqual(added[0]['archive_source_id'], 'NEW-101')


if __name__ == '__main__':
    unittest.main()
